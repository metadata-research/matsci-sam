import { db, definitionsTable, termsTable, votesTable } from "@yamz/db"
import { baseProcedure, createTRPCRouter } from "../init"
import { desc, eq } from "drizzle-orm"
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
          const [comments, edits] = await Promise.all([
            db.query.commentsTable.findMany({
              where: (c, { eq }) => eq(c.definitionId, definition.id)
            }),
            db.query.editsTable.findMany({
              where: (e, { eq }) => eq(e.definitionId, definition.id)
            })
          ])

          const history = [
            ...comments.map((c) => ({
              ...c,
              createdAt: new Date(
                new Date(c.createdAt).getTime() - 4 * 60 * 60 * 1000
              ),
              type: "comment" as const
            })),
            ...edits.map((e) => ({
              ...e,
              createdAt: e.editedAt,
              type: "edit" as const
            }))
          ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

          return {
            ...definition,
            isAi: definition.author?.isAi || false,
            vote: definition.votes?.length ? definition.votes[0].kind : null,
            history
          }
        })
      )

      return definitions
    })
})
