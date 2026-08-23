import { z } from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import {
  aiModelsTable,
  db,
  commentsTable,
  usersTable,
  definitionsTable,
  chatsTable,
  definitionRevisionsTable
} from "@yamz/db"
import { asc, eq, getTableColumns } from "drizzle-orm"
import { reviseDefinition } from "@/lib/llm/definitions"
import { after } from "next/server"
import { TRPCError } from "@trpc/server"
import { COMMENT_MAX_LENGTH } from "@/lib/input-limits"
import { contributorProcedure } from "../procedures"
import { CommentRevisionMissingError, insertComment } from "@/lib/participation"
import { requireStepForDefinitionAct } from "./surveys"

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
        surveyStepId: z.number().int().optional()
      })
    )
    .mutation(
      async ({
        input: { id, revisionId, comment, surveyStepId },
        ctx: { userId }
      }) => {
        if (surveyStepId !== undefined)
          await requireStepForDefinitionAct(surveyStepId, userId, {
            kind: "comment",
            definitionId: id
          })

        // Whether this comment scheduled a model revision of the definition,
        // so the client can say so instead of leaving the trigger invisible —
        // and the version it was scheduled against, so the client can watch
        // for the revision landing.
        let aiRevisionScheduled = false
        let commentedVersion: number | null = null
        const insertedComment = await db.transaction(async (tx) => {
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

          // The definition and whether a model identity wrote it: a comment on
          // the model's own current text is feedback the model revises from.
          // A simulated participant is an AI-flag account without a model
          // identity, and its text is a person's text here, so a comment on
          // it schedules nothing.
          const [definition] = await tx
            .select({
              modelUserId: aiModelsTable.userId,
              termId: definitionsTable.termId,
              id: definitionsTable.id,
              currentRevisionId: definitionsTable.currentRevisionId
            })
            .from(definitionsTable)
            .where(eq(definitionsTable.id, id))
            .leftJoin(
              aiModelsTable,
              eq(aiModelsTable.userId, definitionsTable.authorId)
            )
            .limit(1)

          if (
            definition.modelUserId !== null &&
            definition.currentRevisionId === revisionId
          ) {
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
            commentedVersion = written.revisionVersion
          }

          return written.comment
        })

        return { ...insertedComment, aiRevisionScheduled, commentedVersion }
      }
    )
})
