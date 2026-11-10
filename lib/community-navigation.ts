export const COMMUNITY_SECTIONS = [
  { id: "quickstart", label: "Quick start" },
  { id: "vocabulary", label: "Browse" },
  { id: "contributions", label: "Contributions" },
  { id: "review", label: "Reviews" },
  { id: "work", label: "My work" },
  { id: "people", label: "People" }
] as const

export function communitySection(view: string) {
  if (view === "proposals") return "contributions"
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
    const value = context?.get(key) ?? defaults[key as keyof typeof defaults]
    if (value) params.set(key, value)
  }
  return `/communities/${encodeURIComponent(slug)}?${params}`
}
