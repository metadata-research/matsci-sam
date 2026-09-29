/*
 * The ORCID OpenID Connect flow against a local stand-in for the ORCID
 * sandbox. The stand-in answers discovery, the key set and the token endpoint
 * through a replaced fetch, so no request leaves the process. Like ORCID, it
 * refuses a token request whose redirect URI differs from the registered one.
 * The script also checks the client_secret_post credentials and the PKCE
 * verifier in the token request, and that openid-client refuses a response
 * with the wrong state or an identity token with the wrong nonce.
 */

import assert from "node:assert/strict"
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"

const ISSUER = "https://sandbox.orcid.org"
const CALLBACK = "https://matsci-sam.example/api/auth/orcid/callback"
const CLIENT_ID = "APP-TESTCLIENT00000"
const CLIENT_SECRET = "test-client-secret"
const ORCID_ID = "0000-0002-1825-0097"

Object.assign(process.env, {
  ORCID_AUTH_ENABLED: "true",
  ORCID_ENVIRONMENT: "sandbox",
  ORCID_CLIENT_ID: CLIENT_ID,
  ORCID_CLIENT_SECRET: CLIENT_SECRET,
  ORCID_CALLBACK_URL: CALLBACK,
  ORCID_SCOPES: "openid",
  AUTH_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64")
})

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048
})
const signingKey = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-key",
  alg: "RS256",
  use: "sig"
}

const base64url = (value: Buffer | string) =>
  Buffer.from(value).toString("base64url")

const signIdToken = (claims: Record<string, unknown>) => {
  const header = base64url(
    JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })
  )
  const payload = base64url(JSON.stringify(claims))
  const signature = sign(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    privateKey
  )
  return `${header}.${payload}.${base64url(signature)}`
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  })

const tokenRequests: URLSearchParams[] = []
let idTokenClaims: (nonce: string) => Record<string, unknown> = () => ({})
let expectedNonce = ""

globalThis.fetch = (async (
  input: string | URL | Request,
  init?: RequestInit
) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.href === `${ISSUER}/.well-known/openid-configuration`)
    return json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      userinfo_endpoint: `${ISSUER}/oauth/userinfo`,
      jwks_uri: `${ISSUER}/oauth/jwks`,
      scopes_supported: ["openid"],
      response_types_supported: ["code", "id_token", "id_token token"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      claims_supported: [
        "family_name",
        "given_name",
        "name",
        "auth_time",
        "iss",
        "sub"
      ]
    })
  if (url.href === `${ISSUER}/oauth/jwks`) return json({ keys: [signingKey] })
  if (url.href === `${ISSUER}/oauth/token`) {
    const body = new URLSearchParams(
      init?.body as string | URLSearchParams | undefined
    )
    tokenRequests.push(body)
    // ORCID refuses a token request whose redirect URI differs from the one
    // registered for the client, and names a refused code in its description.
    if (body.get("code") === "used-code")
      return json(
        {
          error: "invalid_grant",
          error_description: "Invalid authorization code: used-code"
        },
        400
      )
    if (body.get("redirect_uri") !== CALLBACK)
      return json(
        { error: "invalid_grant", error_description: "Redirect URI mismatch." },
        400
      )
    return json({
      access_token: "access-token",
      token_type: "bearer",
      refresh_token: "refresh-token",
      expires_in: 631138518,
      scope: "openid",
      name: "Josiah Carberry",
      orcid: ORCID_ID,
      id_token: signIdToken(idTokenClaims(expectedNonce))
    })
  }
  throw new Error(`Unexpected request to ${url.href}`)
}) as typeof fetch

const standardClaims = (nonce: string) => {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: ISSUER,
    sub: ORCID_ID,
    aud: CLIENT_ID,
    iat: now,
    exp: now + 600,
    auth_time: now,
    nonce,
    name: "Josiah Carberry",
    given_name: "Josiah",
    family_name: "Carberry"
  }
}

