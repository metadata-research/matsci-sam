import { OAuth2Client } from "google-auth-library"

export const isGoogleAuthConfigured = () => {
  const mode = process.env.GOOGLE_AUTH_ACCESS_MODE?.trim()
  return (
    Boolean(process.env.GOOGLE_CLIENT_ID?.trim()) &&
    Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim()) &&
    Boolean(process.env.GOOGLE_CALLBACK_URL?.trim()) &&
    (mode === "existing-or-allowlisted" || mode === "open")
  )
}

const requiredGoogleSetting = (name: string) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for Google authentication`)
  return value
}

export const getGoogleClientId = () => requiredGoogleSetting("GOOGLE_CLIENT_ID")

export const createGoogleOAuthClient = () =>
  new OAuth2Client(
    getGoogleClientId(),
    requiredGoogleSetting("GOOGLE_CLIENT_SECRET"),
    requiredGoogleSetting("GOOGLE_CALLBACK_URL")
  )

export const createGoogleAuthorizationUrl = (state: string) =>
  createGoogleOAuthClient().generateAuthUrl({
    access_type: "online",
    prompt: "select_account",
    scope: ["openid", "email", "profile"],
    state
  })

export const getGoogleAuthAccessMode = () => {
  const mode = requiredGoogleSetting("GOOGLE_AUTH_ACCESS_MODE")
  if (mode !== "existing-or-allowlisted" && mode !== "open")
    throw new Error(
      "GOOGLE_AUTH_ACCESS_MODE must be existing-or-allowlisted or open"
    )
  return mode
}

export const getGoogleAuthAllowedEmails = () => {
  const raw = process.env.GOOGLE_AUTH_ALLOWED_EMAILS?.trim()
  if (!raw) return new Set<string>()

  const emails = raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

  if (emails.some((email) => !email.includes("@")))
    throw new Error(
      "GOOGLE_AUTH_ALLOWED_EMAILS must contain valid comma-separated email addresses"
    )

  return new Set(emails)
}
