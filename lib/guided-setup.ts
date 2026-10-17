import { z } from "zod"
import { DEFINITION_MAX_LENGTH, TERM_MAX_LENGTH } from "./input-limits"

export const setupTasks = [
  "community",
  "vocabulary",
  "collection",
  "import"
] as const
export type SetupTask = (typeof setupTasks)[number]
export const setupSteps = [
  "community",
  "vocabulary",
  "collection",
  "terms",
  "review"
] as const
export type SetupStep = (typeof setupSteps)[number]

const nameDraft = z.object({
  title: z.string().max(120),
  description: z.string().max(2000)
})
export const setupDraftSchema = z.object({
  version: z.literal(1),
  step: z.enum(setupSteps),
  furthest: z.number().int().min(0).max(4),
  communityId: z.string().max(20),
  vocabularySlug: z.string().max(200),
  collectionId: z.string().max(20),
  community: nameDraft,
  vocabulary: nameDraft,
  collection: nameDraft,
  mode: z.enum(["single", "import"]),
  term: z.string().max(TERM_MAX_LENGTH),
  definition: z.string().max(DEFINITION_MAX_LENGTH),
  termDraftId: z.string().uuid().nullable().default(null),
  termDraftDestinationChanged: z.boolean().default(false),
  text: z.string().max(1000000),
  format: z.enum(["csv", "tsv"]),
  receipt: z
    .object({
      title: z.string(),
      href: z.string().regex(/^\/(?!\/)/),
      detail: z.string()
    })
    .nullable()
})
export type SetupDraft = z.infer<typeof setupDraftSchema>

export function initialSetupDraft(input: {
  task?: SetupTask
  communityId?: number
  vocabularySlug: string
}): SetupDraft {
  const step =
    input.task === "import" ? "vocabulary" : (input.task ?? "community")
  return {
    version: 1,
    step,
    furthest: setupSteps.indexOf(step),
    communityId: input.communityId ? String(input.communityId) : "",
    vocabularySlug: input.vocabularySlug,
    collectionId: "",
    community: { title: "", description: "" },
    vocabulary: { title: "", description: "" },
    collection: { title: "", description: "" },
    mode: input.task === "import" ? "import" : "single",
    term: "",
    definition: "",
    termDraftId: null,
    termDraftDestinationChanged: false,
    text: "",
    format: "csv",
    receipt: null
  }
}

/** A restored review needs a fresh server preview before it can publish. */
export function restoreSetupDraft(
  raw: string | null,
  fallback: SetupDraft
): SetupDraft {
  if (!raw) return fallback
  try {
    const parsed = setupDraftSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return fallback
    return {
      ...parsed.data,
      step: parsed.data.step === "review" ? "terms" : parsed.data.step
    }
  } catch {
    return fallback
  }
}

export function singleTermImportText(term: string, definition: string) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
  return `term,definition\n${quote(term)},${quote(definition)}`
}
