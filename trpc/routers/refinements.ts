import { z } from "zod"
import { createTRPCRouter } from "../init"
import { authenticatedProcedure } from "../procedures"
import {
  db,
  definitionsTable,
  refinementsTable,
  coauthorsTable,
  editsTable
} from "@yamz/db"
import { and, asc, eq, sql } from "drizzle-orm"
import { runRefinementRound } from "@/lib/apis/ollama"
import { GetModelUser } from "@/lib/crud"
import { after } from "next/server"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"

// Refinement is only offered on definitions the caller authored, and only on
// originals — refined versions (refinedFromId set) are end products.
const getOwnedOriginal = async (userId: number, definitionId: number) => {
  const def = await db.query.definitionsTable.findFirst({
    where: and(
      eq(definitionsTable.id, definitionId),
      eq(definitionsTable.authorId, userId)
    )
  })

  if (!def)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Definition doesn't exist or isn't yours"
    })

  if (def.refinedFromId !== null)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Refined definitions can't be refined again"
    })

  return def
}

export const refinementsRouter = createTRPCRouter({
  list: authenticatedProcedure
    .input(z.object({ definitionId: z.number() }))
    .query(async ({ ctx: { userId }, input: { definitionId } }) => {
      await getOwnedOriginal(userId, definitionId)

      return await db.query.refinementsTable.findMany({
        where: eq(refinementsTable.definitionId, definitionId),
        orderBy: asc(refinementsTable.round)
      })
    }),

  request: authenticatedProcedure
    .input(z.object({ definitionId: z.number(), comment: z.string().optional() }))
    .mutation(async ({ ctx: { userId }, input: { definitionId, comment } }) => {
      await getOwnedOriginal(userId, definitionId)

      const round = await db.transaction(async (tx) => {
        const rounds = await tx.query.refinementsTable.findMany({
          where: eq(refinementsTable.definitionId, definitionId)
        })

        if (rounds.some((r) => r.status === "pending"))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A refinement is already in progress"
          })

        // Re-evaluation is always a response to the standing suggestion, so
        // it needs the author's feedback; round 1 starts from nothing.
        const open = rounds.find((r) => r.status === "suggested")
        if (open && !comment?.trim())
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Give feedback on the current suggestion to re-evaluate"
          })

        if (open)
          await tx
            .update(refinementsTable)
            .set({ status: "superseded", decidedAt: sql`now()` })
            .where(eq(refinementsTable.id, open.id))

        const [inserted] = await tx
          .insert(refinementsTable)
          .values({
            definitionId,
            round: Math.max(0, ...rounds.map((r) => r.round)) + 1,
            userComment: comment?.trim() || null
          })
          .returning()

        return inserted
      })

      after(() => runRefinementRound(round.id))

      return round
    }),

  accept: authenticatedProcedure
    .input(z.object({ refinementId: z.number() }))
    .mutation(async ({ ctx: { userId }, input: { refinementId } }) => {
      const round = await db.query.refinementsTable.findFirst({
        where: eq(refinementsTable.id, refinementId)
      })
      if (!round)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such round" })

      const original = await getOwnedOriginal(userId, round.definitionId)

      if (round.status !== "suggested")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Round is "${round.status}", only a suggestion can be accepted`
        })
      if (!round.suggestedDefinition || !round.suggestedExample || !round.model)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Suggested round is missing its suggestion"
        })

      const modelUser = await GetModelUser(round.model)

      const refined = await db.transaction(async (tx) => {
        await tx
          .update(refinementsTable)
          .set({ status: "accepted", decidedAt: sql`now()` })
          .where(eq(refinementsTable.id, round.id))

        // One refined definition per original: later acceptances update it
        // through the edit path so the version history stays derivable.
        const existing = await tx.query.definitionsTable.findFirst({
          where: eq(definitionsTable.refinedFromId, original.id)
        })

        if (existing) {
          const [updated] = await tx
            .update(definitionsTable)
            .set({
              definition: round.suggestedDefinition!,
              example: round.suggestedExample!,
              model: round.model,
              prompt: round.promptText
            })
            .where(eq(definitionsTable.id, existing.id))
            .returning()

          await tx.insert(editsTable).values({
            definitionId: existing.id,
            definition: existing.definition,
            newDefinition: round.suggestedDefinition!
          })

          return updated
        }

        const [inserted] = await tx
          .insert(definitionsTable)
          .values({
            termId: original.termId,
            authorId: userId,
            definition: round.suggestedDefinition!,
            example: round.suggestedExample!,
            model: round.model,
            prompt: round.promptText,
            refinedFromId: original.id,
            createdVia: "interactive"
          })
          .returning()

        await tx
          .insert(coauthorsTable)
          .values({ definitionId: inserted.id, userId: modelUser.id })

        return inserted
      })

      revalidatePath("/terms")
      revalidatePath(`/terms/${original.termId}`)
      revalidatePath(`/definition/${refined.id}`)

      return refined
    }),

  keep: authenticatedProcedure
    .input(z.object({ refinementId: z.number() }))
    .mutation(async ({ ctx: { userId }, input: { refinementId } }) => {
      const round = await db.query.refinementsTable.findFirst({
        where: eq(refinementsTable.id, refinementId)
      })
      if (!round)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such round" })

      await getOwnedOriginal(userId, round.definitionId)

      if (round.status !== "suggested")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Round is "${round.status}", only a suggestion can be kept`
        })

      const [updated] = await db
        .update(refinementsTable)
        .set({ status: "kept", decidedAt: sql`now()` })
        .where(eq(refinementsTable.id, round.id))
        .returning()

      return updated
    }),

  retry: authenticatedProcedure
    .input(z.object({ refinementId: z.number() }))
    .mutation(async ({ ctx: { userId }, input: { refinementId } }) => {
      const round = await db.query.refinementsTable.findFirst({
        where: eq(refinementsTable.id, refinementId)
      })
      if (!round)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such round" })

      await getOwnedOriginal(userId, round.definitionId)

      if (round.status !== "failed")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Round is "${round.status}", only a failed round can be retried`
        })

      const [updated] = await db
        .update(refinementsTable)
        .set({ status: "pending", errorMessage: null, suggestedAt: null })
        .where(eq(refinementsTable.id, round.id))
        .returning()

      after(() => runRefinementRound(round.id))

      return updated
    })
})
