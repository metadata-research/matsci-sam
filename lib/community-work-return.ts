const profiles = new Set([
  "minimal",
  "dft",
  "md",
  "mbpt",
  "ml",
  "pf",
  "derived"
])
const sections = new Set([
  "term-drafts",
  "term-imports",
  "my-field-drafts",
  "workspace-tools"
])

export type WorkReturnLink = { href: string; label: string }

/** Only a community's My work view can be carried through a contribution. */
export function normalizeCommunityWorkReturnTo(
  value: unknown,
  communitySlug?: string
): string | null {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length > 2048 ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return null
  const match =
    /^\/communities\/([a-z0-9][a-z0-9_-]{0,199})\?([^#]+)(?:#([a-z0-9-]+))?$/.exec(
      value
    )
  if (!match || (communitySlug && match[1] !== communitySlug)) return null
  const [, , query, section] = match
  if (section && !sections.has(section)) return null
  const params = new URLSearchParams(query)
  if (params.get("view") !== "work") return null
  const seen = new Set<string>()
  for (const [key, parameter] of params) {
    if (seen.has(key)) return null
    seen.add(key)
    if (key === "view" && parameter === "work") continue
    if (key === "profile" && profiles.has(parameter)) continue
    if (
      key === "offset" &&
      /^\d+$/.test(parameter) &&
      Number(parameter) <= 10000
    )
      continue
    return null
  }
  return value
}

/** The caller resolves this community from the authorized vocabulary/record. */
export function communityWorkReturn(
  community: { slug: string; title: string } | null | undefined,
  requestedReturnTo?: unknown,
  fallbackHref = "/profile/drafts",
  section = "term-drafts"
): WorkReturnLink {
  if (!community) return { href: fallbackHref, label: "My term drafts" }
  return {
    href:
      normalizeCommunityWorkReturnTo(requestedReturnTo, community.slug) ??
      `/communities/${community.slug}?view=work#${sections.has(section) ? section : "term-drafts"}`,
    label: `Back to ${community.title} · My work`
  }
}

export function withCommunityWorkReturn(
  path: string,
  returnTo?: string | null
) {
  const validated = normalizeCommunityWorkReturnTo(returnTo)
  if (!validated) return path
  const [base, hash] = path.split("#", 2)
  const [pathname, query] = base.split("?", 2)
  const params = new URLSearchParams(query)
  params.set("returnTo", validated)
  return `${pathname}?${params}${hash ? `#${hash}` : ""}`
}
