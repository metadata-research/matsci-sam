import "server-only"

export type DevAuthUser = {
  username: string
  name: string
  email: string
}

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export const isDevAuthEnabled = () =>
  process.env.DEV_AUTH_ENABLED === "true"

export const getDevAuthUsers = (): DevAuthUser[] => {
  if (!isDevAuthEnabled()) return []

  const raw = process.env.DEV_AUTH_USERS
  if (!raw) throw new Error("DEV_AUTH_USERS is required when development authentication is enabled")

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("DEV_AUTH_USERS must be valid JSON")
  }

  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new Error("DEV_AUTH_USERS must contain at least one user")

  const usernames = new Set<string>()
  const emails = new Set<string>()

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object")
      throw new Error(`DEV_AUTH_USERS entry ${index + 1} is invalid`)

    const candidate = entry as Record<string, unknown>
    const username = typeof candidate.username === "string"
      ? candidate.username.trim().toLowerCase()
      : ""
    const name = typeof candidate.name === "string" ? candidate.name.trim() : ""
    const email = typeof candidate.email === "string"
      ? candidate.email.trim().toLowerCase()
      : ""

    if (!USERNAME_PATTERN.test(username) || !name || !email.includes("@"))
      throw new Error(`DEV_AUTH_USERS entry ${index + 1} is invalid`)
    if (usernames.has(username) || emails.has(email))
      throw new Error("DEV_AUTH_USERS usernames and emails must be unique")

    usernames.add(username)
    emails.add(email)
    return { username, name, email }
  })
}
