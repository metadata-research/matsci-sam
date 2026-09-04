import "server-only"

import { isDevAuthEnabled, getDevAuthUsers } from "@/lib/dev-auth"
import { isEmailAuthEnabled } from "@/lib/email-auth"
import { isOrcidAuthEnabled } from "@/lib/apis/orcid"
import { isGoogleAuthConfigured } from "@/lib/apis/google"
import { Ollama } from "ollama"
import { OllamaModel } from "@/lib/llm/model"

export type ServiceStatus =
  | "ready"
  | "configured"
  | "disabled"
  | "not_configured"
  | "misconfigured"
  | "unreachable"

export type ServiceState = {
  status: ServiceStatus
}

const present = (name: string) => Boolean(process.env[name]?.trim())
const allPresent = (names: string[]) => names.every(present)
const anyPresent = (names: string[]) => names.some(present)

const googleSettings = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_CALLBACK_URL",
  "GOOGLE_AUTH_ACCESS_MODE"
]

const emailConfigured = () => {
  if (!isEmailAuthEnabled()) return false

  const provider = process.env.EMAIL_AUTH_PROVIDER?.trim()
  const common = ["EMAIL_AUTH_FROM", "NEXT_PUBLIC_SITE_URL"]
  if (!allPresent(common)) return false

  if (provider === "gmail-api")
    return allPresent([
      "EMAIL_AUTH_GMAIL_CLIENT_ID",
      "EMAIL_AUTH_GMAIL_CLIENT_SECRET",
      "EMAIL_AUTH_GMAIL_REFRESH_TOKEN"
    ])

  if (provider === "smtp") return allPresent(["EMAIL_AUTH_SMTP_HOST"])

  return false
}

const orcidConfigured = () => {
  if (!isOrcidAuthEnabled()) return false

  const environment = process.env.ORCID_ENVIRONMENT?.trim() || "sandbox"
  return (
    (environment === "sandbox" || environment === "production") &&
    allPresent([
      "ORCID_CLIENT_ID",
      "ORCID_CLIENT_SECRET",
      "ORCID_CALLBACK_URL",
      "AUTH_TOKEN_ENCRYPTION_KEY"
    ])
  )
}

const devAuthConfigured = () => {
  if (!isDevAuthEnabled() || !present("DEV_AUTH_PASSWORD")) return false

  try {
    return getDevAuthUsers().length > 0
  } catch {
    return false
  }
}

export const getConfiguredServiceHealth = () => {
  const googleConfigured = isGoogleAuthConfigured()

  const google: ServiceState = {
    status: googleConfigured
      ? "configured"
      : anyPresent(googleSettings)
        ? "misconfigured"
        : "disabled"
  }

  const email: ServiceState = {
    status: !isEmailAuthEnabled()
      ? "disabled"
      : emailConfigured()
        ? "configured"
        : "misconfigured"
  }

  const orcid: ServiceState = {
    status: !isOrcidAuthEnabled()
      ? "disabled"
      : orcidConfigured()
        ? "configured"
        : "misconfigured"
  }

  const development: ServiceState = {
    status: !isDevAuthEnabled()
      ? "disabled"
      : devAuthConfigured()
        ? "configured"
        : "misconfigured"
  }

  const wolfram: ServiceState = {
    status: present("WOLFRAM_API_KEY") ? "configured" : "not_configured"
  }

  return { google, email, orcid, development, wolfram }
}

export const getOllamaHealth = async (timeoutMs = 3000) => {
  const host = process.env.OLLAMA_HOST?.trim()
  if (!host)
    return {
      status: "not_configured" as const,
      checkedAt: new Date().toISOString()
    }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const client = new Ollama({
      host,
      fetch: (input, init) =>
        fetch(input, { ...init, signal: controller.signal })
    })
    const model = await client.show({ model: OllamaModel })

    return {
      status: "ready" as const,
      checkedAt: new Date().toISOString(),
      model: {
        name: OllamaModel,
        family: model.details.family,
        parameterSize: model.details.parameter_size
      }
    }
  } catch {
    return {
      status: "unreachable" as const,
      checkedAt: new Date().toISOString()
    }
  } finally {
    clearTimeout(timeout)
  }
}

export const getServiceHealth = async () => ({
  ...getConfiguredServiceHealth(),
  ollama: await getOllamaHealth()
})
