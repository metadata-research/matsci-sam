import { z } from "zod"
import { SOURCE_MAX_SELECTED_PASSAGES } from "./source-document-types"

const sourceLocationSchema = z.object({
  page: z.number().int().positive().nullable(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  method: z.enum(["embedded", "ocr", "docx", "text"]),
  label: z.string().max(500)
})

/** Restoration data only; the server replaces it from the stored generation. */
export const sourceInputSnapshotSchema = z.object({
  fileId: z.string().uuid(),
  extractionId: z.string().uuid(),
  checkId: z.string().uuid(),
  title: z.string().max(200),
  origin: z.enum(["upload", "paste"]),
  fileHash: z.string().max(200),
  extractionTextHash: z.string().max(200),
  text: z.string().max(24000),
  textHash: z.string().max(200),
  mode: z.enum(["passages", "full"]),
  term: z.string().max(200),
  aliases: z.array(z.string().max(200)).max(20),
  matches: z
    .array(
      z.object({
        id: z.string().max(200),
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        text: z.string().max(1000),
        matchedTerm: z.string().max(200),
        isAlias: z.boolean(),
        page: z.number().int().positive().nullable()
      })
    )
    .max(10000),
  locations: z.array(sourceLocationSchema).max(10000),
  parserVersion: z.string().max(200),
  method: z.string().max(200).optional(),
  hasOcr: z.boolean(),
  ocrReviewed: z.boolean(),
  extractedAt: z.string().max(100),
  checkedAt: z.string().max(100),
  matcherVersion: z.string().max(200),
  ocrReviewRecordedAt: z.string().max(100).nullable(),
  reviewerId: z.number().int().positive().nullable(),
  contextSelectedAt: z.string().max(100),
  extractionSteps: z
    .array(
      z.object({
        id: z.string().uuid(),
        parentExtractionId: z.string().uuid().nullable(),
        correctedById: z.number().int().positive().nullable(),
        textHash: z.string().max(200),
        parserVersion: z.string().max(200),
        method: z.string().max(200),
        hasOcr: z.boolean(),
        completedAt: z.string().max(100)
      })
    )
    .max(100)
    .optional()
})

export const sourceContextSelectionSchema = z.object({
  fileId: z.string().uuid(),
  checkId: z.string().uuid(),
  mode: z.enum(["passages", "full"]),
  passageIds: z.array(z.string().max(200)).max(SOURCE_MAX_SELECTED_PASSAGES),
  ocrReviewed: z.boolean()
})

export const sourceContextSelectionsSchema = z
  .array(sourceContextSelectionSchema)
  .max(3)
  .refine(
    (items) => new Set(items.map((item) => item.fileId)).size === items.length,
    "Select each source only once."
  )
