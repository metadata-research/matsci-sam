import { z } from "zod"
import {
  sourceContextSelectionsSchema,
  sourceInputSnapshotSchema
} from "./source-document-selection"
import {
  DEFINITION_MAX_LENGTH,
  EXAMPLE_MAX_LENGTH,
  TERM_MAX_LENGTH
} from "./input-limits"

export const TERM_DRAFT_MAX_COUNT = 50
export const TERM_DRAFT_MAX_CHARACTERS = 262144
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(jsonValue)
  ])
)
const editorReference = z.object({
  lookupId: z.string().uuid(),
  citedReferenceIds: z.array(z.string().uuid()).max(5),
  modelReferenceIds: z.array(z.string().uuid()).max(20),
  term: z.string().max(TERM_MAX_LENGTH),
  provider: z.enum(["chebi", "wolfram"])
})
const writingSnapshot = z.object({
  definition: z.string().max(DEFINITION_MAX_LENGTH),
  references: z.array(editorReference).max(20)
})
// UI snapshots are private restoration data, never publication provenance.
// Suggestion fields are hydrated from the owner's stored generation on read.
const modelSnapshot = z
  .object({
    suggestionId: z.number().int().positive(),
    term: z.string().max(TERM_MAX_LENGTH),
    contextKey: z.string().max(2000),
    definition: z.string().max(DEFINITION_MAX_LENGTH).optional(),
    model: z.string().max(500).optional(),
    assistantProfile: z.enum(["default", "agent-one"]).optional(),
    assistantLabel: z.string().max(500).optional(),
    inference: jsonValue.optional(),
    referenceCount: z.number().int().nonnegative().optional(),
    referenceInputs: z.array(jsonValue).max(20).optional(),
    sourceInputs: z.array(sourceInputSnapshotSchema).max(3).optional(),
    requestInputs: jsonValue.optional(),
    baseline: writingSnapshot,
    promptInputs: z
      .array(
        z.object({
          id: z.string().max(200),
          label: z.string().max(500),
          text: z.string().max(50000),
          included: z.boolean(),
          required: z.boolean().optional()
        })
      )
      .max(30)
  })
  .catchall(jsonValue)
export const termDraftEditorStateSchema = z.object({
  step: z.enum(["confirm", "write", "review"]),
  confirmed: z
    .object({
      term: z.string().max(TERM_MAX_LENGTH),
      vocabularySlug: z.string().max(200).optional(),
      vocabularyTitle: z.string().max(500).optional()
    })
    .nullable(),
  references: z.array(editorReference).max(20),
  preview: modelSnapshot.nullable(),
  appliedDraft: modelSnapshot.nullable(),
  undo: writingSnapshot
    .extend({
      kind: z.enum(["source", "model"]),
      appliedDraft: modelSnapshot.nullable(),
      label: z.string().max(500)
    })
    .nullable(),
  includeDefinition: z.boolean(),
  includeExample: z.boolean(),
  exampleOpen: z.boolean().optional(),
  assistantOpen: z.boolean().optional(),
  assistantProfile: z.enum(["default", "agent-one"]).optional()
})
export const termDraftPayloadSchema = z
  .object({
    version: z.literal(1),
    term: z.string().max(TERM_MAX_LENGTH),
    definition: z.string().max(DEFINITION_MAX_LENGTH),
    initialExample: z.string().max(EXAMPLE_MAX_LENGTH),
    vocabularySlug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]*$/)
      .max(200)
      .nullable(),
    collectionId: z.number().int().positive().nullable(),
    references: z
      .array(
        z.object({
          lookupId: z.string().uuid(),
          citedReferenceIds: z.array(z.string().uuid()).max(5)
        })
      )
      .max(20),
    files: z
      .array(z.object({ fileId: z.string().uuid(), publish: z.boolean() }))
      .max(3),
    sources: sourceContextSelectionsSchema.default([]),
    aiSuggestionId: z.number().int().positive().nullable(),
    editorState: termDraftEditorStateSchema.nullable()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (JSON.stringify(value).length > TERM_DRAFT_MAX_CHARACTERS)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "This draft is too large to save."
      })
    if (
      new Set(value.files.map((file) => file.fileId)).size !==
      value.files.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A file can only be attached once."
      })
    if (
      (value.editorState?.appliedDraft?.suggestionId ?? null) !==
        value.aiSuggestionId &&
      value.editorState
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The saved AI attribution does not match the editor."
      })
  })
export type TermDraftPayload = z.infer<typeof termDraftPayloadSchema>
export type TermDraftEditorState = z.infer<typeof termDraftEditorStateSchema>
export function emptyTermDraftPayload(
  vocabularySlug: string | null = null
): TermDraftPayload {
  return {
    version: 1,
    term: "",
    definition: "",
    initialExample: "",
    vocabularySlug,
    collectionId: null,
    references: [],
    files: [],
    sources: [],
    aiSuggestionId: null,
    editorState: null
  }
}
