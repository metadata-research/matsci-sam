import { z } from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import {
  commentsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  termsTable,
  usersTable
} from "@yamz/db"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { diffToStringSimple } from "@/lib/definition-revisions"
import { currentFeaturedExampleText } from "@/lib/definition-example-queries"

/*
 * Feed for the /discussion page: the most-recent terms, each paired with the
 * definition a comment should attach to.
 *
 * The feed keeps a consistent discussion target for each term: its model draft
 * when one exists, otherwise its highest-supported definition. Commenting is a
 * comment-only act; requesting an AI revision remains an explicit action.
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
          example: currentFeaturedExampleText().as("example"),
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
              body: diffToStringSimple(revision.definitionDiff),
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
    })
})
