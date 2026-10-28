// Run the actual Google callback against a local database. Only the provider
// response and cookie transport are substituted. Never use a real email here.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import * as crypto from "node:crypto"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import * as expressions from "drizzle-orm"
import { NextRequest } from "next/server"
import ts from "typescript"
import { db, usersTable } from "../drizzle"
import * as authReturn from "../lib/auth-return"
import * as google from "../lib/apis/google"
import { localPreviewBase } from "./ui-test-harness"

export async function localGoogleSignup(email: string, returnTo: string) {
  const base = localPreviewBase()
  assert.ok(email.endsWith("@example.test"))
  assert.equal(google.getGoogleAuthAccessMode(), "open")
  const session = {
    id: undefined as number | undefined,
    googleOAuthState: "local-signup-state",
    authReturnTo: returnTo,
    save: async () => {}
  }
  const redirectSignal = {}
  let destination: string | undefined
  const dependencies: Record<string, unknown> = {
    "node:crypto": crypto,
    "@yamz/db": { db, usersTable },
    "drizzle-orm": expressions,
    "@/lib/auth-return": authReturn,
    "@/lib/session": { getSession: async () => session },
    "next/navigation": {
      redirect: (url: string) => {
        destination = url
        throw redirectSignal
      }
    },
    "@/lib/apis/google": {
      ...google,
      getGoogleClientId: () => "local-fixture-client",
      createGoogleOAuthClient: () => ({
        getToken: async () => ({ tokens: { id_token: "local-fixture-token" } }),
        verifyIdToken: async () => ({
          getPayload: () => ({
            sub: `local-${randomUUID()}`,
            email,
            email_verified: true
          })
        })
      })
    }
  }
  const exports: { GET?: (request: NextRequest) => Promise<Response> } = {}
  runInNewContext(
    ts.transpileModule(readFileSync("app/api/auth/callback/route.ts", "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS
      }
    }).outputText,
    {
      exports,
      Buffer,
      Response,
      console,
      require: (name: string) => {
        assert.ok(
          Object.hasOwn(dependencies, name),
          `Unexpected dependency ${name}`
        )
        return dependencies[name]
      }
    }
  )
  try {
    await exports.GET!(
      new NextRequest(
        `${base}/api/auth/callback?state=local-signup-state&code=local-fixture`
      )
    )
    assert.fail("Google signup must redirect")
  } catch (error) {
    if (error !== redirectSignal) throw error
  }
  assert.ok(session.id)
  assert.equal(session.googleOAuthState, undefined)
  assert.equal(session.authReturnTo, undefined)
  assert.equal(destination, authReturn.profileCompletionPath(returnTo))
  return { userId: session.id, destination: destination! }
}
