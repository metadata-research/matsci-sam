import { z } from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import { contributorProcedure } from "../procedures"
import {
  coauthorsTable,
  commentsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  discussionSuggestionsTable,
  termsTable,
  usersTable
} from "@yamz/db"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import { OllamaModel, RefineSystemPrompt, runLLM } from "@/lib/apis/ollama"
import { GetModelUser } from "@/lib/crud"
import { createDefinitionWithInitialRevision } from "@/lib/definition-revisions"
import { COMMENT_MAX_LENGTH } from "@/lib/input-limits"
import { revalidatePublicDefinition } from "@/lib/revalidate-public-definition"

/*
 * Feed for the /discussion page: the most-recent terms, each paired with the
 * definition a comment should attach to.
 *
 * Comments target the term's AI definition when it has one, because commenting
 * on an AI definition feeds the model a revision (see comments.create). That is
 * the "dialog with the model" the page is for. Terms with no AI definition fall
 * back to their highest-voted definition, where a comment is an ordinary one.
 */
export const discussionRouter = createTRPCRouter({
  recent: baseProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(8) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 8

      const terms = await db
        .select({
          id: termsTable.id,
          term: termsTable.term,
          slug: termsTable.slug,
          createdAt: termsTable.createdAt
        })
        .from(termsTable)
        .orderBy(desc(termsTable.createdAt))
        .limit(limit)

      const termIds = terms.map((t) => t.id)
      if (termIds.length === 0) return []

      const defs = await db
        .select({
          termId: definitionsTable.termId,
          definitionId: definitionsTable.id,
          definitionNumber: definitionsTable.definitionNumber,
          revisionId: definitionRevisionsTable.id,
          version: definitionRevisionsTable.version,
          definition: definitionsTable.definition,
          example: definitionsTable.example,
          model: definitionRevisionsTable.model,
          isAi: usersTable.isAi,
          authorId: usersTable.id,
          author: usersTable.name,
          authorProfilePublic: usersTable.isProfilePublic,
          score: definitionsTable.score,
          createdAt: definitionsTable.createdAt,
          refinedFromId: definitionsTable.refinedFromId,
          comments: sql<number>`(
            SELECT count(*) FROM ${commentsTable}
            WHERE ${commentsTable.definitionId} = ${definitionsTable.id}
          )`
            .mapWith(Number)
            .as("comments")
        })
        .from(definitionsTable)
        .innerJoin(
          definitionRevisionsTable,
          eq(definitionRevisionsTable.id, definitionsTable.currentRevisionId)
        )
        .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
        .where(inArray(definitionsTable.termId, termIds))

      // Every immutable revision and comment on these definitions, for the
      // interleaved plain-language history.
      const definitionIds = defs.map((d) => d.definitionId)
      const definitionNumberById = new Map(
        defs.map((definition) => [
          definition.definitionId,
          definition.definitionNumber
        ])
      )
      const [revisions, comments] = definitionIds.length
        ? await Promise.all([
          db
            .select({
              id: definitionRevisionsTable.id,
              definitionId: definitionRevisionsTable.definitionId,
              version: definitionRevisionsTable.version,
              definitionDiff: definitionRevisionsTable.definitionDiff,
              source: definitionRevisionsTable.source,
              changeNote: definitionRevisionsTable.changeNote,
              legacyIncomplete: definitionRevisionsTable.legacyIncomplete,
              model: definitionRevisionsTable.model,
              createdAt: definitionRevisionsTable.createdAt,
              editorId: usersTable.id,
              editor: usersTable.name,
              editorIsAi: usersTable.isAi,
              editorProfilePublic: usersTable.isProfilePublic
            })
            .from(definitionRevisionsTable)
            .leftJoin(
              usersTable,
              eq(usersTable.id, definitionRevisionsTable.editorId)
            )
            .where(
              inArray(definitionRevisionsTable.definitionId, definitionIds)
            ),
          db
            .select({
              id: commentsTable.id,
              definitionId: commentsTable.definitionId,
              revisionId: commentsTable.revisionId,
              version: definitionRevisionsTable.version,
              message: commentsTable.message,
              createdAt: commentsTable.createdAt,
              migratedLegacy: commentsTable.migratedLegacy,
              authorId: usersTable.id,
              author: usersTable.name,
              isAi: usersTable.isAi,
              authorProfilePublic: usersTable.isProfilePublic
            })
            .from(commentsTable)
            .innerJoin(
              definitionRevisionsTable,
              and(
                eq(definitionRevisionsTable.id, commentsTable.revisionId),
                eq(
                  definitionRevisionsTable.definitionId,
                  commentsTable.definitionId
                )
              )
            )
            .innerJoin(usersTable, eq(usersTable.id, commentsTable.userId))
            .where(inArray(commentsTable.definitionId, definitionIds))
        ])
        : [[], []]

      // A term's history: its definitions and the comments on them, in the
      // order they happened. This is the plain-language counterpart to the
      // PROV-O view -- same events, no graph.
      const historyFor = (termId: number) => {
        const own = defs.filter((d) => d.termId === termId)
        const ownIds = new Set(own.map((d) => d.definitionId))

        const events = [
          ...revisions
            .filter((revision) => ownIds.has(revision.definitionId))
            .map((revision) => ({
              eventId: `revision-${revision.id}`,
              kind: "revision" as const,
              at: revision.createdAt,
              // A partial legacy import deliberately has no editor: the old
              // definitionEdits rows did not retain one. Do not attribute that
              // event to the stable definition's author by assumption.
              author: revision.editor ?? revision.model,
              authorId: revision.editorId,
              isAi:
                revision.editorIsAi ??
                (revision.source === "ai_refinement" ||
                  revision.source === "ai_generation"),
              isProfilePublic: revision.editorProfilePublic ?? false,
              body: revision.definitionDiff,
              definitionId: revision.definitionId,
              definitionNumber: definitionNumberById.get(
                revision.definitionId
              )!,
              version: revision.version,
              source: revision.source,
              changeNote: revision.changeNote,
              legacyIncomplete: revision.legacyIncomplete,
              migratedLegacy: false
            })),
          ...comments
            .filter((c) => ownIds.has(c.definitionId))
            .map((c) => ({
              eventId: `comment-${c.id}`,
              kind: "comment" as const,
              at: c.createdAt,
              author: c.author,
              authorId: c.authorId,
              isAi: c.isAi,
              isProfilePublic: c.authorProfilePublic,
              body: c.message,
              definitionId: c.definitionId,
              definitionNumber: definitionNumberById.get(c.definitionId)!,
              version: c.version,
              source: null,
              changeNote: null,
              legacyIncomplete: false,
              migratedLegacy: c.migratedLegacy
            }))
        ]

        return events.sort((a, b) => {
          const chronological = a.at.localeCompare(b.at)
          if (chronological !== 0) return chronological
          if (a.kind !== b.kind) return a.kind === "revision" ? -1 : 1
          return a.eventId.localeCompare(b.eventId)
        })
      }

      // One definition per term to discuss: prefer the AI definition, then the
      // highest score.
      const chosen = new Map<number, (typeof defs)[number]>()
      for (const d of defs) {
        const cur = chosen.get(d.termId)
        const better =
          !cur ||
          (d.isAi && !cur.isAi) ||
          (d.isAi === cur.isAi && d.score > cur.score)
        if (better) chosen.set(d.termId, d)
      }

      /*
       * Everyone who has contributed to a term, in the order they first did:
       * the original definition's author leads, then later authors and
       * commenters. Human contributors are deduplicated by stable account id;
       * models and unattributed legacy events use their displayed label.
       */
      const contributorsFrom = (history: ReturnType<typeof historyFor>) => {
        const seen = new Set<string>()
        const contributors: {
          id: number | null
          name: string
          isAi: boolean
          isProfilePublic: boolean
        }[] = []

        for (const event of history) {
          const name = event.author ?? "unknown"
          const identityKey =
            event.authorId === null
              ? `name:${event.isAi ? "ai" : "unknown"}:${name}`
              : `user:${event.authorId}`
          if (seen.has(identityKey)) continue
          seen.add(identityKey)
          contributors.push({
            id: event.authorId,
            name,
            isAi: event.isAi,
            isProfilePublic: event.isProfilePublic
          })
        }

        return contributors
      }

      // Keep recency order; drop the rare term with no definitions at all.
      return terms
        .map((t) => {
          const history = historyFor(t.id)

          return {
            ...t,
            def: chosen.get(t.id) ?? null,
            history,
            contributors: contributorsFrom(history)
          }
        })
        .filter((t): t is typeof t & { def: NonNullable<typeof t.def> } =>
          Boolean(t.def)
        )
    }),

  /*
   * Single-shot revision suggestion for the discussion page.
   *
   * Deliberately separate from the refinements router: that flow is a
   * multi-round negotiation scoped to a definition's own author. Here anyone
   * may ask for a suggestion on any current revision. Persist the exact model
   * result before showing it so publication cannot attach AI attribution to
   * client-altered text.
   */
  suggest: contributorProcedure
    .input(
      z.object({
        definitionId: z.number(),
        revisionId: z.number(),
        comment: z.string().trim().min(1).max(COMMENT_MAX_LENGTH)
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: { definitionId, revisionId, comment }
      }) => {
        const [original] = await db
          .select({
            currentRevisionId: definitionsTable.currentRevisionId,
            term: termsTable.term,
            definition: definitionsTable.definition,
            example: definitionsTable.example
          })
          .from(definitionsTable)
          .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
          .where(eq(definitionsTable.id, definitionId))

        if (!original)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No such definition"
          })
        if (original.currentRevisionId !== revisionId)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "A newer revision is available. Review it before requesting a suggestion."
          })

        const result = await runLLM(
          [
            {
              role: "user",
              content: `<term>\n${original.term}\n\n<definition>\n${original.definition}\n\n<example>\n${original.example}`
            },
            { role: "user", content: `<feedback>\n${comment}` }
          ],
          RefineSystemPrompt
        )

        if (!result)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The model returned an invalid response"
          })

        const [suggestion] = await db.transaction(async (tx) => {
          const [source] = await tx
            .select({ currentRevisionId: definitionsTable.currentRevisionId })
            .from(definitionsTable)
            .where(eq(definitionsTable.id, definitionId))
            .for("update")

          if (source?.currentRevisionId !== revisionId)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "The source definition changed while the suggestion was being generated. Request another suggestion from the current revision."
            })

          return tx
            .insert(discussionSuggestionsTable)
            .values({
              definitionId,
              revisionId,
              userId,
              comment: comment.trim(),
              suggestedDefinition: result.definition,
              suggestedExample: result.example,
              model: OllamaModel,
              prompt: RefineSystemPrompt
            })
            .returning()
        })

        return {
          suggestionId: suggestion.id,
          definition: suggestion.suggestedDefinition,
          example: suggestion.suggestedExample,
          model: suggestion.model
        }
      }
    ),

  /*
   * Publish an accepted suggestion as a new definition of the same term,
   * derived from the original and credited to the accepting user with the
   * model as coauthor. The comment that prompted it is recorded alongside, so
   * the rationale stays with the discussion.
   */
  acceptSuggestion: contributorProcedure
    .input(z.object({ suggestionId: z.number() }))
    .mutation(async ({ ctx: { userId }, input: { suggestionId } }) => {
      const preview = await db.query.discussionSuggestionsTable.findFirst({
        columns: { userId: true, model: true },
        where: eq(discussionSuggestionsTable.id, suggestionId)
      })
      if (!preview || preview.userId !== userId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No such pending suggestion"
        })

      const modelUser = await GetModelUser(preview.model)

      const created = await db.transaction(async (tx) => {
        const [suggestion] = await tx
          .select()
          .from(discussionSuggestionsTable)
          .where(eq(discussionSuggestionsTable.id, suggestionId))
          .for("update")

        if (!suggestion || suggestion.userId !== userId)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No such pending suggestion"
          })
        if (
          suggestion.acceptedAt !== null ||
          suggestion.outputDefinitionId !== null
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "This suggestion has already been published."
          })

        const [original] = await tx
          .select()
          .from(definitionsTable)
          .where(eq(definitionsTable.id, suggestion.definitionId))
          .for("update")

        if (!original)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "The source definition no longer exists."
          })
        if (original.currentRevisionId !== suggestion.revisionId)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The source definition changed. Request a new suggestion from the current revision."
          })

        await tx.insert(commentsTable).values({
          definitionId: suggestion.definitionId,
          revisionId: suggestion.revisionId,
          userId,
          message: suggestion.comment
        })

        const { definition: inserted } =
          await createDefinitionWithInitialRevision(tx, {
            termId: original.termId,
            authorId: userId,
            definition: suggestion.suggestedDefinition,
            example: suggestion.suggestedExample,
            changeNote: "Accepted an AI-assisted discussion suggestion",
            source: "ai_refinement",
            model: suggestion.model,
            prompt: suggestion.prompt,
            refinedFromId: original.id,
            derivedFromRevisionId: suggestion.revisionId,
            createdVia: "interactive"
          })

        await tx
          .insert(coauthorsTable)
          .values({ definitionId: inserted.id, userId: modelUser.id })

        await tx
          .update(discussionSuggestionsTable)
          .set({
            outputDefinitionId: inserted.id,
            acceptedAt: sql`now()`
          })
          .where(eq(discussionSuggestionsTable.id, suggestion.id))

        return inserted
      })

      revalidatePath("/discussion")
      await revalidatePublicDefinition({
        definitionId: created.id,
        definitionNumber: created.definitionNumber,
        termId: created.termId,
        version: 1
      })

      return created
    })
})
