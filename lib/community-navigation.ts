export const COMMUNITY_SECTIONS = [
  { id: "vocabulary", label: "Vocabulary" },
  { id: "review", label: "Reviews" },
  { id: "work", label: "My work" }
] as const

export function communityPrimarySections(signedIn: boolean) {
  return COMMUNITY_SECTIONS.filter(({ id }) => signedIn || id !== "work")
}

export function communityMoreSections({
  showSurveys,
  showSettings
}: {
  showSurveys: boolean
  showSettings: boolean
}) {
  return [
    { id: "people", label: "People" },
    { id: "collections", label: "Collections" },
    { id: "quickstart", label: "Getting started" },
    { id: "overview", label: "About" },
    ...(showSurveys ? [{ id: "surveys", label: "Surveys" }] : []),
    ...(showSettings ? [{ id: "settings", label: "Manage community" }] : [])
  ]
}

export function communitySection(view: string) {
  if (["proposals", "contributions"].includes(view)) return "review"
  if (view === "releases") return "vocabulary"
  return view
}

// Carry browsing context between tabs without carrying a mutation/dialog action.
const CONTEXT_KEYS = [
  "profile",
  "release",
  "standard",
  "edition",
  "layout",
  "q",
  "status",
  "type"
] as const

export function communitySectionHref(
  slug: string,
  view: string,
  context?: { get: (key: string) => string | null },
  defaults: { profile?: string; release?: string } = {}
) {
  const params = new URLSearchParams({ view })
  for (const key of CONTEXT_KEYS) {
    // A primary tab opens its destination, not a previously selected review
    // item or a contribution-selection dialog. Explicit deep links are unchanged.
    if (
      ["review", "work"].includes(view) &&
      !["profile", "release"].includes(key)
    )
      continue
    const value = context?.get(key) ?? defaults[key as keyof typeof defaults]
    if (value) params.set(key, value)
  }
  return `/communities/${encodeURIComponent(slug)}?${params}`
}
