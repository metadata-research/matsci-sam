import { hashOneTimeToken } from "@/lib/auth-tokens"
import { normalizeAuthReturnTo } from "@/lib/auth-return"

const RETURN_TO_HASH_CONTEXT = "email-auth-return-to:v1"

/*
 * Invitation continuations travel in the email link fragment so they work
 * across devices without being persisted or entering ordinary request logs.
 * Binding the continuation to the stored digest also makes the fragment
 * tamper-evident. Token-only hashes retain compatibility with ordinary links.
 */
export const hashEmailAuthToken = (token: string, returnTo?: unknown) => {
  const normalizedReturnTo = normalizeAuthReturnTo(returnTo)
  return hashOneTimeToken(
    normalizedReturnTo
      ? `${RETURN_TO_HASH_CONTEXT}\0${token}\0${normalizedReturnTo}`
      : token
  )
}

export const createEmailAuthLinkFragment = (
  token: string,
  returnTo?: unknown
) => {
  const parameters = new URLSearchParams({ token })
  const normalizedReturnTo = normalizeAuthReturnTo(returnTo)
  if (normalizedReturnTo) parameters.set("returnTo", normalizedReturnTo)
  return parameters.toString()
}
