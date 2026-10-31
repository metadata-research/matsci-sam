import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { runInNewContext } from "node:vm"
import Link from "next/link"
import { NextRequest, NextResponse } from "next/server"
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"
import * as jsxRuntime from "react/jsx-runtime"
import * as icons from "lucide-react"
import ts from "typescript"
import { z } from "zod"
import { Button } from "../components/ui/button"
import * as cards from "../components/ui/card"
import * as authReturn from "../lib/auth-return"
import * as authTokens from "../lib/auth-tokens"
import * as emailIntent from "../lib/email-auth-intent"
import * as emailToken from "../lib/email-auth-token"

// Run actual route/page code, using the existing auth-test VM pattern. Only the
// declared in-memory boundaries are available; no database, mail or network.
function load<T>(
  file: string,
  dependencies: Record<string, unknown>,
  errors: string[] = [],
  globals: Record<string, unknown> = {}
) {
  const exports = {}
  const compiled = ts.transpileModule(readFileSync(resolve(file), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText
  runInNewContext(compiled, {
    exports,
    Response,
    URL,
    console: { error: (message: string) => errors.push(message) },
    ...globals,
    require(name: string) {
      assert.ok(
        Object.hasOwn(dependencies, name),
        `Unexpected dependency: ${name}`
      )
      return dependencies[name]
    }
  })
  return exports as T
}

const origin = "https://sam.example.test"
const address = "fixture@example.test"
const rawToken = "a".repeat(43)
const users = { id: "id", email: "email", isAi: "isAi" }
const tokens = {
  tokenHash: "tokenHash",
  email: "email",
  createdAt: "createdAt",
  expiresAt: "expiresAt",
  usedAt: "usedAt"
}
const expression = (...values: unknown[]) => values
const expressions = Object.fromEntries(
  ["and", "eq", "gt", "isNull", "lt", "sql"].map((name) => [name, expression])
)
const emailConfig = load<Record<string, unknown>>("lib/email-auth.ts", {
  "server-only": {},
  zod: { z },
  "@/lib/auth-tokens": authTokens,
  "@/lib/email-auth-intent": emailIntent,
  "@/lib/email-auth-token": emailToken
})
type Options = {
  existing?: boolean
  recent?: boolean
  enabled?: boolean
  signup?: boolean
  deliveryFails?: boolean
}
type Mail = {
  email: string
  token: string
  returnTo: string | null
  intent: emailIntent.EmailAuthIntent
}

function routeFixture(options: Options = {}) {
  let databaseCalls = 0
  let deletes = 0
  const inserts: { email: string; allowAccountCreation: boolean }[] = []
  const deferred: (() => Promise<void>)[] = []
  const mail: Mail[] = []
  const errors: string[] = []
  const tx = {
    execute: async () => {},
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            table === users
              ? options.existing === false
                ? []
                : [{ id: 1 }]
              : options.recent
                ? [{ tokenHash: "existing-fixture-digest" }]
                : []
        })
      })
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
    insert: () => ({
      values: async (value: (typeof inserts)[number]) => {
        inserts.push(value)
      }
    })
  }
  const db = {
    delete: () => {
      databaseCalls++
      deletes++
      return { where: async () => {} }
    },
    transaction: async <T>(operation: (value: typeof tx) => Promise<T>) => {
      databaseCalls++
      return operation(tx)
    }
  }
  const { POST } = load<{ POST: (request: NextRequest) => Promise<Response> }>(
    "app/api/auth/email/start/route.ts",
    {
      "@yamz/db": { db, usersTable: users, emailAuthTokensTable: tokens },
      "drizzle-orm": expressions,
      "next/server": {
        NextResponse,
        after: (callback: () => Promise<void>) => deferred.push(callback)
      },
      "@/lib/auth-return": authReturn,
      "@/lib/email-auth": {
        ...emailConfig,
        isEmailAuthEnabled: () => options.enabled !== false,
        isEmailAccountCreationEnabled: () => options.signup !== false,
        getAuthSiteUrl: () => new URL(origin),
        createEmailAuthToken: () => rawToken,
        hashEmailAuthToken: () => "fixture-digest",
        emailAuthTokenExpiry: () => "2099-01-01T00:00:00Z"
      },
      "@/lib/email": {
        sendEmailAuthLink: async (value: Mail) => {
          mail.push(value)
          if (options.deliveryFails)
            throw new Error("Synthetic delivery failure")
        }
      }
    },
    errors
  )
  return {
    inserts,
    deferred,
    mail,
    errors,
    get databaseCalls() {
      return databaseCalls
    },
    get deletes() {
      return deletes
    },
    post: (
      form: Record<string, string>,
      requestOrigin: string | null = origin
    ) =>
      POST(
        new NextRequest(`${origin}/api/auth/email/start`, {
          method: "POST",
          headers: requestOrigin === null ? {} : { origin: requestOrigin },
          body: new URLSearchParams(form)
        })
      )
  }
}

