import { z } from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import {
  db,
  commentsTable,
  usersTable,
  definitionsTable,
  chatsTable
} from "@yamz/db"
import { asc, eq, getTableColumns } from "drizzle-orm"
import { authenticatedProcedure } from "../procedures"
import { reviseDefinition } from "@/lib/apis/ollama"
import { after } from "next/server"

export const commentsRouter = createTRPCRouter({
  get: baseProcedure.input(z.number()).query(async ({ input: id }) => {
    const comments = await db
      .select({
        ...getTableColumns(commentsTable),
        author: {
          name: usersTable.name
        }
      })
      .from(commentsTable)
      .where(eq(commentsTable.definitionId, id))
      .innerJoin(usersTable, eq(commentsTable.userId, usersTable.id))
      .orderBy(asc(commentsTable.createdAt))

    return comments
  }),
  create: authenticatedProcedure
    .input(z.object({ id: z.number(), comment: z.string().nonempty() }))
    .mutation(async ({ input: { id, comment }, ctx: { userId } }) => {
      const insertedComment = await db.transaction(async (tx) => {
        const [insertedComment] = await tx
          .insert(commentsTable)
          .values({
            definitionId: id,
            userId,
            message: comment
          })
          .returning()

        // fetch some info about this term
        const [definition] = await tx
          .select({
            isAi: usersTable.isAi,
            termId: definitionsTable.termId,
            id: definitionsTable.id
          })
          .from(definitionsTable)
          .where(eq(definitionsTable.id, id))
          .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
          .limit(1)

        // if ai made, create feedback chat
        if (definition.isAi) {
          await tx.insert(chatsTable).values({
            role: "user",
            userId,
            message: `<feedback>\n${comment}`,
            termId: definition.termId
          })

          after(() =>
            // Revise our definition with the new comment
            reviseDefinition(definition.termId)
          )
        }

        return insertedComment
      })

      return insertedComment
    })
})
