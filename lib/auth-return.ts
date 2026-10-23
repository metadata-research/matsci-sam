import { normalizeCommunityWorkReturnTo } from "./community-work-return"
import { normalizeMatcoreCatalogReturnTo } from "./matcore-catalog-navigation"

const INVITATION_RETURN_PATH = /^\/invite\/[A-Za-z0-9_-]{43}$/
const STUDY_RETURN_PATH = /^\/studies\/[a-z0-9][a-z0-9_-]*(?:\/run)?$/
const VOCABULARY_SLUG = /^[a-z0-9][a-z0-9_-]{0,199}$/
const DRAFT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IMPORT_RETURN_PATH =
  /^\/profile\/drafts\/imports\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FIELD_WORKSPACE_RETURN_PATH =
  /^\/metadata\/workspace(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i

function isWorkspaceReturnPath(value: string) {
  if (
    value.length > 2048 ||
    /[\\#\u0000-\u001f\u007f]/.test(value) ||
    value.split("?").length > 2
  )
    return false
  const [path, query] = value.split("?")
  const community = /^\/communities\/[a-z0-9][a-z0-9_-]{0,199}$/.test(path)
  if (!community && path !== "/metadata/workspace") return false
  const seen = new Set<string>()
  for (const [key, parameter] of new URLSearchParams(query)) {
    if (seen.has(key)) return false
    seen.add(key)
    if (
      community &&
      key === "view" &&
      [
        "overview",
        "work",
        "vocabulary",
        "collections",
        "people",
        "surveys"
      ].includes(parameter)
    )
      continue
    if (
      !community &&
      key === "vocabularySlug" &&
      VOCABULARY_SLUG.test(parameter)
    )
      continue
    if (
      key === "profile" &&
      ["minimal", "dft", "md", "mbpt", "ml", "pf", "derived"].includes(
        parameter
      )
    )
      continue
    if (
      key === "offset" &&
      /^\d+$/.test(parameter) &&
      Number(parameter) <= 10000
    )
      continue
    return false
  }
  return true
}

function isContributionReturnPath(value: string) {
  if (value.length > 2048 || /[\\#\u0000-\u001f\u007f]/.test(value))
    return false
  const [path, query] = value.split("?")
  if (path !== "/setup" && path !== "/add") return false
  if (value.split("?").length > 2) return false
  const params = new URLSearchParams(query)
  const seen = new Set<string>()
  for (const [key, parameter] of params) {
    if (seen.has(key)) return false
    seen.add(key)
    if (key === "vocabularySlug" && VOCABULARY_SLUG.test(parameter)) continue
    if (key === "draftId" && DRAFT_ID.test(parameter)) continue
    if (key === "returnTo" && normalizeCommunityWorkReturnTo(parameter))
      continue
    if (
      path === "/add" &&
      key === "setupReturnTo" &&
      normalizeSetupReturnTo(parameter)
    )
      continue
    if (path === "/setup") {
      if (
        key === "task" &&
        ["community", "vocabulary", "collection", "import"].includes(parameter)
      )
        continue
      if (key === "communityId" && /^[1-9][0-9]{0,9}$/.test(parameter)) continue
    }
    if (
      path === "/add" &&
      key === "term" &&
      parameter.length <= 200 &&
      !/[\u0000-\u001f\u007f]/.test(parameter)
    )
      continue
    return false
  }
  return true
}

function isDraftContextReturnPath(value: string) {
  if (value.length > 4096 || /[\\#\u0000-\u001f\u007f]/.test(value))
    return false
  const [path, query, extra] = value.split("?")
  if (extra !== undefined || !query) return false
  if (!IMPORT_RETURN_PATH.test(path) && !FIELD_WORKSPACE_RETURN_PATH.test(path))
    return false
  if (path === "/metadata/workspace") return false
  const seen = new Set<string>()
  for (const [key, parameter] of new URLSearchParams(query)) {
    if (seen.has(key)) return false
    seen.add(key)
    if (
      key === "returnTo" &&
      (normalizeCommunityWorkReturnTo(parameter) ||
        (FIELD_WORKSPACE_RETURN_PATH.test(path) &&
          normalizeMatcoreCatalogReturnTo(parameter)))
    )
      continue
    if (
      key === "review" &&
      IMPORT_RETURN_PATH.test(path) &&
      DRAFT_ID.test(parameter)
    )
      continue
    return false
  }
  return true
}

export const normalizeSetupReturnTo = (value: unknown): string | null =>
  typeof value === "string" &&
  (value === "/setup" || value.startsWith("/setup?")) &&
  isContributionReturnPath(value)
    ? value
    : null

/*
 * Authentication may resume an invitation, study, or contribution setup.
 * These explicit routes exclude external URLs and privileged destinations.
 * Destinations still check membership and contribution permissions themselves.
 */
export const normalizeAuthReturnTo = (value: unknown): string | null =>
  typeof value === "string" &&
  value === value.trim() &&
  (INVITATION_RETURN_PATH.test(value) ||
    STUDY_RETURN_PATH.test(value) ||
    IMPORT_RETURN_PATH.test(value) ||
    FIELD_WORKSPACE_RETURN_PATH.test(value) ||
    isDraftContextReturnPath(value) ||
    normalizeCommunityWorkReturnTo(value) !== null ||
    normalizeMatcoreCatalogReturnTo(value) !== null ||
    isWorkspaceReturnPath(value) ||
    value === "/profile/drafts" ||
    isContributionReturnPath(value))
    ? value
    : null

export const authPathWithReturnTo = (path: string, returnTo: string | null) => {
  if (!returnTo) return path
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}returnTo=${encodeURIComponent(returnTo)}`
}

export const profileCompletionPath = (returnTo: string | null) =>
  authPathWithReturnTo("/profile/edit?welcome=1", returnTo)
