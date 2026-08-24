import { z } from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import {
  db,
  commentsTable,
  usersTable,
  definitionRevisionsTable
} from "@yamz/db"
import { asc, eq, getTableColumns } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { COMMENT_MAX_LENGTH } from "@/lib/input-limits"
import { contributorProcedure } from "../procedures"
import { CommentRevisionMissingError, insertComment } from "@/lib/participation"
import {
  expectedInstructionsSchema,
  lockParticipation,
  requireStepForDefinitionAct
} from "./surveys"

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
        comment: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
        // The review step of a walkthrough the comment is posted inside.
        surveyStepId: z.number().int().optional(),
        expectedInstructions: expectedInstructionsSchema.optional()
      })
    )
    .mutation(
      async ({
        input: { id, revisionId, comment, surveyStepId, expectedInstructions },
        ctx: { userId }
      }) => {
        if (surveyStepId !== undefined && expectedInstructions === undefined)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Reload the walkthrough before commenting."
          })
        const walkthrough =
          surveyStepId === undefined
            ? null
            : await requireStepForDefinitionAct(surveyStepId, userId, {
                kind: "comment",
                definitionId: id
              })

        const insertedComment = await db.transaction(async (tx) => {
          if (walkthrough && surveyStepId !== undefined)
            await lockParticipation(
              tx,
              surveyStepId,
              walkthrough.study.id,
              userId,
              expectedInstructions!
            )
          let written
          try {
            // A session comment is a human act; the table CHECK refuses a
            // stamp on it, and the AI flag agreement is proven at release.
            written = await insertComment(tx, {
              definitionId: id,
              revisionId,
              userId,
              message: comment,
              actorKind: "human",
              surveyStepId: surveyStepId ?? null
            })
          } catch (error) {
            if (error instanceof CommentRevisionMissingError)
              throw new TRPCError({ code: "NOT_FOUND", message: error.message })
            throw error
          }

          return written.comment
        })

        return insertedComment
      }
    )
})
