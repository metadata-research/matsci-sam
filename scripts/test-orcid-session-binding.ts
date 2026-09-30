import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { runInNewContext } from "node:vm"
import { NextRequest, NextResponse } from "next/server"
import ts from "typescript"
import * as authReturn from "../lib/auth-return"
import { publicRedirect } from "../lib/public-redirect"
import type { YAMZSession } from "../lib/types"

// Run the actual route handlers with in-memory sessions and provider/account
// boundaries. Unknown imports fail so this test cannot reach a real service.
type Handler = (request: NextRequest) => Promise<Response>
type Session = YAMZSession & { save: () => Promise<void> }
const loadHandler = (file: string, dependencies: Record<string, unknown>) => {
  const compiled = ts.transpileModule(readFileSync(resolve(file), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS
    }
  }).outputText
  const exports = {} as { GET: Handler }
  runInNewContext(compiled, {
    exports,
    Response,
    console,
    require(name: string) {
      if (!(name in dependencies))
        throw new Error(`Unexpected route dependency: ${name}`)
      return dependencies[name]
    }
  })
  return exports.GET
}

const fixture = (userId?: number) => {
  const session: Session = { id: userId, save: async () => {} }
  const connected: number[] = []
  const revalidated: string[] = []
  let exchanges = 0
  let starts = 0
  const dependencies = {
    "@/lib/apis/orcid": {
      isOrcidAuthEnabled: () => true,
      createOrcidAuthorization: async () => {
        starts++
        return {
          url: new URL("https://orcid.example.test/authorize"),
          state: { state: "state", nonce: "nonce", codeVerifier: "verifier" }
        }
      },
      completeOrcidAuthorization: async () => {
        exchanges++
        return { orcidId: "0000-0002-1825-0097" }
      },
      describeOrcidFailure: () => "Test provider failure"
    },
    "@/lib/session": { getSession: async () => session },
    "next/server": { NextResponse },
    "next/cache": { revalidatePath: (path: string) => revalidated.push(path) },
    "@/lib/auth-return": authReturn,
    "@/lib/public-redirect": { publicRedirect },
    "@/lib/email-auth": { isEmailAccountCreationEnabled: () => true },
    "@/lib/orcid-account": {
      OrcidAccountError: class extends Error {},
      findOrcidAccountUserId: async () => 303,
      connectOrcidAccount: async ({ userId }: { userId: number }) => {
        connected.push(userId)
        return { needsProfile: false }
      }
    }
  }
  const start = loadHandler("app/api/auth/orcid/route.ts", dependencies)
  const finish = loadHandler(
    "app/api/auth/orcid/callback/route.ts",
    dependencies
  )
  return {
    session,
    connected,
    revalidated,
    get exchanges() {
      return exchanges
    },
    get starts() {
      return starts
    },
    start: (intent: "connect" | "login") =>
      start(
        new NextRequest(
          `https://sam.example.test/api/auth/orcid?intent=${intent}&returnTo=/studies/test-survey/run`
        )
      ),
    finish: (query = "code=code&state=state") =>
      finish(
        new NextRequest(
          `https://sam.example.test/api/auth/orcid/callback?${query}`
        )
      )
  }
}

async function main() {
  const sameAccount = fixture(101)
  assert.equal((await sameAccount.start("connect")).status, 307)
  const connected = await sameAccount.finish()
  assert.equal(connected.status, 307)
  assert.equal(connected.headers.get("location"), "/profile?orcid=connected")
  assert.deepEqual(sameAccount.connected, [101])
  assert.equal(sameAccount.exchanges, 1)
  assert.equal(sameAccount.session.orcidOAuth, undefined)
  assert.deepEqual(sameAccount.revalidated, ["/profile", "/people/101"])

  const changedAccount = fixture(101)
  await changedAccount.start("connect")
  // Email and Google callbacks replace id while retaining pending ORCID state.
  changedAccount.session.id = 202
  const refused = await changedAccount.finish()
  assert.equal(refused.status, 409, "an account switch must refuse connection")
  assert.deepEqual(changedAccount.connected, [])
  assert.equal(changedAccount.exchanges, 0, "refuse before exchanging the code")
  assert.equal(changedAccount.session.id, 202)
  assert.equal(changedAccount.session.orcidOAuth, undefined)
  assert.equal(
    (await changedAccount.finish()).status,
    400,
    "consume refused state"
  )

  const expiredSession = fixture(101)
  await expiredSession.start("connect")
  delete expiredSession.session.id
  assert.equal((await expiredSession.finish()).status, 401)
  assert.equal(expiredSession.exchanges, 0)
  assert.deepEqual(expiredSession.connected, [])

  const legacyRequest = fixture(101)
  await legacyRequest.start("connect")
  delete legacyRequest.session.orcidOAuth!.initiatingUserId
  assert.equal(
    (await legacyRequest.finish()).status,
    409,
    "old state must restart"
  )
  assert.equal(legacyRequest.exchanges, 0)
  assert.deepEqual(legacyRequest.connected, [])

  const anonymous = fixture()
  assert.equal((await anonymous.start("connect")).status, 401)
  assert.equal(anonymous.starts, 0)

  for (const initialUser of [undefined, 101]) {
    const login = fixture(initialUser)
    await login.start("login")
    assert.equal(login.session.orcidOAuth?.initiatingUserId, undefined)
    const response = await login.finish()
    assert.equal(response.status, 307)
    assert.equal(response.headers.get("location"), "/studies/test-survey/run")
    assert.equal(
      login.session.id,
      303,
      "login resolves the authenticated ORCID"
    )
    assert.deepEqual(login.connected, [303])
  }

  const cancelled = fixture(101)
  await cancelled.start("connect")
  cancelled.session.id = 202
  const cancellation = await cancelled.finish("error=access_denied")
  assert.equal(cancellation.headers.get("location"), "/profile?orcid=cancelled")
  assert.equal(cancelled.exchanges, 0)
  assert.deepEqual(cancelled.connected, [])

  const expiredRequest = fixture(101)
  await expiredRequest.start("connect")
  expiredRequest.session.orcidOAuth!.startedAt = Date.now() - 11 * 60 * 1000
  assert.equal((await expiredRequest.finish()).status, 400)
  assert.equal(expiredRequest.exchanges, 0)

  console.log(
    "ORCID session binding, account changes, legacy state, replay, expiry, cancellation and normal login checks passed."
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
