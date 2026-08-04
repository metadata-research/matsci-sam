import { z } from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import {
  db,
  commentsTable,
  usersTable,
  definitionsTable,
  chatsTable,
  definitionRevisionsTable
} from "@yamz/db"
import { and, asc, eq, getTableColumns } from "drizzle-orm"
import { reviseDefinition } from "@/lib/apis/ollama"
import { after } from "next/server"
import { TRPCError } from "@trpc/server"
import { COMMENT_MAX_LENGTH } from "@/lib/input-limits"
import { contributorProcedure } from "../procedures"

export const commentsRouter = createTRPCRouter({
  get: baseProcedure.input(z.number()).query(async ({ input: id }) => {
    const comments = await db
      .select({
        ...getTableColumns(commentsTable),
        author: {
          id: usersTable.id,
          name: usersTable.name,
          isAi: usersTable.isAi,
          isProfilePublic: usersTable.isProfilePublic
        },
        version: definitionRevisionsTable.version
      })
      .from(commentsTable)
      .where(eq(commentsTable.definitionId, id))
      .innerJoin(usersTable, eq(commentsTable.userId, usersTable.id))
      .innerJoin(
        definitionRevisionsTable,
        eq(definitionRevisionsTable.id, commentsTable.revisionId)
      )
      .orderBy(asc(commentsTable.createdAt))

    return comments
  }),
  create: contributorProcedure
    .input(
      z.object({
        id: z.number(),
        revisionId: z.number(),
        comment: z.string().trim().min(1).max(COMMENT_MAX_LENGTH)
      })
    )
    .mutation(
      async ({ input: { id, revisionId, comment }, ctx: { userId } }) => {
        // Whether this comment scheduled a model revision of the definition,
        // so the client can say so instead of leaving the trigger invisible.
        let aiRevisionScheduled = false
        const insertedComment = await db.transaction(async (tx) => {
          const revision = await tx.query.definitionRevisionsTable.findFirst({
            columns: { id: true },
            where: and(
              eq(definitionRevisionsTable.id, revisionId),
              eq(definitionRevisionsTable.definitionId, id)
            )
          })
          if (!revision)
            throw new TRPCError({
              code: "NOT_FOUND",
              message:
                "The definition revision you commented on no longer exists."
            })

          const [insertedComment] = await tx
            .insert(commentsTable)
            .values({
              definitionId: id,
              revisionId,
              userId,
              message: comment
            })
            .returning()

          // fetch some info about this term
          const [definition] = await tx
            .select({
              isAi: usersTable.isAi,
              termId: definitionsTable.termId,
              id: definitionsTable.id,
              currentRevisionId: definitionsTable.currentRevisionId
            })
            .from(definitionsTable)
            .where(eq(definitionsTable.id, id))
            .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
            .limit(1)

          // if ai made, create feedback chat
          if (definition.isAi && definition.currentRevisionId === revisionId) {
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
            aiRevisionScheduled = true
          }

          return insertedComment
        })

        return { ...insertedComment, aiRevisionScheduled }
      }
    )
})
