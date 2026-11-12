// Execute the real ORCID callback and account transactions locally. The OAuth
// provider response and session transport are simulated; no provider is called.
import assert from "node:assert/strict"
import { randomInt, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { NextRequest } from "next/server"
import { revalidatePath } from "next/cache"
import ts from "typescript"
import * as orcid from "../lib/apis/orcid"
import * as accounts from "../lib/orcid-account"
import * as accountCreation from "../lib/account-creation"
import * as authReturn from "../lib/auth-return"
import { isValidOrcidId } from "../lib/orcid"
import { publicRedirect } from "../lib/public-redirect"
import type { YAMZSession } from "../lib/types"
import { localPreviewBase } from "./ui-test-harness"

export function requireOrcidSignupTestEnvironment() {
  const base = localPreviewBase()
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /_(?:qa|test|ci|scratch)(?:_|$)/,
    "ORCID signup fixtures require an explicitly disposable database"
  )
  assert.equal(process.env.GRAPH_PROJECTION_ENABLED, "false")
  assert.ok(orcid.isOrcidAuthEnabled(), "Enable ORCID for this local test")
  assert.ok(
    orcid.isOrcidAccountCreationEnabled(),
    "Enable ORCID account creation for this local test"
  )
  return base
}

/** Synthetic, checksummed identifier. The caller verifies it is absent locally. */
export function syntheticOrcidId() {
  const digits =
    "9999" + Array.from({ length: 11 }, () => randomInt(10)).join("")
  let total = 0
  for (const digit of digits) total = (total + Number(digit)) * 2
  const check = (12 - (total % 11)) % 11
  return `${digits}${check === 10 ? "X" : check}`.match(/.{4}/g)!.join("-")
}

export async function localOrcidAuthentication({
  orcidId,
  intent,
  returnTo,
  name
}: {
  orcidId: string
  intent: "signup" | "login"
  returnTo: string
  name: string
}) {
  const base = requireOrcidSignupTestEnvironment()
  assert.ok(isValidOrcidId(orcidId))
  assert.equal(authReturn.normalizeAuthReturnTo(returnTo), returnTo)
  const pending = {
    state: randomUUID(),
    nonce: randomUUID(),
    codeVerifier: randomUUID(),
    startedAt: Date.now(),
    intent,
    returnTo
  }
  const session: YAMZSession & { save: () => Promise<void> } = {
    orcidOAuth: pending,
    save: async () => {}
  }
  let exchanges = 0
  const dependencies: Record<string, unknown> = {
    "@/lib/apis/orcid": {
      ...orcid,
      completeOrcidAuthorization: async (
        search: string,
        expected: typeof pending
      ) => {
        exchanges++
        assert.equal(new URLSearchParams(search).get("state"), pending.state)
        assert.equal(expected, pending)
        return {
          orcidId,
          name,
          accessToken: `synthetic-access-${randomUUID()}`,
          refreshToken: `synthetic-refresh-${randomUUID()}`,
          scope: "openid",
          expiresIn: 3600
        }
      }
    },
    "@/lib/orcid-account": accounts,
    "@/lib/account-creation": accountCreation,
    "@/lib/auth-return": authReturn,
    "@/lib/public-redirect": { publicRedirect },
    "@/lib/session": { getSession: async () => session },
    "next/cache": { revalidatePath }
  }
  const exports: { GET?: (request: NextRequest) => Promise<Response> } = {}
  runInNewContext(
    ts.transpileModule(
      readFileSync("app/api/auth/orcid/callback/route.ts", "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS
        }
      }
    ).outputText,
    {
      exports,
      Response,
      console,
      require(name: string) {
        assert.ok(
          Object.hasOwn(dependencies, name),
          `Unexpected dependency ${name}`
        )
        return dependencies[name]
      }
    }
  )
  const response = await exports.GET!(
    new NextRequest(
      `${base}/api/auth/orcid/callback?state=${pending.state}&code=synthetic-local-code`
    )
  )
  assert.equal(
    response.status,
    307,
    "The verified local callback must redirect"
  )
  assert.equal(exchanges, 1)
  assert.ok(session.id)
  assert.equal(session.orcidOAuth, undefined)
  const destination = response.headers.get("location")
  assert.ok(destination?.startsWith("/"))
  return { userId: session.id, destination }
}
