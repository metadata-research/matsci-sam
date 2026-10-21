import { z } from "zod"
import { DEFINITION_MAX_LENGTH, TERM_MAX_LENGTH } from "./input-limits"
import { CONTRIBUTION_LIMITS } from "./contribution-limits"

export const IMPORT_DRAFT_MAX_ROWS = 100
export const IMPORT_DRAFT_MAX_BYTES = 1_000_000
export const IMPORT_DRAFT_MAX_BATCHES = 10
export const IMPORT_DRAFT_PARSER_VERSION = "draft-csv-v1"
export const IMPORT_REVIEW_TTL_MS = 30 * 60 * 1000
export const importDecisionSchema = z.enum(["pending", "include", "omit"])
const text = (max: number) => z.string().trim().max(max).default("")
const declaredSourceSchema = z
  .object({
    title: text(1000),
    creator: text(1000),
    url: text(2048),
    version: text(200),
    license: text(1000)
  })
  .strict()

// These are contributor declarations, never provider lookup or AI identities.
export const importEvidenceSchema = z
  .object({
    publishOriginalWording: z.boolean().default(false),
    origin: declaredSourceSchema
      .extend({
        decision: importDecisionSchema
      })
      .nullable()
      .default(null),
    citations: z
      .array(
        declaredSourceSchema.extend({
          id: z.string().min(1).max(200),
          decision: importDecisionSchema
        })
      )
      .max(20)
      .default([]),
    ontology: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            iri: text(2048),
            label: text(1000),
            ontology: text(200),
            version: text(200),
            sourceUrl: text(2048),
            note: text(4000),
            decision: importDecisionSchema
          })
          .strict()
      )
      .max(20)
      .default([]),
    scopeNote: z
      .object({
        text: text(4000),
        decision: importDecisionSchema
      })
      .nullable()
      .default(null),
    sourceKeys: z
      .array(
        z
          .object({
            key: z.string().min(1).max(100),
            decision: importDecisionSchema,
            fileId: z.string().uuid().optional()
          })
          .strict()
      )
      .max(3)
      .default([])
  })
  .strict()
export type ImportEvidence = z.infer<typeof importEvidenceSchema>
export type DeclaredImportSource = z.infer<typeof declaredSourceSchema>

export const importDraftInputSchema = z.object({
  text: z.string().min(1).max(IMPORT_DRAFT_MAX_BYTES),
  format: z.enum(["csv", "tsv"]),
  vocabularySlug: z.string().min(1).max(200),
  collectionId: z.number().int().positive().optional(),
  ignoredColumns: z.array(z.string().max(100)).max(100).default([])
})
export type ImportDraftInput = z.infer<typeof importDraftInputSchema>
export const importDraftSelectionSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      expectedVersion: z.number().int().positive()
    })
  )
  .min(1)
  .max(CONTRIBUTION_LIMITS.definition.count)

export type ParsedDraftImportRow = {
  rowId: string
  record: number
  line: number
  term: string
  definition: string
  fields: Record<string, string>
  errors: string[]
}
export type DraftImportPreviewRow = ParsedDraftImportRow & {
  status: "new" | "existing" | "duplicate" | "error"
  message: string
  duplicateOf?: string
  existingTerm?: { id: number; slug: string; vocabularySlug: string }
  existingDraftId?: string
}
export type RevisionImportReceipt = {
  schemaVersion: 1
  parserVersion: string
  inputHash: string
  rowHash: string
  rowIdentity: string
  record: number
  importedAt: string
  importedById: number
  originalTerm: string
  originalDefinition: string
  /** Missing on older receipts means private; publication requires explicit opt-in. */
  publishOriginalWording?: boolean
  declaredOrigin: DeclaredImportSource | null
  ontology: ImportEvidence["ontology"]
  scopeNote: ImportEvidence["scopeNote"]
}
export const importRowWritingSchema = z.object({
  term: z.string().trim().min(1).max(TERM_MAX_LENGTH),
  definition: z.string().max(DEFINITION_MAX_LENGTH)
})
