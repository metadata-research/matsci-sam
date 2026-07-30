import {
  db,
  definitionRevisionsTable,
  definitionsTable,
  termsTable,
  votesTable
} from "@yamz/db"
import { baseProcedure, createTRPCRouter } from "../init"
import { asc, desc, eq } from "drizzle-orm"
import { z } from "zod"
import { buildTermProvenance } from "@/lib/provenance"

export const termsRouter = createTRPCRouter({
  // Public read-only PROV-O view; voter identities are withheld (the admin
  // endpoint admin.provenance keeps full detail)
  provenance: baseProcedure
    .input(z.number())
    .query(async ({ input: termId }) =>
      buildTermProvenance(termId, { anonymizeVoters: true })
    ),
  list: baseProcedure.query(async () => {
    const terms = await db
      .select({ value: termsTable.term, id: termsTable.id })
      .from(termsTable)

    return terms
  }),
  tree: baseProcedure
    .input(z.object({ termId: z.number() }))
    .query(async ({ input: { termId }, ctx: { userId } }) => {
      const baseDefinitions = await db.query.definitionsTable.findMany({
        where: (def, { eq }) => eq(def.termId, termId),
        with: {
          author: true,
          votes: userId ? { where: eq(votesTable.userId, userId) } : undefined
        },
        orderBy: desc(definitionsTable.score)
      })

      const definitions = await Promise.all(
        baseDefinitions.map(async (definition) => {
          const [comments, revisions] = await Promise.all([
            db.query.commentsTable.findMany({
              where: (c, { eq }) => eq(c.definitionId, definition.id)
            }),
            db.query.definitionRevisionsTable.findMany({
              where: eq(definitionRevisionsTable.definitionId, definition.id),
              orderBy: asc(definitionRevisionsTable.version)
            })
          ])

          const currentRevision = revisions.find(
            (revision) => revision.id === definition.currentRevisionId
          )
          if (!currentRevision)
            throw new Error(
              `Definition ${definition.id} has no current revision`
            )

          const versionsByRevisionId = new Map(
            revisions.map((revision) => [revision.id, revision.version])
          )

          const history = [
            ...comments.map((c) => ({
              ...c,
              version: versionsByRevisionId.get(c.revisionId) ?? null,
              createdAt: new Date(c.createdAt),
              type: "comment" as const
            })),
            ...revisions.map((revision) => ({
              id: revision.id,
              version: revision.version,
              definitionDiff: revision.definitionDiff,
              exampleDiff: revision.exampleDiff,
              changeNote: revision.changeNote,
              source: revision.source,
              legacyIncomplete: revision.legacyIncomplete,
              createdAt: new Date(revision.createdAt),
              type: "revision" as const
            }))
          ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

          return {
            ...definition,
            revisionId: currentRevision.id,
            version: currentRevision.version,
            isAi: definition.author?.isAi || false,
            vote:
              definition.votes?.find(
                (vote) => vote.revisionId === currentRevision.id
              )?.kind ?? null,
            history
          }
        })
      )

      return definitions
    })
})
