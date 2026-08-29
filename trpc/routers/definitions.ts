import { z } from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import {
  aiModelsTable,
  db,
  termsTable,
  votesTable,
  definitionsTable,
  usersTable,
  commentsTable,
  coauthorsTable,
  definitionRevisionsTable,
  aiContributionSuggestionsTable,
  surveyStepsTable,
  vocabulariesTable
} from "@yamz/db"
import { and, desc, eq, getTableColumns, like, sql } from "drizzle-orm"
import { slugify, uniqueSlug } from "@/lib/slug"
import { deleteDefinitionRows } from "@/lib/definition-purge"
import {
  adminProcedure,
  authenticatedProcedure,
  contributorProcedure
} from "../procedures"
import { revalidatePath } from "next/cache"
import { TRPCError } from "@trpc/server"
import {
  createDefinitionWithInitialRevision,
  diffToStringSimple,
  publishDefinitionRevision,
  RevisionConflictError,
  RevisionNoChangeError
} from "@/lib/definition-revisions"
import {
  CHANGE_NOTE_MAX_LENGTH,
  DEFINITION_MAX_LENGTH,
  EXAMPLE_MAX_LENGTH,
  TERM_MAX_LENGTH
} from "@/lib/input-limits"
import { revalidatePublicDefinition } from "@/lib/revalidate-public-definition"
import { recordPositionCompletion } from "@/lib/survey-positions"
import { nextPositionFor } from "@/lib/survey-queries"
import {
  expectedInstructionsSchema,
  lockParticipation,
  regeneratedConflict,
  requireOnePosition,
  requireStepForAct,
  sqlState
} from "./surveys"
import { GetModelUser } from "@/lib/crud"
import { currentFeaturedExampleText } from "@/lib/definition-example-queries"
import { lockDefinitionRevisionSource } from "@/lib/definition-source"
import { activeCommunityFor } from "@/lib/community-queries"
import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"
import { loadDefinitionRevisionComparison } from "@/lib/definition-revision-comparison"

// Compatibility projection for compact definition views while examples have
// their own endpoint: expose the active featured contribution under the old
// scalar property, falling back to the legacy mirror during migration.
const featuredExample = currentFeaturedExampleText()

