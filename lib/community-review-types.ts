import { z } from "zod"
import type { MatcoreDraftPayload } from "./matcore-workflow-types"
export const reviewStyleSchema = z.enum(["assessment", "up_down"])
export const reviewResponseSchema = z.enum(["support", "revise", "unsure"])
export type ReviewResponse = z.infer<typeof reviewResponseSchema>
export type ReviewKind = "reference" | "proposal" | "definition"
export type ReviewStyle = z.infer<typeof reviewStyleSchema>
export type ReviewPreset = {
  version: 1
  style: ReviewStyle
  question: string
  options: { value: ReviewResponse; label: string }[]
}
export function reviewPreset(
  kind: ReviewKind,
  style: ReviewStyle
): ReviewPreset {
  return {
    version: 1,
    style,
    question:
      kind === "proposal"
        ? "Do you support this change?"
        : kind === "definition"
          ? "Is this definition suitable as written?"
          : "Is this field suitable as written?",
    options:
      style === "up_down"
        ? [
            { value: "support", label: "Upvote" },
            { value: "revise", label: "Downvote" }
          ]
        : [
            {
              value: "support",
              label:
                kind === "proposal"
                  ? "Support this change"
                  : "Suitable as written"
            },
            { value: "revise", label: "Needs revision" },
            { value: "unsure", label: "Unable to assess" }
          ]
  }
}
export type ReviewSnapshot = {
  label: string
  definition: string
  path: string
  versionLabel: string
  payload?: MatcoreDraftPayload
  before?: MatcoreDraftPayload | null
  targetHref: string
}
export const createReviewSchema = z
  .object({
    communityId: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
    area: z.string().trim().max(80).optional(),
    referenceReleaseId: z.string().max(160).optional(),
    style: reviewStyleSchema.default("assessment"),
    includeFields: z.boolean().default(true),
    includeProposals: z.boolean().default(true),
    targetIds: z.array(z.string().max(300)).max(500).optional()
  })
  .strict()
export const saveReviewSchema = z
  .object({
    itemId: z.string().uuid(),
    response: reviewResponseSchema.nullable(),
    comment: z.string().trim().max(4000).default(""),
    expectedVersion: z.number().int().nonnegative(),
    mutationId: z.string().uuid()
  })
  .strict()
export function communityReviewHref(
  slug: string,
  roundId: string,
  area?: string | null,
  itemId?: string
) {
  const params = new URLSearchParams({ view: "review", round: roundId })
  if (area) params.set("profile", area)
  if (itemId) params.set("item", itemId)
  return "/communities/" + encodeURIComponent(slug) + "?" + params
}

export function normalizeCommunityReviewReturn(
  value: unknown,
  slug?: string
): string | null {
  if (
    typeof value !== "string" ||
    value.length > 1000 ||
    /[\\#\u0000-\u0020]/.test(value)
  )
    return null
  const match = /^\/communities\/([a-z0-9][a-z0-9_-]{0,199})\?([^?]+)$/.exec(
    value
  )
  if (!match || (slug && match[1] !== slug)) return null
  const params = new URLSearchParams(match[2])
  if (
    params.get("view") !== "review" ||
    !z.string().uuid().safeParse(params.get("round")).success
  )
    return null
  const seen = new Set<string>()
  for (const [key, part] of params) {
    if (seen.has(key)) return null
    seen.add(key)
    if (key === "view" || key === "round") continue
    if (key === "item" && z.string().uuid().safeParse(part).success) continue
    if (key === "profile" && /^[a-z0-9_-]{1,80}$/.test(part)) continue
    return null
  }
  return value
}
