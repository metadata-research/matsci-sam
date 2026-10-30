import { createOneTimeToken } from "./auth-tokens"

export type EmailAuthConfirmation = {
  tokenHash: string
  challenge: string
  initiatingUserId: number | null
  expiresAt: number
}

export function createEmailAuthConfirmation(
  tokenHash: string,
  userId: number | undefined,
  now = Date.now()
): EmailAuthConfirmation {
  return {
    tokenHash,
    challenge: createOneTimeToken(),
    initiatingUserId: userId ?? null,
    expiresAt: now + 5 * 60_000
  }
}

export function matchesEmailAuthConfirmation(
  pending: EmailAuthConfirmation | undefined,
  tokenHash: string,
  challenge: unknown,
  userId: number | undefined,
  now = Date.now()
) {
  return !!(
    pending &&
    typeof challenge === "string" &&
    pending.challenge === challenge &&
    pending.tokenHash === tokenHash &&
    pending.initiatingUserId === (userId ?? null) &&
    pending.expiresAt > now
  )
}
