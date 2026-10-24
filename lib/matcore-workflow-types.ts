import { z } from "zod"
import {
  DEFINITION_MAX_LENGTH,
  EXAMPLE_MAX_LENGTH,
  TERM_MAX_LENGTH
} from "./input-limits"

export const MATCORE_WORKFLOW_POLICY = "matsci-sam-proposals-v1"
export const MATCORE_IMPORT_CHUNK = 40
export const MATCORE_DRAFT_LIMIT = 500
export const matcoreProfileSchema = z.enum([
  "minimal",
  "dft",
  "md",
  "mbpt",
  "ml",
  "pf",
  "derived"
])
export type MatcoreProfileKey = z.infer<typeof matcoreProfileSchema>
const text = (max = 2000) => z.string().max(max)
export const matcoreSpecificationSchema = z
  .object({
    path: z.string().max(500),
    valueType: z.enum([
      "unspecified",
      "text",
      "number",
      "integer",
      "boolean",
      "object",
      "list",
      "reference"
    ]),
    // Optional additions preserve the shape and hashes of existing source baselines.
    valueForm: z.enum(["unspecified", "scalar", "list", "array"]).optional(),
    format: text(),
    requirement: z.enum([
      "unspecified",
      "required",
      "recommended",
      "optional",
      "conditional"
    ]),
    condition: text(),
    repeatability: z.enum(["unspecified", "yes", "no"]),
    units: text(),
    allowedValues: z.array(z.string().trim().min(1).max(500)).max(100),
    examples: z.array(z.string().max(2000)).max(20),
    guidance: text(10_000),
    notes: text(10_000).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.valueType === "list" &&
      value.valueForm !== undefined &&
      value.valueForm !== "list"
    )
      ctx.addIssue({
        code: "custom",
        path: ["valueForm"],
        message: "Choose a data type separately from the list value form."
      })
  })
export const matcoreCitationSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    url: z
      .string()
      .url()
      .max(2000)
      .refine(
        (value) => /^https?:\/\//i.test(value),
        "Use an HTTP or HTTPS source address."
      ),
    note: text()
  })
  .strict()
export const matcoreDraftPayloadSchema = z
  .object({
    label: z.string().max(TERM_MAX_LENGTH),
    definition: z.string().max(DEFINITION_MAX_LENGTH),
    example: z.string().max(EXAMPLE_MAX_LENGTH),
    rationale: text(4000),
    specification: matcoreSpecificationSchema,
    citations: z.array(matcoreCitationSchema).max(30)
  })
  .strict()
  .superRefine((value, ctx) => {
    if (JSON.stringify(value).length > 100_000)
      ctx.addIssue({ code: "custom", message: "The field draft is too large." })
  })
export type MatcoreDraftPayload = z.infer<typeof matcoreDraftPayloadSchema>
export type MatCoreDraftPayload = MatcoreDraftPayload
export type MatcoreSpecification = z.infer<typeof matcoreSpecificationSchema>
export function emptyMatcoreDraftPayload(): MatcoreDraftPayload {
  return {
    label: "",
    definition: "",
    example: "",
    rationale: "",
    citations: [],
    specification: {
      path: "new-field",
      valueType: "unspecified",
      format: "",
      requirement: "unspecified",
      condition: "",
      repeatability: "unspecified",
      units: "",
      allowedValues: [],
      examples: [],
      guidance: ""
    }
  }
}

export const matcorePublicationPayloadSchema =
  matcoreDraftPayloadSchema.superRefine((value, ctx) => {
    for (const key of ["label", "definition", "rationale"] as const)
      if (!value[key].trim())
        ctx.addIssue({
          code: "custom",
          path: [key],
          message:
            "Provide a label, definition and change rationale before publishing."
        })
    if (
      value.specification.requirement === "conditional" &&
      !value.specification.condition.trim()
    )
      ctx.addIssue({
        code: "custom",
        path: ["specification", "condition"],
        message: "Describe when this field is required."
      })
    if (!value.specification.path.trim())
      ctx.addIssue({
        code: "custom",
        path: ["specification", "path"],
        message: "Provide the field path before publishing."
      })
  })
export type MatcoreSourceOccurrence = {
  sourceFieldId: string
  sourceKey: string
  profileKey: MatcoreProfileKey
  path: string[]
  sourceUrl: string
  sourceAnchor: string
  rawText: string
  warnings: string[]
  sourceTableId: string
  sourceRow: number
}
export type MatcoreSourceRelease = {
  version: string
  sourceUrl: string
  sha256: string
  attribution: string
  license: string | null
  parserVersion: string
  retrievedOn: string
  artifactPath: string
}
export type MatcorePublication = {
  fieldId: string
  revisionId: string
  definitionRevisionId: number
  term: { id: number; slug: string; vocabularySlug: string }
}
export type MatcoreEventDetail = {
  authority: "contributor" | "site_administrator" | "source_import"
  policyVersion: typeof MATCORE_WORKFLOW_POLICY
  reason?: string
  decision?: "accepted" | "changes_requested" | "declined" | "withdrawn"
  fromVersion?: number
  toVersion?: number
  mutationId?: string
  sourcePublisher?: string
  sourceHash?: string
}