type PageParameters = {
  intent?: string | string[]
  returnTo?: string | string[]
}
async function renderPage(parameters: PageParameters, options: Options = {}) {
  const { default: Page } = load<{
    default: (props: {
      searchParams: Promise<PageParameters>
    }) => Promise<ReactNode>
  }>("app/register/check-email/page.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: Link },
    "next/navigation": {
      notFound: () => {
        throw new Error("NOT_FOUND")
      }
    },
    "lucide-react": icons,
    "@/components/ui/button": { Button },
    "@/components/ui/card": cards,
    "@/lib/auth-return": authReturn,
    "@/lib/site": { SITE_NAME: "MatSci-SAM" },
    "@/lib/email-auth": {
      isEmailAuthEnabled: () => options.enabled !== false,
      isEmailAccountCreationEnabled: () => options.signup !== false
    }
  })
  return renderToStaticMarkup(
    await Page({ searchParams: Promise.resolve(parameters) })
  )
}

function checkRedirect(
  response: Response,
  intent: string | null,
  returnTo: string | null
) {
  assert.equal(response.status, 303)
  const expected = new URL("/register/check-email", origin)
  if (intent) expected.searchParams.set("intent", intent)
  if (returnTo) expected.searchParams.set("returnTo", returnTo)
  assert.equal(response.headers.get("location"), expected.href)
  assert.doesNotMatch(
    expected.href,
    new RegExp(`${address}|${rawToken}|fixture-digest`)
  )
  return expected.href
}
const registerLink = (html: string) =>
  /href="([^"]+)">Create an account with email<\/a>/
    .exec(html)?.[1]
    ?.replaceAll("&amp;", "&")

