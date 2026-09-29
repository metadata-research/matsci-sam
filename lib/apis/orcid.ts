import "server-only"

import * as oidc from "openid-client"
import { isValidOrcidId, normalizeOrcidId } from "@/lib/orcid"
import { validateAuthTokenEncryptionKey } from "@/lib/secret-crypto"

export type OrcidAuthorizationIntent = "connect" | "login"

type OrcidAuthorizationState = {
  state: string
  nonce: string
  codeVerifier: string
}

type OrcidTokenResponse = oidc.TokenEndpointResponse & {
  name?: unknown
  orcid?: unknown
}

const ORCID_REGISTRIES = {
  sandbox: "https://sandbox.orcid.org",
  production: "https://orcid.org"
} as const

let configurationPromise: Promise<oidc.Configuration> | undefined

const requiredOrcidSetting = (name: string) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for ORCID authentication`)
  return value
}

const orcidEnvironment = () =>
  process.env.ORCID_ENVIRONMENT?.trim() || "sandbox"

export const isOrcidAuthEnabled = () =>
  process.env.ORCID_AUTH_ENABLED === "true"

export const getOrcidIssuer = () => {
  const environment = orcidEnvironment()
  if (environment === "sandbox" || environment === "production")
    return new URL(ORCID_REGISTRIES[environment])
  throw new Error("ORCID_ENVIRONMENT must be sandbox or production")
}

// An iD links to the registry that authenticated it, so a sandbox iD opens
// its sandbox record. An unrecognized setting cannot authenticate, and its
// links go to the public registry.
export const getOrcidRecordUrl = (orcidId: string) =>
  `${
    orcidEnvironment() === "sandbox"
      ? ORCID_REGISTRIES.sandbox
      : ORCID_REGISTRIES.production
  }/${orcidId}`

export const getOrcidCallbackUrl = () =>
  requiredOrcidSetting("ORCID_CALLBACK_URL")

export const getOrcidScopes = () => {
  const scopes = process.env.ORCID_SCOPES?.trim() || "openid"
  if (!scopes.split(/\s+/).includes("openid"))
    throw new Error("ORCID_SCOPES must include openid")
  return scopes
}

export const getOrcidConfiguration = () => {
  if (!isOrcidAuthEnabled())
    throw new Error("ORCID authentication is not enabled")

  validateAuthTokenEncryptionKey()

  // Clear the memo if discovery rejects. A rejected promise is neither
  // undefined nor null, so ??= would keep returning it and every later sign-in
  // would fail until the process restarted.
  configurationPromise ??= oidc
    .discovery(
      getOrcidIssuer(),
      requiredOrcidSetting("ORCID_CLIENT_ID"),
      requiredOrcidSetting("ORCID_CLIENT_SECRET")
    )
    .catch((error: unknown) => {
      configurationPromise = undefined
      throw error
    })

  return configurationPromise
}

export const createOrcidAuthorization = async () => {
  const configuration = await getOrcidConfiguration()
  const codeVerifier = oidc.randomPKCECodeVerifier()
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
  const state = oidc.randomState()
  const nonce = oidc.randomNonce()

  const url = oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: getOrcidCallbackUrl(),
    response_type: "code",
    scope: getOrcidScopes(),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  })

  return {
    url,
    state: { state, nonce, codeVerifier } satisfies OrcidAuthorizationState
  }
}

// A one-line account of a failed exchange for the service journal. It names
// the failed check and any OAuth error code from ORCID. openid-client wraps
// the failed check in a general error, so the account includes that one cause
// and nothing deeper, which is where the claims of the identity token are.
export const describeOrcidFailure = (error: unknown) => {
  const describe = (value: unknown) => {
    if (!(value instanceof Error)) return []
    const fields = value as Error & {
      code?: unknown
      error?: unknown
      error_description?: unknown
    }
    const parts = [`${value.name}: ${value.message}`]
    if (typeof fields.code === "string") parts.push(`code=${fields.code}`)
    if (typeof fields.error === "string") parts.push(`error=${fields.error}`)
    if (typeof fields.error_description === "string")
      parts.push(`description=${fields.error_description.slice(0, 200)}`)
    return parts
  }

  const parts = describe(error)
  if (!parts.length) return "unknown error"
  const cause = describe((error as Error).cause)
  if (cause.length) parts.push(`cause: ${cause.join(" ")}`)
  return parts.join(" ")
}

// ORCID compares the redirect URI in the token request with the registered
// one. Behind the proxy the request URL names 127.0.0.1, where the service
// listens, so the configured callback URL receives the callback parameters.
export const completeOrcidAuthorization = async (
  callbackSearch: string,
  expected: OrcidAuthorizationState
) => {
  const configuration = await getOrcidConfiguration()
  const currentUrl = new URL(getOrcidCallbackUrl())
  currentUrl.search = callbackSearch

  const tokens = (await oidc.authorizationCodeGrant(configuration, currentUrl, {
    expectedState: expected.state,
    expectedNonce: expected.nonce,
    pkceCodeVerifier: expected.codeVerifier,
    idTokenExpected: true
  })) as OrcidTokenResponse & oidc.TokenEndpointResponseHelpers
  const claims = tokens.claims()

  const rawSubject =
    typeof claims?.sub === "string"
      ? claims.sub
      : typeof tokens.orcid === "string"
        ? tokens.orcid
        : ""
  const orcidId = normalizeOrcidId(rawSubject)
  if (!isValidOrcidId(orcidId))
    throw new Error("ORCID did not return a valid authenticated iD")

  const name =
    typeof claims?.name === "string"
      ? claims.name.trim()
      : typeof tokens.name === "string"
        ? tokens.name.trim()
        : ""

  return {
    orcidId,
    name,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    scope: tokens.scope,
    expiresIn: tokens.expires_in
  }
}
