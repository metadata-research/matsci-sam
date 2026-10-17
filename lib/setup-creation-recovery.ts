import { z } from "zod"
import {
  collectionPath,
  communityPath,
  vocabularyPath
} from "./public-identifiers"

export type SetupCreationKind = "community" | "vocabulary" | "collection"

const attemptSchema = z.object({
  version: z.literal(1),
  userId: z.number().int().positive(),
  storageKey: z.string().min(1).max(1000),
  kind: z.enum(["community", "vocabulary", "collection"]),
  title: z.string().trim().min(1).max(120),
  startedAt: z.string().datetime()
})
export type SetupCreationAttempt = z.infer<typeof attemptSchema>
export type SetupCreationContext = Pick<
  SetupCreationAttempt,
  "userId" | "storageKey"
>

export const setupCreationStorageKey = (storageKey: string) =>
  `${storageKey}:creation`

/** Persist this before submitting. A reload must not silently offer another create. */
export function newSetupCreationAttempt(
  input: SetupCreationContext & { kind: SetupCreationKind; title: string },
  startedAt = new Date().toISOString()
): SetupCreationAttempt {
  return attemptSchema.parse({ ...input, version: 1, startedAt })
}

export function restoreSetupCreationAttempt(
  raw: string | null,
  context: SetupCreationContext
): SetupCreationAttempt | null {
  if (!raw) return null
  try {
    const parsed = attemptSchema.safeParse(JSON.parse(raw))
    if (
      !parsed.success ||
      parsed.data.userId !== context.userId ||
      parsed.data.storageKey !== context.storageKey
    )
      return null
    return parsed.data
  } catch {
    return null
  }
}

// These responses establish that the command was rejected. A transport error,
// timeout, or server failure may follow a committed write and remains uncertain.
const rejectedCodes = new Set([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_SUPPORTED",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNPROCESSABLE_CONTENT",
  "TOO_MANY_REQUESTS"
])

export function isKnownSetupCreationRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const data = "data" in error ? error.data : undefined
  if (!data || typeof data !== "object" || !("code" in data)) return false
  return typeof data.code === "string" && rejectedCodes.has(data.code)
}

type Resource = { slug: string; title: string }
type RecoveryOptions = {
  communities: (Resource & { id: number; vocabularySlug: string })[]
  vocabularies: (Resource & { communityId: number | null })[]
  collections: (Resource & { id: number })[]
}
export type SetupCreationMatch =
  | (Resource & {
      kind: "community"
      id: number
      vocabularySlug: string
      href: string
    })
  | (Resource & { kind: "vocabulary"; href: string })
  | (Resource & { kind: "collection"; id: number; href: string })

/** Names are only candidates. The contributor must explicitly choose a match. */
export function setupCreationMatches(
  attempt: SetupCreationAttempt,
  options: RecoveryOptions
): SetupCreationMatch[] {
  const title = attempt.title.trim().toLowerCase()
  const matchesTitle = (resource: Resource) =>
    resource.title.trim().toLowerCase() === title
  if (attempt.kind === "community")
    return options.communities.filter(matchesTitle).map((community) => ({
      ...community,
      kind: "community",
      href: communityPath(community.slug)
    }))
  if (attempt.kind === "vocabulary")
    return options.vocabularies
      .filter((vocabulary) => vocabulary.communityId === null)
      .filter(matchesTitle)
      .map((vocabulary) => ({
        ...vocabulary,
        kind: "vocabulary",
        href: vocabularyPath(vocabulary.slug)
      }))
  return options.collections.filter(matchesTitle).map((collection) => ({
    ...collection,
    kind: "collection",
    href: collectionPath(collection.slug)
  }))
}
