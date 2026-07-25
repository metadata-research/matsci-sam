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

let configurationPromise: Promise<oidc.Configuration> | undefined

const requiredOrcidSetting = (name: string) => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for ORCID authentication`)
  return value
}

export const isOrcidAuthEnabled = () =>
  process.env.ORCID_AUTH_ENABLED === "true"

export const getOrcidIssuer = () => {
  const environment = process.env.ORCID_ENVIRONMENT?.trim() || "sandbox"
  if (environment === "sandbox") return new URL("https://sandbox.orcid.org")
  if (environment === "production") return new URL("https://orcid.org")
  throw new Error("ORCID_ENVIRONMENT must be sandbox or production")
}

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

  configurationPromise ??= oidc.discovery(
    getOrcidIssuer(),
    requiredOrcidSetting("ORCID_CLIENT_ID"),
    requiredOrcidSetting("ORCID_CLIENT_SECRET")
  )

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

export const completeOrcidAuthorization = async (
  request: Request,
  expected: OrcidAuthorizationState
) => {
  const configuration = await getOrcidConfiguration()
  const tokens = (await oidc.authorizationCodeGrant(configuration, request, {
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
