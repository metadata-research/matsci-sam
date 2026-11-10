import { z } from "zod"

export const REVIEW_PACKET_TARGET_LIMIT = 100
export const REVIEW_PACKET_ROW_LIMIT = 1000
export const REVIEW_PACKET_BYTE_LIMIT = 5_000_000

export const reviewPacketTargetSchema = z.union([
  z.string().regex(/^definition:[1-9][0-9]{0,9}$/),
  z
    .string()
    .regex(
      /^proposal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    ),
  z.string().regex(/^reference:[^\s\u0000-\u001f]{1,300}$/)
])
export const reviewPacketRequestSchema = z
  .object({
    targets: z
      .array(reviewPacketTargetSchema)
      .min(1)
      .max(REVIEW_PACKET_TARGET_LIMIT),
    includeRespondentNames: z.boolean().default(false),
    includeDatasetExamples: z.boolean().default(false),
    format: z.enum(["preview", "html", "json"]).default("preview"),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.targets).size !== value.targets.length)
      context.addIssue({
        code: "custom",
        path: ["targets"],
        message: "Select each contribution only once."
      })
    if (value.format !== "preview" && !value.fingerprint)
      context.addIssue({
        code: "custom",
        path: ["fingerprint"],
        message: "Preview the packet before downloading it."
      })
  })
export type ReviewPacketRequest = z.infer<typeof reviewPacketRequestSchema>
export type ReviewPacketContent = {
  label: string
  definition: string
  example: string | null
  rules: { label: string; value: string }[]
}
export type ReviewPacketSource = {
  title: string
  kind: string
  url?: string
  note?: string
  version?: string
  license?: string
}
export type ReviewPacketFeedback = {
  itemId: string
  roundId: string
  roundName: string
  closedAt: string | null
  revisionId: string
  question: string
  counts: { value: string; label: string; count: number }[]
  responseCount: number
  datasetExerciseRevisionIds?: string[]
  comments: { text: string; updatedAt: string; name?: string }[]
  respondents?: {
    name: string
    response: string | null
    comment: string
    updatedAt: string
  }[]
}
export type ReviewPacketDatasetExample = {
  revisionId: string
  roundId: string
  roundName: string
  referenceReleaseId: string
  profile: string
  version: number
  updatedAt: string
  reviewItemIds: string[]
  datasetTitle: string
  datasetSource: string
  completedXml: string
  notes: string
  xmlStatus: string
  reviewerName?: string
  reviewerAffiliation?: string
}
export type ReviewPacketItem = {
  target: string
  kind: "definition" | "proposal" | "reference"
  label: string
  revisionId: string
  versionLabel: string
  href: string
  status: string
  author: string | null
  createdAt: string | null
  rationale: string | null
  comparisonBasis: string
  before: ReviewPacketContent | null
  after: ReviewPacketContent
  sources: ReviewPacketSource[]
  feedback: ReviewPacketFeedback[]
  votes: { up: number; down: number; net: number; scope: string } | null
  discussion: { text: string; createdAt: string; name?: string }[]
  history: {
    action: string
    actor: string | null
    createdAt: string
    revisionId: string
    note?: string
  }[]
  limitations: string[]
}
export type CommunityReviewPacket = {
  format: "matsci-sam-review-packet"
  formatVersion: 1
  community: { slug: string; title: string; visibility: string }
  generatedAt: string
  fingerprint: string
  includeRespondentNames: boolean
  includeDatasetExamples: boolean
  datasetExamples: ReviewPacketDatasetExample[]
  items: ReviewPacketItem[]
}

/** Strict query parsing also rejects ambiguous duplicate privacy options. */
export function parseReviewPacketQuery(
  query: URLSearchParams
): ReviewPacketRequest {
  const allowed = new Set([
    "target",
    "names",
    "examples",
    "format",
    "fingerprint"
  ])
  for (const key of query.keys()) {
    if (
      !allowed.has(key) ||
      (key !== "target" && query.getAll(key).length !== 1)
    )
      throw new Error("Invalid review packet options.")
  }
  const names = query.get("names") ?? "0"
  if (names !== "0" && names !== "1")
    throw new Error("Invalid respondent option.")
  const examples = query.get("examples") ?? "0"
  if (examples !== "0" && examples !== "1")
    throw new Error("Invalid dataset example option.")
  return reviewPacketRequestSchema.parse({
    targets: query.getAll("target"),
    includeRespondentNames: names === "1",
    includeDatasetExamples: examples === "1",
    format: query.get("format") ?? "preview",
    fingerprint: query.get("fingerprint") ?? undefined
  })
}

/** Only public web protocols are links. In-app links are constructed separately. */
export function reviewPacketSourceUrl(
  value: string | null | undefined
): string | undefined {
  if (!value || /[\u0000-\u0020]/.test(value)) return undefined
  try {
    const parsed = new URL(value)
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}
