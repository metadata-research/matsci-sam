import { TRPCError } from "@trpc/server"
import { db } from "@yamz/db"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createTRPCRouter, baseProcedure } from "../init"
import { adminProcedure, contributorProcedure } from "../procedures"
import { DEFINITION_MAX_LENGTH, TERM_MAX_LENGTH } from "@/lib/input-limits"
import { IMPORT_MAX_TEXT_LENGTH } from "@/lib/setup-import"
import {
  commitSetupImport,
  createSetupTerm,
  createSetupVocabulary,
  previewSetupImport,
  setupOptions
} from "@/lib/setup-service"
import {
  collectionPath,
  termPath,
  vocabularyPath
} from "@/lib/public-identifiers"

const vocabularySlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .max(200)
const importInput = z.object({
  vocabularySlug,
  text: z.string().min(1).max(IMPORT_MAX_TEXT_LENGTH),
  format: z.enum(["csv", "tsv"]),
  collectionId: z.number().int().positive().optional()
})

// A racing publication can occupy a label or permanent route after preview.
// Never turn that race into partial import or an overwrite.
function publicationError(error: unknown): never {
  const cause = error as { code?: string; cause?: { code?: string } }
  if (cause.code === "23505" || cause.cause?.code === "23505")
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "A term or vocabulary address was just taken. Preview or try again.",
      cause: error
    })
  throw error
}

export const setupRouter = createTRPCRouter({
  options: baseProcedure.query(({ ctx }) => setupOptions(ctx.userId ?? null)),
  createVocabulary: adminProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const vocabulary = await db
        .transaction((tx) => createSetupVocabulary(tx, input, ctx.userId))
        .catch(publicationError)
      revalidatePath("/vocabulary")
      return vocabulary
    }),
  previewImport: contributorProcedure
    .meta({ marksGraphs: false })
    .input(importInput)
    .mutation(({ ctx, input }) => previewSetupImport(db, input, ctx.userId)),
  importTerms: contributorProcedure
    .input(
      importInput.extend({ previewToken: z.string().regex(/^[a-f0-9]{64}$/) })
    )
    .mutation(async ({ ctx, input: { previewToken, ...input } }) => {
      const result = await db
        .transaction((tx) =>
          commitSetupImport(tx, input, previewToken, ctx.userId)
        )
        .catch(publicationError)
      revalidatePath("/")
      revalidatePath("/terms")
      revalidatePath(vocabularyPath(result.vocabularySlug))
      if (result.collectionSlug)
        revalidatePath(collectionPath(result.collectionSlug))
      for (const term of result.terms)
        revalidatePath(termPath(term.slug, term.vocabularySlug))
      return result
    }),
  createTerm: contributorProcedure
    .input(
      z.object({
        vocabularySlug,
        term: z.string().trim().min(1).max(TERM_MAX_LENGTH),
        definition: z.string().trim().min(1).max(DEFINITION_MAX_LENGTH),
        collectionId: z.number().int().positive().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const term = await db
        .transaction((tx) => createSetupTerm(tx, input, ctx.userId))
        .catch(publicationError)
      revalidatePath("/")
      revalidatePath("/terms")
      revalidatePath(vocabularyPath(term.vocabularySlug))
      revalidatePath(termPath(term.slug, term.vocabularySlug))
      if (input.collectionId) revalidatePath("/collections", "layout")
      return term
    })
})