export const definitionsRouter = createTRPCRouter({
  create: contributorProcedure
    .input(
      z
        .object({
          term: z
            .string()
            .trim()
            .min(1, "Term is required")
            .max(TERM_MAX_LENGTH),
          definition: z
            .string()
            .trim()
            .min(1, "You must give a definition")
            .max(DEFINITION_MAX_LENGTH),
          // Authoring convenience only: this becomes an independently
          // attributed example row, not part of the definition revision.
          initialExample: z.string().trim().max(EXAMPLE_MAX_LENGTH).optional(),
          // The define step of a walkthrough the definition is written inside.
          surveyStepId: z.number().int().optional(),
          expectedInstructions: expectedInstructionsSchema.optional(),
          // The current revision of a definition of the same term this one
          // revises, recorded on the initial revision so the record states the
          // derivation. The define step of a walkthrough sets it when a
          // participant suggests a revision to a candidate.
          derivedFromRevisionId: z.number().int().positive().optional(),
          // A separately voteable proposal intended to supersede this
          // definition while keeping the existing candidate available.
          replacesDefinitionId: z.number().int().positive().optional(),
          // An explicit, persisted AI preview generated inside either New term
          // or Suggest revision. The server consumes it exactly once.
          aiSuggestionId: z.number().int().positive().optional()
        })
        .refine(
          ({ derivedFromRevisionId, replacesDefinitionId }) =>
            derivedFromRevisionId === undefined ||
            replacesDefinitionId === undefined,
          {
            message:
              "A contribution cannot be both a revision and a replacement"
          }
        )
        .refine(
          ({ initialExample, derivedFromRevisionId }) =>
            !initialExample || derivedFromRevisionId === undefined,
          {
            message:
              "An initial example can accompany a new term or replacement, not a suggested revision"
          }
        )
    )
    .mutation(async ({ ctx: { userId: authorId }, input }) => {
      if (
        input.surveyStepId !== undefined &&
        input.expectedInstructions === undefined
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Reload the walkthrough before contributing."
        })
      // normalize the term
      const term = input.term.trim().toLowerCase()

      // Model identity creation performs its own transaction, so resolve it
      // before the publication transaction. The row is locked and rechecked
      // below before any attribution is accepted.
      const [suggestionPreview, activeCommunity] = await Promise.all([
        input.aiSuggestionId
          ? db.query.aiContributionSuggestionsTable.findFirst({
              columns: {
                intent: true,
                requestedById: true,
                vocabularySlug: true,
                model: true,
                status: true
              },
              where: eq(aiContributionSuggestionsTable.id, input.aiSuggestionId)
            })
          : Promise.resolve(null),
        activeCommunityFor(db, authorId)
      ])
      const contributionVocabularySlug =
        activeCommunity?.vocabularySlug ?? DEFAULT_VOCABULARY_SLUG
      if (
        input.aiSuggestionId &&
        (!suggestionPreview ||
          suggestionPreview.requestedById !== authorId ||
          suggestionPreview.status !== "generated")
      )
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No such pending AI suggestion"
        })
      if (
        suggestionPreview?.intent === "new_term" &&
        suggestionPreview.vocabularySlug !== contributionVocabularySlug
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The contribution vocabulary changed. Request a new language model draft in the current vocabulary."
        })
      const modelUser = suggestionPreview
        ? await GetModelUser(suggestionPreview.model)
        : null

      // A step is checked against the act before anything is written: the
      // caller may take part, and the step is the define step of this term.
      // A define step names a term that exists, so a term not yet in the
      // vocabulary cannot be the one the step is for.
      let walkthroughStep = null
      if (input.surveyStepId !== undefined) {
        const step = await db.query.surveyStepsTable.findFirst({
          columns: { termId: true },
          where: eq(surveyStepsTable.id, input.surveyStepId)
        })
        if (!step?.termId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That step is not for this act"
          })
        walkthroughStep = await requireStepForAct(
          input.surveyStepId,
          authorId,
          { kind: "define", termId: step.termId }
        )
      }

      let written
      try {
        written = await db.transaction(async (tx) => {
          const lockedWalkthroughStep =
            walkthroughStep && input.surveyStepId !== undefined
              ? await lockParticipation(
                  tx,
                  input.surveyStepId,
                  walkthroughStep.study.id,
                  authorId,
                  input.expectedInstructions!
                )
              : null
          const aiSuggestion = input.aiSuggestionId
            ? (
                await tx
                  .select()
                  .from(aiContributionSuggestionsTable)
                  .where(
                    eq(aiContributionSuggestionsTable.id, input.aiSuggestionId)
                  )
                  .for("update")
              )[0]
            : null

          if (
            input.aiSuggestionId &&
            (!aiSuggestion ||
              aiSuggestion.requestedById !== authorId ||
              aiSuggestion.status !== "generated")
          )
            throw new TRPCError({
              code: "CONFLICT",
              message: "This AI suggestion is no longer available"
            })
          if (
            aiSuggestion &&
            aiSuggestion.termText.trim().toLowerCase() !== term
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That AI suggestion was generated for a different term"
            })
          if (
            aiSuggestion?.intent === "new_term" &&
            aiSuggestion.vocabularySlug !== contributionVocabularySlug
          )
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "The contribution vocabulary changed. Request a new language model draft in the current vocabulary."
            })
          if (aiSuggestion?.intent === "new_term") {
            if (
              input.derivedFromRevisionId !== undefined ||
              input.replacesDefinitionId !== undefined ||
              input.surveyStepId !== undefined
            )
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "A new-term suggestion cannot publish a revision or replacement"
              })
          }
          if (aiSuggestion?.intent === "revise_definition") {
            if (
              input.replacesDefinitionId !== undefined ||
              aiSuggestion.sourceRevisionId === null ||
              (input.derivedFromRevisionId !== undefined &&
                input.derivedFromRevisionId !== aiSuggestion.sourceRevisionId)
            )
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "That AI suggestion does not match this revision action"
              })
          }

          const derivedFromRevisionId =
            aiSuggestion?.intent === "revise_definition"
              ? aiSuggestion.sourceRevisionId!
              : input.derivedFromRevisionId
          const isRevision = derivedFromRevisionId !== undefined
          const isReplacement = input.replacesDefinitionId !== undefined
          const isNewTerm =
            !isRevision && !isReplacement && lockedWalkthroughStep === null

          if (input.initialExample && !isNewTerm && !isReplacement)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "An initial example can accompany a new term or replacement only"
            })

          const source = isRevision
            ? await lockDefinitionRevisionSource(tx, derivedFromRevisionId)
            : null
          if (isRevision && !source)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "A revision must target an existing term"
            })
          if (
            aiSuggestion?.intent === "revise_definition" &&
            source &&
            aiSuggestion.vocabularySlug !== source.vocabularySlug
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That language model draft belongs to another vocabulary"
            })

          const replacementTarget = isReplacement
            ? await tx.query.definitionsTable.findFirst({
                columns: { id: true, termId: true },
                where: eq(definitionsTable.id, input.replacesDefinitionId!)
              })
            : null
          if (isReplacement && !replacementTarget)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "A replacement must target an existing term"
            })

          const targetedTermId =
            source?.termId ??
            replacementTarget?.termId ??
            lockedWalkthroughStep?.step.termId ??
            null
          let dbTerm = targetedTermId
            ? await tx.query.termsTable.findFirst({
                where: eq(termsTable.id, targetedTermId)
              })
            : await tx.query.termsTable.findFirst({
                where: and(
                  eq(termsTable.vocabularySlug, contributionVocabularySlug),
                  sql`lower(btrim(${termsTable.term})) = ${term}`
                )
              })

          if (dbTerm && dbTerm.term.trim().toLowerCase() !== term)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That contribution names a different term"
            })
          if (dbTerm && isNewTerm)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "That term is already in this vocabulary. Open it to suggest a revision or propose a replacement."
            })
          if (!dbTerm && !isNewTerm)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "A revision or replacement must target an existing term"
            })
          if (!dbTerm) {
            // First time this term has been defined, so create it -- with its
            // public slug. Distinct terms can normalize to the same slug
            // (for example, "C" and "C++"), so check what is taken and let
            // uniqueSlug() number the collision the way OED numbers homographs.
            // Read inside the transaction so a concurrent insert cannot slip a
            // colliding slug in between; the unique index is the backstop.
            const conflicting = await tx
              .select({ slug: termsTable.slug })
              .from(termsTable)
              .where(
                and(
                  eq(termsTable.vocabularySlug, contributionVocabularySlug),
                  like(termsTable.slug, `${slugify(term)}%`)
                )
              )

            const reserved = new Set(conflicting.map((row) => row.slug))
            if (contributionVocabularySlug === DEFAULT_VOCABULARY_SLUG) {
              const vocabularySlugs = await tx
                .select({ slug: vocabulariesTable.slug })
                .from(vocabulariesTable)
                .where(eq(vocabulariesTable.isDefault, false))
              for (const row of vocabularySlugs) reserved.add(row.slug)
            } else {
              reserved.add("activity")
              reserved.add("definitions")
              reserved.add("provenance")
              reserved.add("rank")
            }

            const [insertedTerm] = await tx
              .insert(termsTable)
              .values({
                term,
                vocabularySlug: contributionVocabularySlug,
                slug: uniqueSlug(term, reserved)
              })
              .returning()

            dbTerm = insertedTerm
          }

          // One position per define step: an act of the author already
          // naming the step refuses this definition, in the transaction that
          // would write it.
          if (lockedWalkthroughStep)
            await requireOnePosition(tx, lockedWalkthroughStep.step, authorId)

          // A suggested revision derives from what a reader can see now: the current
          // revision of a definition of this term. A revision of another
          // term, or none, is no candidate here; an older revision of a
          // candidate is refused with a reload, because the text has moved
          // on. Neither is recorded as the source of a definition it was not.
          let sourceDefinitionId: number | null = null
          if (derivedFromRevisionId !== undefined) {
            if (!source || source.termId !== dbTerm.id)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "That revision is not a candidate of this term"
              })
            if (!source.isCurrent)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "The definition you are revising has changed. Reload the page."
              })
            sourceDefinitionId = source.definitionId

            if (
              aiSuggestion?.intent === "revise_definition" &&
              aiSuggestion.definitionId !== source.definitionId
            )
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "That AI suggestion belongs to a different definition"
              })
          }

          if (input.replacesDefinitionId !== undefined) {
            if (!replacementTarget || replacementTarget.termId !== dbTerm.id)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "That replacement target is not part of this term"
              })
          }

          const { definition: insertedDefinition, revision: insertedRevision } =
            await createDefinitionWithInitialRevision(tx, {
              termId: dbTerm.id,
              authorId,
              definition: input.definition,
              // Examples are now independent contributions. Keep the legacy
              // non-null column and revision shape valid while the normalized
              // example records become canonical.
              example: "",
              initialExample: input.initialExample,
              changeNote: isRevision
                ? aiSuggestion
                  ? "AI-assisted suggested revision"
                  : "Suggested revision of a candidate"
                : isReplacement
                  ? "Replacement proposal"
                  : aiSuggestion
                    ? "AI-assisted new-term contribution"
                    : "Initial contribution",
              source: aiSuggestion ? "ai_assisted" : "initial",
              model: aiSuggestion?.model ?? null,
              prompt: aiSuggestion?.promptText ?? null,
              refinedFromId: sourceDefinitionId,
              replacesDefinitionId: input.replacesDefinitionId ?? null,
              derivedFromRevisionId: derivedFromRevisionId ?? null,
              surveyStepId: input.surveyStepId ?? null
            })

          if (aiSuggestion && modelUser) {
            await tx.insert(coauthorsTable).values({
              definitionId: insertedDefinition.id,
              userId: modelUser.id
            })
            await tx
              .update(aiContributionSuggestionsTable)
              .set({
                status: "accepted",
                outputDefinitionId: insertedDefinition.id,
                decidedAt: sql`now()`
              })
              .where(eq(aiContributionSuggestionsTable.id, aiSuggestion.id))
          }

          // The completion a define step records with its definition, which
          // is the position the step asked for, and where the walkthrough
          // resumes, so the shell can advance on the response. Built and
          // returned inside the transaction: assigned to an outer variable,
          // its type would read as the null it started as.
          let walkthrough: {
            completedStepId: number
            nextPosition: number | null
          } | null = null
          if (lockedWalkthroughStep) {
            // The define step completes with the definition it asked for, in
            // the transaction that writes it.
            await recordPositionCompletion(tx, {
              stepId: lockedWalkthroughStep.step.id,
              userId: authorId,
              kind: "proposed",
              definitionId: insertedDefinition.id,
              revisionId: insertedRevision.id
            })
            walkthrough = {
              completedStepId: lockedWalkthroughStep.step.id,
              nextPosition: await nextPositionFor(
                tx,
                lockedWalkthroughStep.study.id,
                authorId
              )
            }
          }

          return { term: dbTerm, definition: insertedDefinition, walkthrough }
        })
      } catch (error) {
        // The step the definition names was deleted under it.
        if (walkthroughStep && sqlState(error) === "23503")
          throw regeneratedConflict()
        throw error
      }
      const { term: dbTermOut, definition, walkthrough } = written
      revalidatePath("/terms")
      revalidatePath(`/terms/${dbTermOut.id}`)
      await revalidatePublicDefinition({
        definitionId: definition.id,
        definitionNumber: definition.definitionNumber,
        termId: dbTermOut.id,
        version: 1
      })

      return {
        term: dbTermOut,
        definition,
        walkthrough
      }
    }),
  // A compact version read retained for clients that need to detect an
  // explicitly published revision.
  currentVersion: baseProcedure
    .input(z.number())
    .query(async ({ input: definitionId }) => {
      const [row] = await db
        .select({ version: definitionRevisionsTable.version })
        .from(definitionsTable)
        .innerJoin(
          definitionRevisionsTable,
          eq(definitionRevisionsTable.id, definitionsTable.currentRevisionId)
        )
        .where(eq(definitionsTable.id, definitionId))
        .limit(1)
      return { version: row?.version ?? null }
    }),
  edit: authenticatedProcedure
    .input(
      z.object({
        id: z.number(),
        definition: z
          .string()
          .trim()
          .min(1, "Definition is required")
          .max(DEFINITION_MAX_LENGTH),
        changeNote: z
          .string()
          .trim()
          .min(3, "Briefly describe what changed")
          .max(CHANGE_NOTE_MAX_LENGTH),
        expectedRevisionId: z.number()
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: { id, definition, changeNote, expectedRevisionId }
      }) => {
        try {
          const result = await db.transaction(async (tx) => {
            const owned = await tx.query.definitionsTable.findFirst({
              columns: { id: true, example: true },
              where: and(
                eq(definitionsTable.authorId, userId),
                eq(definitionsTable.id, id)
              )
            })

            if (!owned)
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Definition doesn't exist or isn't yours"
              })

            return publishDefinitionRevision(tx, {
              definitionId: id,
              editorId: userId,
              definition,
              // Editing definition wording must not edit its independently
              // contributed examples. Preserve the compatibility mirror.
              example: owned.example,
              changeNote,
              source: "author_edit",
              expectedRevisionId
            })
          })

          revalidatePath("/terms")
          await revalidatePublicDefinition({
            definitionId: result.definition.id,
            definitionNumber: result.definition.definitionNumber,
            termId: result.definition.termId,
            version: result.revision.version
          })
          return result
        } catch (error) {
          if (error instanceof RevisionConflictError)
            throw new TRPCError({
              code: "CONFLICT",
              message: error.message
            })
          if (error instanceof RevisionNoChangeError)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error.message
            })
          throw error
        }
      }
    ),
  restoreRevision: authenticatedProcedure
    .input(
      z.object({
        definitionId: z.number(),
        revisionId: z.number(),
        expectedRevisionId: z.number(),
        changeNote: z.string().trim().min(3).max(CHANGE_NOTE_MAX_LENGTH)
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: { definitionId, revisionId, expectedRevisionId, changeNote }
      }) => {
        try {
          const result = await db.transaction(async (tx) => {
            const definition = await tx.query.definitionsTable.findFirst({
              columns: { id: true, example: true },
              where: and(
                eq(definitionsTable.id, definitionId),
                eq(definitionsTable.authorId, userId)
              )
            })
            if (!definition)
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Definition doesn't exist or isn't yours"
              })

            const target = await tx.query.definitionRevisionsTable.findFirst({
              where: and(
                eq(definitionRevisionsTable.id, revisionId),
                eq(definitionRevisionsTable.definitionId, definitionId)
              )
            })
            if (!target)
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "No such revision"
              })
            return publishDefinitionRevision(tx, {
              definitionId,
              editorId: userId,
              definition: diffToStringSimple(target.definitionDiff),
              // A definition rollback must not replace independently managed
              // examples with the legacy example stored in an old revision.
              example: definition.example,
              changeNote,
              source: "rollback",
              expectedRevisionId,
              derivedFromRevisionId: target.id
            })
          })

          revalidatePath("/terms")
          await revalidatePublicDefinition({
            definitionId: result.definition.id,
            definitionNumber: result.definition.definitionNumber,
            termId: result.definition.termId,
            version: result.revision.version
          })
          return result
        } catch (error) {
          if (error instanceof RevisionConflictError)
            throw new TRPCError({
              code: "CONFLICT",
              message: error.message
            })
          if (error instanceof RevisionNoChangeError)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error.message
            })
          throw error
        }
      }
    ),
  get: baseProcedure
    .input(
      z.object({ definitionId: z.number(), version: z.number().optional() })
    )
    .query(async ({ ctx: { userId }, input: { definitionId, version } }) => {
      const [def] = await db
        .select({
          ...getTableColumns(definitionsTable),
          example: featuredExample.as("example"),
          author: {
            id: usersTable.id,
            name: usersTable.name,
            isAi: usersTable.isAi,
            isProfilePublic: usersTable.isProfilePublic,
            modelSlug: aiModelsTable.slug
          },
          term: termsTable.term,
          termSlug: termsTable.slug,
          termVocabularySlug: termsTable.vocabularySlug
        })
        .from(definitionsTable)
        .where(eq(definitionsTable.id, definitionId))
        .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
        .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
        // A model author carries its own identity row.
        .leftJoin(aiModelsTable, eq(aiModelsTable.userId, usersTable.id))

      if (!def) return def

      const revisions = await db
        .select({
          id: definitionRevisionsTable.id,
          version: definitionRevisionsTable.version,
          previousRevisionId: definitionRevisionsTable.previousRevisionId,
          derivedFromRevisionId: definitionRevisionsTable.derivedFromRevisionId,
          definitionDiff: definitionRevisionsTable.definitionDiff,
          exampleDiff: definitionRevisionsTable.exampleDiff,
          changeNote: definitionRevisionsTable.changeNote,
          source: definitionRevisionsTable.source,
          model: definitionRevisionsTable.model,
          prompt: definitionRevisionsTable.prompt,
          createdAt: definitionRevisionsTable.createdAt,
          legacyIncomplete: definitionRevisionsTable.legacyIncomplete,
          editor: {
            id: usersTable.id,
            name: usersTable.name,
            isAi: usersTable.isAi,
            isProfilePublic: usersTable.isProfilePublic
          },
          score:
            sql<number>`coalesce(sum(case when ${votesTable.kind} = 'up' then 1 when ${votesTable.kind} = 'down' then -1 else 0 end), 0)`
              .mapWith(Number)
              .as("score")
        })
        .from(definitionRevisionsTable)
        .leftJoin(
          usersTable,
          eq(usersTable.id, definitionRevisionsTable.editorId)
        )
        .leftJoin(
          votesTable,
          eq(votesTable.revisionId, definitionRevisionsTable.id)
        )
        .where(eq(definitionRevisionsTable.definitionId, definitionId))
        .groupBy(definitionRevisionsTable.id, usersTable.id)
        .orderBy(desc(definitionRevisionsTable.version))

      const selectedRevision = version
        ? revisions.find((revision) => revision.version === version)
        : revisions.find((revision) => revision.id === def.currentRevisionId)

      if (!selectedRevision)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: version
            ? `Revision ${version} does not exist`
            : "Definition has no current revision"
        })

      const selectedDefinitionText = diffToStringSimple(
        selectedRevision.definitionDiff
      )
      const comparisonPromise = loadDefinitionRevisionComparison({
        definition: {
          definitionNumber: def.definitionNumber,
          termSlug: def.termSlug,
          vocabularySlug: def.termVocabularySlug
        },
        selectedRevision,
        revisions
      })

      const votePromise = userId
        ? db.query.votesTable.findFirst({
            columns: { kind: true },
            where: and(
              eq(votesTable.userId, userId),
              eq(votesTable.revisionId, selectedRevision.id)
            )
          })
        : null

      // Additional authors (the model, for accepted AI refinements)
      const coauthorsPromise = selectedRevision.model
        ? db
            .select({
              id: usersTable.id,
              name: usersTable.name,
              isAi: usersTable.isAi,
              isProfilePublic: usersTable.isProfilePublic
            })
            .from(coauthorsTable)
            .innerJoin(usersTable, eq(usersTable.id, coauthorsTable.userId))
            .innerJoin(aiModelsTable, eq(aiModelsTable.userId, usersTable.id))
            .where(
              and(
                eq(coauthorsTable.definitionId, def.id),
                eq(aiModelsTable.tag, selectedRevision.model)
              )
            )
        : []

      // Public identities for both sides of the accepted-refinement lineage.
      // Internal row IDs remain relationship keys only and are not exposed in
      // the links rendered by the definition page.
      const [
        comparison,
        vote,
        coauthors,
        refinedFrom,
        refinedVersion,
        replaces,
        replacements
      ] = await Promise.all([
        comparisonPromise,
        votePromise,
        coauthorsPromise,
        def.refinedFromId === null
          ? null
          : db.query.definitionsTable.findFirst({
              columns: { definitionNumber: true },
              where: eq(definitionsTable.id, def.refinedFromId)
            }),
        def.authorId === null
          ? null
          : db.query.definitionsTable.findFirst({
              columns: { id: true, definitionNumber: true },
              where: and(
                eq(definitionsTable.refinedFromId, def.id),
                eq(definitionsTable.authorId, def.authorId),
                sql`exists (
                  select 1
                  from ${definitionRevisionsTable} artifact_revision
                  where artifact_revision."definitionId" = ${definitionsTable.id}
                    and artifact_revision."sourceRefinementId" is not null
                )`
              )
            }),
        def.replacesDefinitionId === null
          ? null
          : db.query.definitionsTable.findFirst({
              columns: { definitionNumber: true },
              where: eq(definitionsTable.id, def.replacesDefinitionId)
            }),
        db.query.definitionsTable.findMany({
          columns: { definitionNumber: true },
          where: eq(definitionsTable.replacesDefinitionId, def.id),
          orderBy: definitionsTable.definitionNumber
        })
      ])

      const currentVersion =
        revisions.find((revision) => revision.id === def.currentRevisionId)
          ?.version ?? selectedRevision.version

      return {
        ...def,
        definition: selectedDefinitionText,
        example:
          selectedRevision.id === def.currentRevisionId
            ? def.example
            : selectedRevision.exampleDiff === null
              ? null
              : diffToStringSimple(selectedRevision.exampleDiff),
        model: selectedRevision.model,
        prompt: selectedRevision.prompt,
        score: selectedRevision.score,
        vote: vote?.kind ?? null,
        revisionId: selectedRevision.id,
        version: selectedRevision.version,
        currentVersion,
        isCurrentRevision: selectedRevision.id === def.currentRevisionId,
        revisionCreatedAt: selectedRevision.createdAt,
        changeNote: selectedRevision.changeNote,
        legacyIncomplete: selectedRevision.legacyIncomplete,
        editor: selectedRevision.editor,
        comparison,
        // Listed rather than spread: previousRevisionId and
        // derivedFromRevisionId in the select feed the server-side comparison
        // and stay out of the response, because internal row IDs remain
        // relationship keys only, as the lineage queries above require.
        revisions: revisions.map((revision) => ({
          id: revision.id,
          version: revision.version,
          definitionDiff: revision.definitionDiff,
          exampleDiff: revision.exampleDiff,
          changeNote: revision.changeNote,
          source: revision.source,
          model: revision.model,
          prompt: revision.prompt,
          createdAt: revision.createdAt,
          legacyIncomplete: revision.legacyIncomplete,
          editor: revision.editor,
          score: revision.score,
          // Examples have their own append-only history. Restoring a legacy
          // revision whose only difference was its embedded example would be
          // a no-op, so do not offer that action in the definition history.
          restorable:
            diffToStringSimple(revision.definitionDiff) !== def.definition
        })),
        coauthors,
        refinedFromDefinitionNumber: refinedFrom?.definitionNumber ?? null,
        refinedVersionId: refinedVersion?.id ?? null,
        refinedVersionDefinitionNumber:
          refinedVersion?.definitionNumber ?? null,
        replacesDefinitionNumber: replaces?.definitionNumber ?? null,
        replacementDefinitionNumbers: replacements.map(
          (replacement) => replacement.definitionNumber
        )
      }
    }),
  mine: authenticatedProcedure.query(async ({ ctx: { userId } }) => {
    const definitionsQuery = db.query.definitionsTable.findMany({
      where: eq(definitionsTable.authorId, userId),
      with: { term: true },
      orderBy: desc(definitionsTable.createdAt)
    })

    return await definitionsQuery
  }),
  list: baseProcedure
    .input(z.object({ termId: z.number() }))
    .query(async ({ ctx: { userId }, input: { termId } }) => {
      const definitionsQuery = db
        .select({
          ...getTableColumns(definitionsTable),
          example: featuredExample.as("example"),
          revisionId: definitionRevisionsTable.id,
          version: definitionRevisionsTable.version,
          isAi: usersTable.isAi,
          author: usersTable.name,
          authorProfilePublic: usersTable.isProfilePublic,
          authorModelSlug: aiModelsTable.slug,
          comments:
            sql<number>`(SELECT count(*) FROM ${commentsTable} WHERE ${commentsTable.definitionId} = ${definitionsTable.id})`
              .mapWith(Number)
              .as("comments"),
          vote: userId
            ? sql<"up" | "down" | null>`${votesTable.kind}`.as("vote")
            : sql<"up" | "down" | null>`null`.as("vote")
        })
        .from(definitionsTable)
        .where(and(eq(definitionsTable.termId, termId)))
        .innerJoin(
          definitionRevisionsTable,
          eq(definitionRevisionsTable.id, definitionsTable.currentRevisionId)
        )
        .innerJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
        // A model author carries its own identity row.
        .leftJoin(aiModelsTable, eq(aiModelsTable.userId, usersTable.id))
        // Highest voted first, newest breaking ties, then the permanent
        // definition number for identical timestamps. The tiebreak matters:
        // score alone left equal-scored definitions in whatever order the
        // planner returned, so the one shown first -- the term's default --
        // could change between requests.
        .orderBy(
          desc(definitionsTable.score),
          desc(definitionsTable.createdAt),
          desc(definitionsTable.definitionNumber)
        )

      if (userId)
        definitionsQuery.leftJoin(
          votesTable,
          and(
            eq(votesTable.userId, userId),
            eq(votesTable.revisionId, definitionRevisionsTable.id)
          )
        )

      return await definitionsQuery
    }),
  delete: adminProcedure
    .input(z.number())
    .mutation(async ({ input: definitionId }) => {
      // start a tx so if something fails, everything will get restored
      const deleted = await db.transaction(async (tx) => {
        // Refined alternatives can themselves be sources for Discussion
        // suggestions. Delete the complete descendant graph bottom-up so no
        // refinedFromId or exact-revision derivation is left dangling.
        const visited = new Set<number>()
        const deleteDefinitionGraph = async (id: number) => {
          if (visited.has(id)) return null
          visited.add(id)

          const refinedChildren = await tx.query.definitionsTable.findMany({
            columns: { id: true },
            where: eq(definitionsTable.refinedFromId, id)
          })
          for (const child of refinedChildren)
            await deleteDefinitionGraph(child.id)

          return deleteDefinitionRows(tx, id)
        }

        const deletedDef = await deleteDefinitionGraph(definitionId)
        if (!deletedDef)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Definition does not exist"
          })

        // Keep the term row even when its last definition is removed. Its slug
        // and nextDefinitionNumber are part of the public identifier ledger:
        // deleting the row would allow /vocabulary/<slug>/definitions/1 to be
        // minted again for unrelated content. A future withdrawal lifecycle
        // will replace this pre-pilot hard delete with a resolvable tombstone.

        return deletedDef
      })

      await revalidatePublicDefinition({
        definitionId: deleted.id,
        definitionNumber: deleted.definitionNumber,
        termId: deleted.termId
      })
      return deleted
    })
})
