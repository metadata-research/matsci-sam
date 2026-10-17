import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import { db } from "@yamz/db"
import { createTRPCRouter } from "../init"
import { authenticatedProcedure, contributorProcedure } from "../procedures"
import { termDraftPayloadSchema } from "@/lib/term-draft-types"
import {
  createTermDraft,
  deleteTermDraft,
  getTermDraft,
  listTermDrafts,
  publishTermDraft,
  updateTermDraft
} from "@/lib/term-drafts"
import { revalidatePublicDefinition } from "@/lib/revalidate-public-definition"

const identity = z.object({ id: z.string().uuid() })
const versioned = identity.extend({
  expectedVersion: z.number().int().positive()
})
const privateProcedure = authenticatedProcedure.meta({ marksGraphs: false })

export const termDraftsRouter = createTRPCRouter({
  list: privateProcedure.query(({ ctx }) => listTermDrafts(db, ctx.userId)),
  get: privateProcedure
    .input(identity)
    .query(({ ctx, input }) => getTermDraft(db, input.id, ctx.userId)),
  create: privateProcedure
    .input(
      identity.extend({
        payload: termDraftPayloadSchema,
        expectedOwnerId: z.number().int().positive()
      })
    )
    .mutation(({ ctx, input }) => {
      if (input.expectedOwnerId !== ctx.userId)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Your signed-in account changed. This writing has not been saved to the new account. Reload or sign back in before continuing."
        })
      return db.transaction((tx) => createTermDraft(tx, input, ctx.userId))
    }),
  update: privateProcedure
    .input(
      versioned.extend({
        mutationId: z.string().uuid(),
        payload: termDraftPayloadSchema
      })
    )
    .mutation(({ ctx, input }) =>
      db.transaction((tx) => updateTermDraft(tx, input, ctx.userId))
    ),
  delete: privateProcedure
    .input(versioned)
    .mutation(({ ctx, input }) =>
      db.transaction((tx) => deleteTermDraft(tx, input, ctx.userId))
    ),
  publish: contributorProcedure
    .input(versioned)
    .mutation(async ({ ctx, input }) => {
      const result = await db
        .transaction((tx) => publishTermDraft(tx, input, ctx.userId))
        .catch((error: unknown) => {
          const code = error as { code?: string; cause?: { code?: string } }
          if (code.code === "23505" || code.cause?.code === "23505")
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "That term or address was just taken. Your draft is still saved; review its destination before trying again."
            })
          throw error
        })
      revalidatePath("/")
      revalidatePath("/terms")
      revalidatePath("/profile/drafts")
      revalidatePath("/collections", "layout")
      await revalidatePublicDefinition({
        definitionId: result.definition.id,
        definitionNumber: result.definition.definitionNumber,
        termId: result.term.id,
        version: 1
      })
      return result
    })
})
