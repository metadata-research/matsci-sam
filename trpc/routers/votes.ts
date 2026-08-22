import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { baseProcedure, createTRPCRouter } from "../init"
import { contributorProcedure } from "../procedures"
import {
  db,
  definitionRevisionsTable,
  definitionsTable,
  votesTable
} from "@yamz/db"
import { and, eq, sql } from "drizzle-orm"
import { activeCommunityFor } from "@/lib/community-queries"
import {
  castVote,
  StaleRevisionError,
  VoteTargetMissingError
} from "@/lib/participation"
import { requireStepForAct } from "./surveys"

const voteTargetSchema = z.object({
  definitionId: z.number(),
  revisionId: z.number()
})

export const votesRouter = createTRPCRouter({
  get: baseProcedure
    .input(voteTargetSchema)
    .query(async ({ ctx: { userId }, input: { definitionId, revisionId } }) => {
      const [data] = await db
        .select({
          score:
            sql<number>`coalesce(sum(case when ${votesTable.kind} = 'up' then 1 when ${votesTable.kind} = 'down' then -1 else 0 end), 0)`
              .mapWith(Number)
              .as("score"),
          vote: userId
            ? sql<
                "up" | "down" | null
              >`max(case when ${votesTable.userId} = ${userId} then ${votesTable.kind} else null end)`.as(
                "vote"
              )
            : sql<"up" | "down" | null>`null`.as("vote")
        })
        .from(definitionRevisionsTable)
        .leftJoin(
          votesTable,
          eq(votesTable.revisionId, definitionRevisionsTable.id)
        )
        .where(
          and(
            eq(definitionRevisionsTable.id, revisionId),
            eq(definitionRevisionsTable.definitionId, definitionId)
          )
        )
        .groupBy(definitionRevisionsTable.id)

      if (!data)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No such definition revision"
        })

      return data
    }),
  vote: contributorProcedure
    .input(
      voteTargetSchema.extend({
        vote: z.enum(["up", "down"]),
        // The review step of a walkthrough the vote is cast inside.
        surveyStepId: z.number().int().optional()
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: { definitionId, revisionId, vote, surveyStepId }
      }) => {
        // A step is checked against the act before anything is written: the
        // caller may take part, and the step is the review step of this
        // term.
        if (surveyStepId !== undefined) {
          const target = await db.query.definitionsTable.findFirst({
            columns: { termId: true },
            where: eq(definitionsTable.id, definitionId)
          })
          if (!target)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Definition doesn't exist"
            })
          await requireStepForAct(surveyStepId, userId, {
            kind: "vote",
            termId: target.termId
          })
        }

        try {
          const [updatedDefinition] = await db.transaction(async (tx) => {
            // A session vote is a human act in whatever community the person
            // is working in right now, resolved inside the transaction that
            // writes it.
            const community = await activeCommunityFor(tx, userId)
            return castVote(tx, {
              definitionId,
              revisionId,
              userId,
              vote,
              actorKind: "human",
              communityId: community?.id ?? null,
              surveyStepId: surveyStepId ?? null
            })
          })

          return { score: updatedDefinition.score, ok: true }
        } catch (error) {
          if (error instanceof VoteTargetMissingError)
            throw new TRPCError({ code: "NOT_FOUND", message: error.message })
          if (error instanceof StaleRevisionError)
            throw new TRPCError({ code: "CONFLICT", message: error.message })
          throw error
        }
      }
    )
})