async function checkEmailMessages() {
  type Message = { to: string; subject: string; text: string; html: string }
  const sent: Message[] = []
  const { sendEmailAuthLink } = load<{
    sendEmailAuthLink: (input: Mail) => Promise<void>
  }>(
    "lib/email.ts",
    {
      "server-only": {},
      nodemailer: {
        default: {
          createTransport: () => ({
            sendMail: async (mail: Message) => sent.push(mail)
          })
        }
      },
      "googleapis/build/src/apis/gmail": {},
      "@/lib/email-auth": { getAuthSiteUrl: () => new URL(origin) },
      "@/lib/email-auth-token": emailToken,
      "@/lib/site": { SITE_NAME: "MatSci-SAM" },
      "@/lib/public-identifiers": {},
      "@/lib/invitation-presentation": {}
    },
    [],
    {
      process: {
        env: {
          EMAIL_AUTH_PROVIDER: "smtp",
          EMAIL_AUTH_FROM: "sender@example.test",
          EMAIL_AUTH_SMTP_HOST: "unused.example.test"
        }
      }
    }
  )
  const returnTo = `/invite/${"b".repeat(43)}`
  for (const intent of ["create", "sign-in"] as const) {
    await sendEmailAuthLink({
      email: address,
      token: rawToken,
      returnTo,
      intent
    })
    const mail = sent.at(-1)!
    assert.equal(mail.to, address)
    assert.equal(
      mail.subject,
      intent === "create"
        ? "Create your MatSci-SAM account"
        : "Sign in to MatSci-SAM"
    )
    assert.match(
      mail.html,
      intent === "create"
        ? />Confirm account creation<\/a>/
        : />Confirm sign-in<\/a>/
    )
    for (const body of [mail.text, mail.html]) {
      assert.match(
        body,
        intent === "create"
          ? /then confirm to create your MatSci-SAM account\./
          : /then confirm to sign in to MatSci-SAM\./
      )
      assert.match(body, /can be used only once/)
      assert.match(body, /If you did not request it/)
    }
    const textUrl = new URL(
      mail.text.split("\n").find((line) => line.startsWith(origin))!
    )
    const htmlUrl = new URL(
      /href="([^"]+)"/.exec(mail.html)![1].replaceAll("&amp;", "&")
    )
    assert.equal(textUrl.href, htmlUrl.href)
    assert.equal(textUrl.origin, origin)
    assert.equal(textUrl.pathname, "/register/verify")
    assert.equal(
      textUrl.search,
      "",
      "tokens must remain out of HTTP query strings"
    )
    assert.equal(
      new URLSearchParams(textUrl.hash.slice(1)).get("token"),
      rawToken
    )
    assert.equal(
      new URLSearchParams(textUrl.hash.slice(1)).get("returnTo"),
      returnTo
    )
  }
  assert.equal(sent.length, 2)
}

