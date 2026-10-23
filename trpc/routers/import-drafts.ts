import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import { db } from "@yamz/db"
import { createTRPCRouter } from "../init"
import { authenticatedProcedure, contributorProcedure } from "../procedures"
import {
  importDraftInputSchema,
  importDraftSelectionSchema
} from "@/lib/import-draft-types"
import {
  previewImportDrafts,
  createImportDrafts,
  getImportDrafts,
  listImportDrafts,
  reviewImportDrafts,
  publishImportDrafts,
  archiveImportDrafts,
  publicationAllowance
} from "@/lib/import-drafts"
import { revalidatePublicDefinition } from "@/lib/revalidate-public-definition"

const privateProcedure = authenticatedProcedure.meta({ marksGraphs: false })
const identity = z.object({ id: z.string().uuid() })
export const importDraftsRouter = createTRPCRouter({
  preview: privateProcedure
    .input(importDraftInputSchema)
    .mutation(({ ctx, input }) => previewImportDrafts(db, input, ctx.userId)),
  create: privateProcedure
    .input(
      importDraftInputSchema.extend({
        id: z.string().uuid(),
        name: z.string().trim().max(200).optional(),
        expectedOwnerId: z.number().int().positive(),
        selectedRowIds: z.array(z.string().min(1).max(200)).min(1).max(50)
      })
    )
    .mutation(({ ctx, input }) => {
      if (ctx.userId !== input.expectedOwnerId)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Your signed-in account changed. Reload before saving this import."
        })
      const creation = {
        ...importDraftInputSchema.parse(input),
        id: input.id,
        name: input.name,
        selectedRowIds: input.selectedRowIds
      }
      return db.transaction((tx) =>
        createImportDrafts(tx, creation, ctx.userId)
      )
    }),
  list: privateProcedure
    .input(
      z
        .object({
          vocabularySlug: z
            .string()
            .regex(/^[a-z0-9][a-z0-9_-]*$/)
            .max(200)
            .optional()
        })
        .strict()
        .optional()
    )
    .query(({ ctx, input }) => listImportDrafts(db, ctx.userId, input)),
  get: privateProcedure
    .input(identity)
    .query(({ ctx, input }) => getImportDrafts(db, input.id, ctx.userId)),
  allowance: privateProcedure.query(({ ctx }) =>
    publicationAllowance(db, ctx.userId)
  ),
  review: privateProcedure
    .input(identity.extend({ drafts: importDraftSelectionSchema }))
    .mutation(({ ctx, input }) =>
      db.transaction((tx) => reviewImportDrafts(tx, input, ctx.userId))
    ),
  publish: contributorProcedure
    .input(identity.extend({ reviewToken: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await db
        .transaction((tx) => publishImportDrafts(tx, input, ctx.userId))
        .catch((error: unknown) => {
          const code = error as { code?: string; cause?: { code?: string } }
          if (code.code === "23505" || code.cause?.code === "23505")
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "A selected term was just published elsewhere. All selected drafts are still saved; review them again."
            })
          throw error
        })
      revalidatePath("/")
      revalidatePath("/terms")
      revalidatePath("/profile/drafts", "layout")
      revalidatePath("/collections", "layout")
      for (const publication of result.publications)
        await revalidatePublicDefinition({
          definitionId: publication.definition.id,
          definitionNumber: publication.definition.definitionNumber,
          termId: publication.term.id,
          version: 1
        })
      return result
    }),
  archive: privateProcedure
    .input(identity)
    .mutation(({ ctx, input }) =>
      db.transaction((tx) => archiveImportDrafts(tx, input.id, ctx.userId))
    )
})
