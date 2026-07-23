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
    .input(voteTargetSchema.extend({ vote: z.enum(["up", "down"]) }))
    .mutation(
      async ({
        ctx: { userId },
        input: { definitionId, revisionId, vote }
      }) => {
        const [updatedDefinition] = await db.transaction(async (tx) => {
          const [definition] = await tx
            .select({
              id: definitionsTable.id,
              currentRevisionId: definitionsTable.currentRevisionId
            })
            .from(definitionsTable)
            .where(eq(definitionsTable.id, definitionId))
            .for("update")

          if (!definition)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Definition doesn't exist"
            })
          if (definition.currentRevisionId !== revisionId)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "A newer version is available. Review it before voting again."
            })

          const voteConstraint = and(
            eq(votesTable.userId, userId),
            eq(votesTable.revisionId, revisionId)
          )
          const existing = await tx.query.votesTable.findFirst({
            where: voteConstraint
          })
          const value = (kind: "up" | "down") => (kind === "up" ? 1 : -1)

          if (existing) {
            if (existing.kind === vote) {
              await tx.delete(votesTable).where(voteConstraint)
              return await tx
                .update(definitionsTable)
                .set({
                  score: sql`${definitionsTable.score} - ${value(vote)}`
                })
                .where(eq(definitionsTable.id, definitionId))
                .returning()
            }

            await tx
              .update(votesTable)
              .set({ kind: vote })
              .where(voteConstraint)

            return await tx
              .update(definitionsTable)
              .set({
                score: sql`${definitionsTable.score} + ${value(vote) - value(existing.kind)}`
              })
              .where(eq(definitionsTable.id, definitionId))
              .returning()
          }

          await tx.insert(votesTable).values({
            userId,
            definitionId,
            revisionId,
            kind: vote
          })

          return await tx
            .update(definitionsTable)
            .set({ score: sql`${definitionsTable.score} + ${value(vote)}` })
            .where(eq(definitionsTable.id, definitionId))
            .returning()
        })

        return { score: updatedDefinition.score, ok: true }
      }
    )
})