const main = async () => {
  const {
    completeOrcidAuthorization,
    createOrcidAuthorization,
    describeOrcidFailure,
    getOrcidRecordUrl
  } = await import("../lib/apis/orcid")

  const authorization = await createOrcidAuthorization()
  const pending = authorization.state
  const authorizeUrl = authorization.url
  assert.equal(
    authorizeUrl.origin + authorizeUrl.pathname,
    `${ISSUER}/oauth/authorize`
  )
  const query = authorizeUrl.searchParams
  assert.equal(query.get("client_id"), CLIENT_ID)
  assert.equal(query.get("redirect_uri"), CALLBACK)
  assert.equal(query.get("response_type"), "code")
  assert.equal(query.get("scope"), "openid")
  assert.equal(query.get("state"), pending.state)
  assert.equal(query.get("nonce"), pending.nonce)
  assert.equal(query.get("code_challenge_method"), "S256")
  assert.equal(
    query.get("code_challenge"),
    createHash("sha256").update(pending.codeVerifier).digest("base64url")
  )

  // The callback passes only its query string. The redirect URI in the token
  // request comes from ORCID_CALLBACK_URL, whatever address the service
  // listens on.
  expectedNonce = pending.nonce
  idTokenClaims = standardClaims
  const callbackSearch = `?code=code-1&state=${encodeURIComponent(pending.state)}`
  const tokens = await completeOrcidAuthorization(callbackSearch, pending)
  assert.equal(tokens.orcidId, ORCID_ID)
  assert.equal(tokens.name, "Josiah Carberry")
  assert.equal(tokens.accessToken, "access-token")
  assert.equal(tokens.refreshToken, "refresh-token")

  const tokenRequest = tokenRequests.at(-1)
  assert.ok(tokenRequest)
  assert.equal(tokenRequest.get("grant_type"), "authorization_code")
  assert.equal(tokenRequest.get("code"), "code-1")
  assert.equal(tokenRequest.get("redirect_uri"), CALLBACK)
  assert.equal(tokenRequest.get("client_id"), CLIENT_ID)
  assert.equal(tokenRequest.get("client_secret"), CLIENT_SECRET)
  assert.equal(tokenRequest.get("code_verifier"), pending.codeVerifier)

  // A token request the provider refuses is reported with its OAuth error
  // code and description.
  const savedCallback = process.env.ORCID_CALLBACK_URL
  process.env.ORCID_CALLBACK_URL =
    "https://127.0.0.1:3000/api/auth/orcid/callback"
  const mismatch = await completeOrcidAuthorization(
    callbackSearch,
    pending
  ).then(
    () => null,
    (error: unknown) => error
  )
  process.env.ORCID_CALLBACK_URL = savedCallback
  assert.ok(mismatch)
  assert.match(
    describeOrcidFailure(mismatch),
    /error=invalid_grant description=Redirect URI mismatch\./
  )

  // A refused code is not repeated in the journal line.
  const refusedCode = await completeOrcidAuthorization(
    `?code=used-code&state=${encodeURIComponent(pending.state)}`,
    pending
  ).then(
    () => null,
    (error: unknown) => error
  )
  assert.ok(refusedCode)
  const refusedCodeLine = describeOrcidFailure(refusedCode)
  assert.match(
    refusedCodeLine,
    /error=invalid_grant description=Invalid authorization code: <withheld>/
  )
  assert.doesNotMatch(refusedCodeLine, /used-code/)

  // A response for another session fails the state check before any token
  // request.
  const requestsBeforeWrongState = tokenRequests.length
  await assert.rejects(
    completeOrcidAuthorization("?code=code-2&state=another-state", pending)
  )
  assert.equal(tokenRequests.length, requestsBeforeWrongState)

  // An identity token bound to another nonce is refused.
  idTokenClaims = (nonce) => ({ ...standardClaims(nonce), nonce: "other" })
  await assert.rejects(completeOrcidAuthorization(callbackSearch, pending))

  // An identity token without a nonce claim is refused as well. The journal
  // line names the failed check without the claims of the token.
  idTokenClaims = (nonce) => {
    const claims: Record<string, unknown> = { ...standardClaims(nonce) }
    delete claims.nonce
    return claims
  }
  const missingNonce = await completeOrcidAuthorization(
    callbackSearch,
    pending
  ).then(
    () => null,
    (error: unknown) => error
  )
  assert.ok(missingNonce)
  const missingNonceLine = describeOrcidFailure(missingNonce)
  assert.match(missingNonceLine, /nonce/)
  assert.doesNotMatch(missingNonceLine, new RegExp(ORCID_ID))
  assert.doesNotMatch(missingNonceLine, /Josiah|access-token/)

  // Without a name claim the name in the token response is used.
  idTokenClaims = (nonce) => {
    const claims: Record<string, unknown> = { ...standardClaims(nonce) }
    delete claims.name
    return claims
  }
  const withoutNameClaim = await completeOrcidAuthorization(
    callbackSearch,
    pending
  )
  assert.equal(withoutNameClaim.name, "Josiah Carberry")

  // A subject that is not a valid iD is refused.
  idTokenClaims = (nonce) => ({
    ...standardClaims(nonce),
    sub: "0000-0002-1825-0098"
  })
  await assert.rejects(
    completeOrcidAuthorization(callbackSearch, pending),
    /valid authenticated iD/
  )

  const recordUrls = [
    ["sandbox", `https://sandbox.orcid.org/${ORCID_ID}`],
    ["production", `https://orcid.org/${ORCID_ID}`],
    [undefined, `https://sandbox.orcid.org/${ORCID_ID}`],
    ["staging", `https://orcid.org/${ORCID_ID}`]
  ] as const
  for (const [environment, expected] of recordUrls) {
    if (environment === undefined) delete process.env.ORCID_ENVIRONMENT
    else process.env.ORCID_ENVIRONMENT = environment
    assert.equal(getOrcidRecordUrl(ORCID_ID), expected, String(environment))
  }

  console.log("ORCID flow checks passed.")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
