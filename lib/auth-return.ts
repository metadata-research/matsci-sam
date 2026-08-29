const INVITATION_RETURN_PATH = /^\/invite\/[A-Za-z0-9_-]{43}$/

/*
 * Authentication may resume only an invitation route. Keeping this narrower
 * than a generic same-origin redirect prevents an attacker from turning the
 * sign-in endpoints into an open redirect or choosing an unrelated privileged
 * page as the post-authentication destination.
 */
export const normalizeAuthReturnTo = (value: unknown): string | null =>
  typeof value === "string" && INVITATION_RETURN_PATH.test(value) ? value : null

export const authPathWithReturnTo = (path: string, returnTo: string | null) => {
  if (!returnTo) return path
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}returnTo=${encodeURIComponent(returnTo)}`
}

export const profileCompletionPath = (returnTo: string | null) =>
  authPathWithReturnTo("/profile/edit?welcome=1", returnTo)
