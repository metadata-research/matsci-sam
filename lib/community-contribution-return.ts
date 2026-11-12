const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const target = new RegExp(
  `^(?:proposal:${uuid}|definition:[1-9][0-9]{0,14})$`,
  "i"
)

/** A navigation return never establishes access to a community or its records. */
export function normalizeCommunityContributionReturnTo(
  value: unknown,
  communitySlug?: string
): string | null {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length > 4096 ||
    /[\\#\u0000-\u001f\u007f]/.test(value)
  )
    return null
  const match = /^\/communities\/([a-z0-9][a-z0-9_-]{0,199})\?([^?]+)$/.exec(
    value
  )
  if (!match || (communitySlug && match[1] !== communitySlug)) return null
  const params = new URLSearchParams(match[2])
  const view = params.get("view")
  if (
    !["contributions", "proposals"].includes(view ?? "") &&
    !(view === "review" && params.get("content") === "contributions")
  )
    return null
  const seen = new Set<string>()
  for (const [key, parameter] of params) {
    if (seen.has(key) || /[\\\u0000-\u001f\u007f]/.test(parameter)) return null
    seen.add(key)
    if (key === "view") continue
    if (key === "content" && view === "review" && parameter === "contributions")
      continue
    if (
      key === "status" &&
      [
        "all",
        "awaiting_review",
        "accepted",
        "changes_requested",
        "declined",
        "withdrawn",
        "published"
      ].includes(parameter)
    )
      continue
    if (
      key === "type" &&
      ["all", "term", "field", "definition", "proposal"].includes(parameter)
    )
      continue
    if (key === "profile" && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(parameter))
      continue
    if (key === "q" && parameter.length <= 200) continue
    if (
      key === "offset" &&
      /^\d+$/.test(parameter) &&
      Number(parameter) <= 10000
    )
      continue
    if (
      key === "selected" &&
      parameter.split(",").length <= 100 &&
      parameter.split(",").every((item) => target.test(item))
    )
      continue
    if (key === "action" && ["new", "export"].includes(parameter)) continue
    if (key === "release" && /^[A-Za-z0-9:._-]{1,500}$/.test(parameter))
      continue
    if (
      key === "standard" &&
      ["reference", "working", "release"].includes(parameter)
    )
      continue
    if (key === "edition" && new RegExp(`^${uuid}$`, "i").test(parameter))
      continue
    if (key === "layout" && ["list", "hierarchy"].includes(parameter)) continue
    return null
  }
  return value
}

export function withCommunityContributionReturn(
  path: string,
  returnTo?: string | null
) {
  const validated = normalizeCommunityContributionReturnTo(returnTo)
  if (!validated) return path
  const url = new URL(path, "http://local")
  url.searchParams.set("returnTo", validated)
  return `${url.pathname}${url.search}${url.hash}`
}