async function main() {
  await checkEmailMessages()
  const destination = `/add?${new URLSearchParams({
    term: "grain boundary",
    vocabularySlug: "materials",
    draftId: "74dde90f-41bf-4912-bccc-d1761cf58a50",
    setupReturnTo: "/setup?task=import&vocabularySlug=materials"
  })}`
  for (const intent of ["sign-in", "create"] as const) {
    const locations: string[] = []
    for (const options of [
      { existing: true },
      { existing: false },
      { existing: true, recent: true },
      { existing: false, recent: true }
    ]) {
      const fixture = routeFixture(options)
      const response = await fixture.post({
        email: address,
        intent,
        returnTo: destination,
        token: "untrusted-token-field",
        status: "untrusted-status-field"
      })
      locations.push(checkRedirect(response, intent, destination))
      const issued =
        !options.recent && (intent === "create" || options.existing)
      assert.equal(fixture.inserts.length, Number(issued))
      assert.equal(fixture.deferred.length, Number(issued))
      assert.equal(
        fixture.mail.length,
        0,
        "mail must remain deferred until after the response"
      )
      if (issued) {
        assert.equal(
          fixture.inserts[0].allowAccountCreation,
          intent === "create"
        )
        await fixture.deferred[0]()
        assert.equal(fixture.mail.length, 1)
        assert.equal(fixture.mail[0].email, address)
        assert.equal(fixture.mail[0].returnTo, destination)
        assert.equal(fixture.mail[0].intent, intent)
      }
    }
    assert.equal(
      new Set(locations).size,
      1,
      "confirmation must not reveal account eligibility or throttling"
    )
  }

  for (const [form, expectedIntent] of [
    [{ email: "not-an-email", intent: "create" }, "create"],
    [{ email: "not-an-email", intent: "sign-in" }, "sign-in"],
    [{ email: address, intent: "create&email=leak" }, null],
    [{ email: address }, null]
  ] as const) {
    const fixture = routeFixture()
    checkRedirect(
      await fixture.post({ ...form, returnTo: destination }),
      expectedIntent,
      destination
    )
    assert.equal(
      fixture.databaseCalls,
      0,
      "invalid forms must stop before database or delivery"
    )
    assert.equal(fixture.deferred.length, 0)
  }

  const disabledSignup = routeFixture({ signup: false })
  checkRedirect(
    await disabledSignup.post({
      email: address,
      intent: "create",
      returnTo: destination
    }),
    "create",
    destination
  )
  assert.equal(disabledSignup.databaseCalls, 0)
  assert.equal(disabledSignup.deferred.length, 0)
  const disabledAuth = routeFixture({ enabled: false })
  assert.equal(
    (await disabledAuth.post({ email: address, intent: "create" })).status,
    404
  )
  assert.equal(disabledAuth.databaseCalls, 0)
  for (const badOrigin of [
    null,
    "null",
    "https://other.example.test",
    `${origin}/`
  ]) {
    const fixture = routeFixture()
    const response = await fixture.post(
      { email: address, intent: "create" },
      badOrigin
    )
    assert.equal(response.status, 403)
    assert.equal(response.headers.get("location"), null)
    assert.equal(fixture.databaseCalls, 0)
    assert.equal(fixture.deferred.length, 0)
  }

  for (const returnTo of [
    "https://other.example.test/setup",
    "//other.example.test/setup",
    "/setup?next=https://other.example.test",
    "/setup?task=import&task=community",
    "/profile/edit?welcome=1",
    "/add?term=bad%0Avalue"
  ]) {
    const fixture = routeFixture({ existing: false })
    checkRedirect(
      await fixture.post({ email: address, intent: "sign-in", returnTo }),
      "sign-in",
      null
    )
    assert.equal(
      registerLink(await renderPage({ intent: "sign-in", returnTo })),
      "/register"
    )
  }

  const failure = routeFixture({ deliveryFails: true })
  const failedResponse = await failure.post({
    email: address,
    intent: "sign-in",
    returnTo: destination
  })
  const originalLocation = checkRedirect(failedResponse, "sign-in", destination)
  await failure.deferred[0]()
  assert.equal(failedResponse.headers.get("location"), originalLocation)
  assert.equal(
    failure.deletes,
    2,
    "failed delivery removes its token after initial expiry cleanup"
  )
  assert.deepEqual(failure.errors, [
    "Passwordless authentication email delivery failed"
  ])

  const creating = await renderPage({ intent: "create", returnTo: destination })
  assert.match(creating, /Check your email to create your account/)
  assert.match(creating, /confirm your email address and create your account/)
  assert.equal(
    registerLink(creating),
    undefined,
    "signup confirmation must not restart signup"
  )
  assert.doesNotMatch(creating, /If this email address belongs to an account/)
  const signingIn = await renderPage({
    intent: "sign-in",
    returnTo: destination
  })
  assert.match(signingIn, /Check your email to sign in/)
  assert.match(signingIn, /If this email address belongs to an account/)
  assert.equal(
    registerLink(signingIn),
    `/register?returnTo=${encodeURIComponent(destination)}`
  )
  const closedSignup = await renderPage(
    { intent: "sign-in", returnTo: destination },
    { signup: false }
  )
  assert.match(closedSignup, /Check your email to sign in/)
  assert.equal(registerLink(closedSignup), undefined)
  for (const intent of [
    undefined,
    "unexpected",
    ["create"],
    ["sign-in", "create"]
  ]) {
    const html = await renderPage({ intent, returnTo: destination })
    assert.match(html, /Open the one-time link to continue\./)
    assert.doesNotMatch(
      html,
      /Check your email to (sign in|create your account)/
    )
    assert.equal(registerLink(html), undefined)
  }
  const neutral = await renderPage({ intent: "create" }, { signup: false })
  assert.match(neutral, /Open the one-time link to continue\./)
  assert.equal(registerLink(neutral), undefined)
  assert.equal(
    registerLink(
      await renderPage({ intent: "sign-in", returnTo: ["/setup", "/add"] })
    ),
    "/register"
  )
  await assert.rejects(
    renderPage({ intent: "create" }, { enabled: false }),
    /NOT_FOUND/
  )
  console.log(
    "Email confirmation checks passed: intent, private generic redirects, safe continuation, feature flags and deferred delivery."
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
