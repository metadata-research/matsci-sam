import { requireStudyCandidate } from "@/lib/study-candidates"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { baseProcedure, createTRPCRouter } from "../init"
import { contributorProcedure } from "../procedures"
import { db, definitionRevisionsTable, votesTable } from "@yamz/db"
import { and, eq, sql } from "drizzle-orm"
import { activeCommunityFor } from "@/lib/community-queries"
import {
  castVote,
  StaleRevisionError,
  VoteTargetMissingError
} from "@/lib/participation"
import {
  expectedInstructionsSchema,
  lockParticipation,
  requireIncompleteStepForAct,
  requireOnePosition,
  requireStepForDefinitionAct
} from "./surveys"

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
        // The step of a walkthrough the vote is cast inside: the define step
        // of the term, where an upvote accepts a candidate and a downvote is
        // refused, or its review step.
        surveyStepId: z.number().int().optional(),
        expectedInstructions: expectedInstructionsSchema.optional()
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: {
          definitionId,
          revisionId,
          vote,
          surveyStepId,
          expectedInstructions
        }
      }) => {
        if (surveyStepId !== undefined && expectedInstructions === undefined)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Reload the walkthrough before voting."
          })
        const walkthrough =
          surveyStepId === undefined
            ? null
            : await requireStepForDefinitionAct(surveyStepId, userId, {
                kind: "vote",
                definitionId,
                vote
              })

        try {
          const [updatedDefinition] = await db.transaction(async (tx) => {
            const lockedWalkthrough =
              walkthrough && surveyStepId !== undefined
                ? await lockParticipation(
                    tx,
                    surveyStepId,
                    walkthrough.study.id,
                    userId,
                    expectedInstructions!
                  )
                : null
            if (lockedWalkthrough)
              await requireStudyCandidate(
                tx,
                lockedWalkthrough.study.id,
                definitionId
              )
            // One position per define step, taken by an upvote: checked in
            // the transaction that writes the vote, against the standing
            // vote castVote toggles on.
            if (lockedWalkthrough?.step.kind === "define")
              await requireOnePosition(tx, lockedWalkthrough.step, userId, {
                definitionId,
                revisionId,
                vote
              })
            else if (lockedWalkthrough?.step.kind === "review")
              await requireIncompleteStepForAct(
                tx,
                lockedWalkthrough.step.id,
                userId
              )

            // A session vote is a human act in the community the person is
            // working in: the community running the study when the vote is
            // cast inside a walkthrough step, and otherwise whatever the
            // header points at, resolved inside the transaction that writes
            // it.
            const communityId = lockedWalkthrough
              ? lockedWalkthrough.study.communityId
              : ((await activeCommunityFor(tx, userId))?.id ?? null)
            return castVote(tx, {
              definitionId,
              revisionId,
              userId,
              vote,
              actorKind: "human",
              communityId,
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
