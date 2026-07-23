import { z } from "zod"
import { createTRPCRouter } from "../init"
import { authenticatedProcedure } from "../procedures"
import {
  db,
  definitionRevisionsTable,
  definitionsTable,
  refinementsTable,
  coauthorsTable
} from "@yamz/db"
import { and, asc, eq, sql } from "drizzle-orm"
import { runRefinementRound } from "@/lib/apis/ollama"
import { GetModelUser } from "@/lib/crud"
import { after } from "next/server"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import {
  createDefinitionWithInitialRevision,
  publishDefinitionRevision,
  RevisionConflictError,
  RevisionNoChangeError
} from "@/lib/definition-revisions"
import { COMMENT_MAX_LENGTH } from "@/lib/input-limits"

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
    .input(
      z.object({
        definitionId: z.number(),
        expectedRevisionId: z.number(),
        comment: z.string().max(COMMENT_MAX_LENGTH).optional()
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: { definitionId, expectedRevisionId, comment }
      }) => {
        const round = await db.transaction(async (tx) => {
          const [source] = await tx
            .select({
              currentRevisionId: definitionsTable.currentRevisionId,
              authorId: definitionsTable.authorId,
              refinedFromId: definitionsTable.refinedFromId
            })
            .from(definitionsTable)
            .where(eq(definitionsTable.id, definitionId))
            .for("update")

          if (
            !source ||
            source.authorId !== userId ||
            source.refinedFromId !== null
          )
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Definition doesn't exist or isn't yours"
            })

          if (source?.currentRevisionId !== expectedRevisionId)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This definition changed after you opened it. Review the current version before refining it."
            })

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
              sourceRevisionId: expectedRevisionId,
              round: Math.max(0, ...rounds.map((r) => r.round)) + 1,
              userComment: comment?.trim() || null
            })
            .returning()

          return inserted
        })

        after(() => runRefinementRound(round.id))

        return round
      }
    ),

  accept: authenticatedProcedure
    .input(z.object({ refinementId: z.number() }))
    .mutation(async ({ ctx: { userId }, input: { refinementId } }) => {
      const preview = await db.query.refinementsTable.findFirst({
        where: eq(refinementsTable.id, refinementId)
      })
      if (!preview)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such round" })
      await getOwnedOriginal(userId, preview.definitionId)
      if (
        preview.status !== "suggested" ||
        !preview.suggestedDefinition ||
        !preview.suggestedExample ||
        !preview.model
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Round is "${preview.status}", only a complete suggestion can be accepted`
        })
      const modelUser = await GetModelUser(preview.model)

      const refined = await db.transaction(async (tx) => {
        const [original] = await tx
          .select()
          .from(definitionsTable)
          .where(eq(definitionsTable.id, preview.definitionId))
          .for("update")
        if (
          !original ||
          original.authorId !== userId ||
          original.refinedFromId !== null
        )
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Definition doesn't exist or isn't yours"
          })

        const [round] = await tx
          .select()
          .from(refinementsTable)
          .where(eq(refinementsTable.id, refinementId))
          .for("update")
        if (!round || round.definitionId !== original.id)
          throw new TRPCError({ code: "NOT_FOUND", message: "No such round" })

        if (round.status !== "suggested")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Round is "${round.status}", only a suggestion can be accepted`
          })
        if (
          !round.suggestedDefinition ||
          !round.suggestedExample ||
          !round.model
        )
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Suggested round is missing its suggestion"
          })
        if (original.currentRevisionId !== round.sourceRevisionId)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The source definition changed during this refinement round. Start a new round from the current version."
          })

        await tx
          .update(refinementsTable)
          .set({ status: "accepted", decidedAt: sql`now()` })
          .where(eq(refinementsTable.id, round.id))

        // One refined definition per original: later acceptances update it
        // through the edit path so the version history stays derivable.
        const existing = await tx.query.definitionsTable.findFirst({
          where: and(
            eq(definitionsTable.refinedFromId, original.id),
            eq(definitionsTable.authorId, userId),
            sql`exists (
              select 1
              from ${definitionRevisionsTable} artifact_revision
              where artifact_revision."definitionId" = ${definitionsTable.id}
                and artifact_revision."sourceRefinementId" is not null
            )`
          )
        })

        if (existing) {
          try {
            const { definition } = await publishDefinitionRevision(tx, {
              definitionId: existing.id,
              editorId: userId,
              definition: round.suggestedDefinition!,
              example: round.suggestedExample!,
              changeNote: `Accepted AI refinement round ${round.round}`,
              source: "ai_refinement",
              expectedRevisionId: existing.currentRevisionId ?? undefined,
              model: round.model,
              prompt: round.promptText,
              derivedFromRevisionId: round.sourceRevisionId,
              sourceRefinementId: round.id
            })
            await tx
              .insert(coauthorsTable)
              .values({ definitionId: definition.id, userId: modelUser.id })
              .onConflictDoNothing()
            return definition
          } catch (error) {
            if (error instanceof RevisionConflictError)
              throw new TRPCError({
                code: "CONFLICT",
                message: error.message
              })
            if (error instanceof RevisionNoChangeError)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "This suggestion matches the current refined definition, so no new version was published."
              })
            throw error
          }
        }

        const { definition: inserted } =
          await createDefinitionWithInitialRevision(tx, {
            termId: original.termId,
            authorId: userId,
            definition: round.suggestedDefinition!,
            example: round.suggestedExample!,
            changeNote: `Accepted AI refinement round ${round.round}`,
            source: "ai_refinement",
            model: round.model,
            prompt: round.promptText,
            refinedFromId: original.id,
            derivedFromRevisionId: round.sourceRevisionId,
            sourceRefinementId: round.id,
            createdVia: "interactive"
          })

        await tx
          .insert(coauthorsTable)
          .values({ definitionId: inserted.id, userId: modelUser.id })

        return inserted
      })

      revalidatePath("/terms")
      revalidatePath(`/definition/${refined.id}`)

      return refined
    }),

  keep: authenticatedProcedure
    .input(z.object({ refinementId: z.number() }))
    .mutation(async ({ ctx: { userId }, input: { refinementId } }) => {
      const preview = await db.query.refinementsTable.findFirst({
        columns: { definitionId: true },
        where: eq(refinementsTable.id, refinementId)
      })
      if (!preview)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such round" })
      await getOwnedOriginal(userId, preview.definitionId)

      return db.transaction(async (tx) => {
        const [original] = await tx
          .select()
          .from(definitionsTable)
          .where(eq(definitionsTable.id, preview.definitionId))
          .for("update")
        if (
          !original ||
          original.authorId !== userId ||
          original.refinedFromId !== null
        )
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Definition doesn't exist or isn't yours"
          })

        const [round] = await tx
          .select()
          .from(refinementsTable)
          .where(eq(refinementsTable.id, refinementId))
          .for("update")
        if (!round || round.definitionId !== original.id)
          throw new TRPCError({ code: "NOT_FOUND", message: "No such round" })

        if (round.status !== "suggested")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Round is "${round.status}", only a suggestion can be kept`
          })
        if (original.currentRevisionId !== round.sourceRevisionId)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The source definition changed during this refinement round. Start a new round from the current version."
          })

        const [updated] = await tx
          .update(refinementsTable)
          .set({ status: "kept", decidedAt: sql`now()` })
          .where(eq(refinementsTable.id, round.id))
          .returning()

        return updated
      })
    }),

  retry: authenticatedProcedure
    .input(z.object({ refinementId: z.number() }))
    .mutation(async ({ ctx: { userId }, input: { refinementId } }) => {
      const preview = await db.query.refinementsTable.findFirst({
        columns: { definitionId: true },
        where: eq(refinementsTable.id, refinementId)
      })
      if (!preview)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such round" })
      await getOwnedOriginal(userId, preview.definitionId)

      const updated = await db.transaction(async (tx) => {
        const [original] = await tx
          .select()
          .from(definitionsTable)
          .where(eq(definitionsTable.id, preview.definitionId))
          .for("update")
        if (
          !original ||
          original.authorId !== userId ||
          original.refinedFromId !== null
        )
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Definition doesn't exist or isn't yours"
          })

        const [round] = await tx
          .select()
          .from(refinementsTable)
          .where(eq(refinementsTable.id, refinementId))
          .for("update")
        if (!round || round.definitionId !== original.id)
          throw new TRPCError({ code: "NOT_FOUND", message: "No such round" })

        if (round.status !== "failed")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Round is "${round.status}", only a failed round can be retried`
          })
        if (original.currentRevisionId !== round.sourceRevisionId)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The source definition changed during this refinement round. Start a new round from the current version."
          })

        const [retried] = await tx
          .update(refinementsTable)
          .set({ status: "pending", errorMessage: null, suggestedAt: null })
          .where(eq(refinementsTable.id, round.id))
          .returning()

        return retried
      })

      after(() => runRefinementRound(updated.id))

      return updated
    })
})
