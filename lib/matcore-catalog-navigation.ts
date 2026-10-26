import { matcoreProfileSchema } from "./matcore-workflow-types"

const slugPattern = /^[a-z0-9][a-z0-9_-]{0,199}$/
const sourceIdPattern = /^[A-Za-z0-9:._-]{1,500}$/

/** A catalog return carries source identity, never editable proposal content. */
export function normalizeMatcoreCatalogReturnTo(
  value: unknown,
  context?: {
    communitySlug: string
    releaseId?: string | null
    source?: string | null
  }
): string | null {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length > 2048 ||
    /[\\#\u0000-\u001f\u007f]/.test(value)
  )
    return null
  const match = /^\/communities\/([a-z0-9][a-z0-9_-]{0,199})\?([^?]+)$/.exec(
    value
  )
  if (!match || (context && match[1] !== context.communitySlug)) return null
  const params = new URLSearchParams(match[2])
  if (params.get("view") !== "vocabulary") return null
  const seen = new Set<string>()
  for (const [key, parameter] of params) {
    if (seen.has(key)) return null
    seen.add(key)
    if (key === "view") continue
    if (
      key === "standard" &&
      ["reference", "working", "release"].includes(parameter)
    )
      continue
    if (
      key === "edition" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        parameter
      )
    )
      continue
    if (key === "layout" && ["list", "hierarchy"].includes(parameter)) continue
    if (
      (key === "release" || key === "source") &&
      sourceIdPattern.test(parameter)
    )
      continue
    if (key === "profile" && matcoreProfileSchema.safeParse(parameter).success)
      continue
    if (
      key === "q" &&
      parameter.length <= 200 &&
      !/[\u0000-\u001f\u007f]/.test(parameter)
    )
      continue
    if (
      key === "offset" &&
      /^\d+$/.test(parameter) &&
      Number(parameter) <= 10000
    )
      continue
    return null
  }
  if (
    params.has("source") &&
    !params.has("release") &&
    params.get("standard") !== "working" &&
    params.get("standard") !== "release"
  )
    return null
  if (params.has("edition") && params.get("standard") !== "release") return null
  if (
    context?.releaseId !== undefined &&
    params.get("release") !== context.releaseId
  )
    return null
  if (context?.source !== undefined && params.get("source") !== context.source)
    return null
  return value
}

export function matcoreCatalogHref(
  communitySlug: string,
  options: {
    releaseId?: string
    profileKey?: string
    offset?: number
    source?: string
    search?: string
    layout?: "list" | "hierarchy"
    standard?: "reference" | "working" | "release"
    edition?: string
  } = {}
) {
  if (!slugPattern.test(communitySlug))
    throw new Error("Invalid community slug")
  const params = new URLSearchParams({ view: "vocabulary" })
  if (options.standard) params.set("standard", options.standard)
  if (options.edition) params.set("edition", options.edition)
  if (options.releaseId) params.set("release", options.releaseId)
  if (options.profileKey) params.set("profile", options.profileKey)
  if (options.offset) params.set("offset", String(options.offset))
  if (options.source) params.set("source", options.source)
  if (options.search) params.set("q", options.search)
  if (options.layout) params.set("layout", options.layout)
  const href = `/communities/${communitySlug}?${params}`
  if (!normalizeMatcoreCatalogReturnTo(href))
    throw new Error("Invalid catalog context")
  return href
}

export function withMatcoreCatalogReturn(path: string, returnTo: string) {
  if (!normalizeMatcoreCatalogReturnTo(returnTo)) return path
  const url = new URL(path, "http://local")
  url.searchParams.set("returnTo", returnTo)
  return `${url.pathname}${url.search}${url.hash}`
}
