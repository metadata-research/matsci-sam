import { z } from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import {
  aiModelsTable,
  db,
  termsTable,
  votesTable,
  definitionsTable,
  chatsTable,
  usersTable,
  commentsTable,
  coauthorsTable,
  definitionRevisionsTable
} from "@yamz/db"
import { and, desc, eq, getTableColumns, isNull, like, sql } from "drizzle-orm"
import { slugify, uniqueSlug } from "@/lib/slug"
import { deleteDefinitionRows } from "@/lib/definition-purge"
import {
  adminProcedure,
  authenticatedProcedure,
  contributorProcedure
} from "../procedures"
import { revalidatePath } from "next/cache"
import { reviseDefinition } from "@/lib/llm/definitions"
import { after } from "next/server"
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
import { recordCompletion } from "@/lib/surveys"
import { nextPositionFor } from "@/lib/survey-queries"
import {
  regeneratedConflict,
  requireOnePosition,
  requireStepForAct,
  sqlState
} from "./surveys"

export const definitionsRouter = createTRPCRouter({
  create: contributorProcedure
    .input(
      z.object({
        term: z.string().trim().min(1, "Term is required").max(TERM_MAX_LENGTH),
        definition: z
          .string()
          .trim()
          .min(1, "You must give a definition")
          .max(DEFINITION_MAX_LENGTH),
        examples: z
          .string()
          .trim()
          .min(1, "You must give an example")
          .max(EXAMPLE_MAX_LENGTH),
        // The interactive add flow: no term-level auto-AI definition; the
        // author refines their own definition on the definition page instead
        interactive: z.boolean().default(false),
        // The define step of a walkthrough the definition is written inside.
        surveyStepId: z.number().int().optional(),
        // The current revision of a definition of the same term this one
        // amends, recorded on the initial revision so the record states the
        // derivation. The define step of a walkthrough sets it when a
        // participant amends a candidate.
        derivedFromRevisionId: z.number().int().optional()
      })
    )
    .mutation(async ({ ctx: { userId: authorId }, input }) => {
      // normalize the term
      const term = input.term.trim().toLowerCase()

      // A step is checked against the act before anything is written: the
      // caller may take part, and the step is the define step of this term.
      // A define step names a term that exists, so a term not yet in the
      // vocabulary cannot be the one the step is for.
      let walkthroughStep = null
      if (input.surveyStepId !== undefined) {
        const existingTerm = await db.query.termsTable.findFirst({
          columns: { id: true },
          where: eq(termsTable.term, term)
        })
        if (!existingTerm)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That step is not for this act"
          })
        walkthroughStep = await requireStepForAct(
          input.surveyStepId,
          authorId,
          { kind: "define", termId: existingTerm.id }
        )
      }

      // Whether this submission scheduled an automatic AI alternate
      // definition, so the client can tell the contributor it is coming.
      let aiScheduled = false
      let written
      try {
        written = await db.transaction(async (tx) => {
          let dbTerm = await tx.query.termsTable.findFirst({
            where: eq(termsTable.term, term)
          })
          if (!dbTerm) {
            // First time this term has been defined, so create it -- with its
            // public slug. Distinct terms can normalize to the same slug
            // ("Band Gap" vs "band gap"), so check what is taken and let
            // uniqueSlug() number the collision the way OED numbers homographs.
            // Read inside the transaction so a concurrent insert cannot slip a
            // colliding slug in between; the unique index is the backstop.
            const conflicting = await tx
              .select({ slug: termsTable.slug })
              .from(termsTable)
              .where(like(termsTable.slug, `${slugify(term)}%`))

            const [insertedTerm] = await tx
              .insert(termsTable)
              .values({
                term,
                slug: uniqueSlug(term, new Set(conflicting.map((c) => c.slug)))
              })
              .returning()

            if (!input.interactive) {
              // insert the ai chat
              await tx.insert(chatsTable).values({
                role: "user",
                userId: authorId,
                message: `<term>\n${term}\n<example>\n${input.examples}`,
                termId: insertedTerm.id
              })

              after(() =>
                // Automatically create AI definition on new term creation
                reviseDefinition(insertedTerm.id)
              )
              aiScheduled = true
            }

            dbTerm = insertedTerm
          }

          // One position per define step: an act of the author already
          // naming the step refuses this definition, in the transaction that
          // would write it.
          if (walkthroughStep)
            await requireOnePosition(tx, walkthroughStep.step, authorId)

          const existingOriginal = await tx.query.definitionsTable.findFirst({
            columns: { id: true },
            where: and(
              eq(definitionsTable.termId, dbTerm.id),
              eq(definitionsTable.authorId, authorId),
              isNull(definitionsTable.refinedFromId)
            )
          })
          if (existingOriginal)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "You already contributed a definition for this term. Open your existing definition to publish a revision."
            })

          // An amendment derives from what a reader can see now: the current
          // revision of a definition of this term. A revision of another
          // term, or none, is no candidate here; an older revision of a
          // candidate is refused with a reload, because the text has moved
          // on. Neither is recorded as the source of a definition it was not.
          if (input.derivedFromRevisionId !== undefined) {
            const [source] = await tx
              .select({
                termId: definitionsTable.termId,
                current: sql<boolean>`${definitionsTable.currentRevisionId} = ${definitionRevisionsTable.id}`
              })
              .from(definitionRevisionsTable)
              .innerJoin(
                definitionsTable,
                eq(definitionsTable.id, definitionRevisionsTable.definitionId)
              )
              .where(
                eq(definitionRevisionsTable.id, input.derivedFromRevisionId)
              )
              .limit(1)
            if (!source || source.termId !== dbTerm.id)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "That revision is not a candidate of this term"
              })
            if (!source.current)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "The definition you are amending has changed. Reload the page."
              })
          }

          const { definition: insertedDefinition } =
            await createDefinitionWithInitialRevision(tx, {
              termId: dbTerm.id,
              authorId,
              definition: input.definition,
              example: input.examples,
              changeNote: input.derivedFromRevisionId
                ? "Amendment of a candidate"
                : "Initial contribution",
              source: "initial",
              createdVia: input.interactive ? "interactive" : "classic",
              derivedFromRevisionId: input.derivedFromRevisionId ?? null,
              surveyStepId: input.surveyStepId ?? null
            })

          // The completion a define step records with its definition, which
          // is the position the step asked for, and where the walkthrough
          // resumes, so the shell can advance on the response. Built and
          // returned inside the transaction: assigned to an outer variable,
          // its type would read as the null it started as.
          let walkthrough: {
            completedStepId: number
            nextPosition: number | null
          } | null = null
          if (walkthroughStep) {
            // The define step completes with the definition it asked for, in
            // the transaction that writes it.
            await recordCompletion(tx, {
              stepId: walkthroughStep.step.id,
              userId: authorId
            })
            walkthrough = {
              completedStepId: walkthroughStep.step.id,
              nextPosition: await nextPositionFor(
                tx,
                walkthroughStep.study.id,
                authorId
              )
            }

            // A study term seeded without a model definition gets one here,
            // as a new term does: the generation otherwise fires only on term
            // creation, and the draft of a term in a walkthrough is its model
            // definition. A model definition is one under
            // a model identity, an aiModels row, which is what reviseDefinition
            // writes under; a simulated participant is an AI-flag account
            // without one and does not count.
            if (!input.interactive) {
              const [modelDefinition] = await tx
                .select({ id: definitionsTable.id })
                .from(definitionsTable)
                .innerJoin(
                  aiModelsTable,
                  eq(aiModelsTable.userId, definitionsTable.authorId)
                )
                .where(eq(definitionsTable.termId, dbTerm.id))
                .limit(1)
              if (!modelDefinition) {
                await tx.insert(chatsTable).values({
                  role: "user",
                  userId: authorId,
                  message: `<term>\n${term}\n<example>\n${input.examples}`,
                  termId: dbTerm.id
                })
                const termId = dbTerm.id
                after(() => reviseDefinition(termId))
                aiScheduled = true
              }
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

      return { term: dbTermOut, definition, aiScheduled, walkthrough }
    }),
  // The version of a definition's current revision. Cheap enough to poll:
  // the comment hook watches it after a comment schedules a model revision,
  // so the arrival can be announced instead of landing silently.
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
        example: z
          .string()
          .trim()
          .min(1, "Example of use is required")
          .max(EXAMPLE_MAX_LENGTH),
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
        input: { id, definition, example, changeNote, expectedRevisionId }
      }) => {
        try {
          const result = await db.transaction(async (tx) => {
            const owned = await tx.query.definitionsTable.findFirst({
              columns: { id: true },
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
              example,
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
              columns: { id: true },
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
            if (target.exampleDiff === null)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "This imported legacy revision has no recorded example and cannot be restored directly."
              })

            return publishDefinitionRevision(tx, {
              definitionId,
              editorId: userId,
              definition: diffToStringSimple(target.definitionDiff),
              example: diffToStringSimple(target.exampleDiff),
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
          author: {
            id: usersTable.id,
            name: usersTable.name,
            isAi: usersTable.isAi,
            isProfilePublic: usersTable.isProfilePublic,
            modelSlug: aiModelsTable.slug
          },
          term: termsTable.term,
          termSlug: termsTable.slug
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

      const vote = userId
        ? await db.query.votesTable.findFirst({
            columns: { kind: true },
            where: and(
              eq(votesTable.userId, userId),
              eq(votesTable.revisionId, selectedRevision.id)
            )
          })
        : null

      // Additional authors (the model, for accepted AI refinements)
      const coauthors = selectedRevision.model
        ? await db
            .select({
              id: usersTable.id,
              name: usersTable.name,
              isAi: usersTable.isAi,
              isProfilePublic: usersTable.isProfilePublic
            })
            .from(coauthorsTable)
            .innerJoin(usersTable, eq(usersTable.id, coauthorsTable.userId))
            .where(
              and(
                eq(coauthorsTable.definitionId, def.id),
                eq(usersTable.isAi, true),
                eq(usersTable.name, selectedRevision.model)
              )
            )
        : []

      // Public identities for both sides of the accepted-refinement lineage.
      // Internal row IDs remain relationship keys only and are not exposed in
      // the links rendered by the definition page.
      const [refinedFrom, refinedVersion] = await Promise.all([
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
            })
      ])

      const currentVersion =
        revisions.find((revision) => revision.id === def.currentRevisionId)
          ?.version ?? selectedRevision.version

      return {
        ...def,
        definition: diffToStringSimple(selectedRevision.definitionDiff),
        example:
          selectedRevision.exampleDiff === null
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
        revisions,
        coauthors,
        refinedFromDefinitionNumber: refinedFrom?.definitionNumber ?? null,
        refinedVersionId: refinedVersion?.id ?? null,
        refinedVersionDefinitionNumber: refinedVersion?.definitionNumber ?? null
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
