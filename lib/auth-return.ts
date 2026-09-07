const INVITATION_RETURN_PATH = /^\/invite\/[A-Za-z0-9_-]{43}$/
const STUDY_RETURN_PATH = /^\/studies\/[a-z0-9][a-z0-9_-]*(?:\/run)?$/

/*
 * Authentication may resume an invitation, study overview, or study activity.
 * These explicit routes exclude external URLs and privileged destinations.
 * The study pages still check membership and the participation window.
 */
export const normalizeAuthReturnTo = (value: unknown): string | null =>
  typeof value === "string" &&
  value === value.trim() &&
  (INVITATION_RETURN_PATH.test(value) || STUDY_RETURN_PATH.test(value))
    ? value
    : null

export const authPathWithReturnTo = (path: string, returnTo: string | null) => {
  if (!returnTo) return path
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}returnTo=${encodeURIComponent(returnTo)}`
}

export const profileCompletionPath = (returnTo: string | null) =>
  authPathWithReturnTo("/profile/edit?welcome=1", returnTo)
