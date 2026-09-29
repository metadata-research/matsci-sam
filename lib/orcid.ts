const ORCID_ID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/

export const normalizeOrcidId = (value: string) =>
  value
    .trim()
    .replace(/^https?:\/\/(?:sandbox\.)?orcid\.org\//i, "")
    .toUpperCase()

export const isValidOrcidId = (value: string) => {
  const normalized = normalizeOrcidId(value)
  if (!ORCID_ID_PATTERN.test(normalized)) return false

  const characters = normalized.replaceAll("-", "")
  let total = 0

  for (const character of characters.slice(0, 15))
    total = (total + Number(character)) * 2

  const checkValue = (12 - (total % 11)) % 11
  const expected = checkValue === 10 ? "X" : String(checkValue)
  return characters.at(-1) === expected
}

// Outcomes the ORCID routes report to the profile page through the orcid
// query parameter.
export const ORCID_PROFILE_NOTICES = {
  connected: "Your ORCID iD is connected to this account.",
  cancelled: "ORCID connection was cancelled. Nothing changed.",
  disconnected: "Your ORCID iD is no longer connected to this account."
} as const

export const ORCID_SIGN_IN_CANCELLED_NOTICE =
  "ORCID sign-in was cancelled. Choose how to continue."

export const orcidProfileNotice = (value: unknown) =>
  typeof value === "string" && Object.hasOwn(ORCID_PROFILE_NOTICES, value)
    ? ORCID_PROFILE_NOTICES[value as keyof typeof ORCID_PROFILE_NOTICES]
    : null
