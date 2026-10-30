import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { runInNewContext } from "node:vm"
import { TRPCError } from "@trpc/server"
import { NextRequest } from "next/server"
import Link from "next/link"
import {
  createElement,
  type ComponentProps,
  type MouseEvent,
  type ReactNode
} from "react"
import { renderToStaticMarkup } from "react-dom/server"
import * as jsxRuntime from "react/jsx-runtime"
import * as formHooks from "react-hook-form"
import * as resolvers from "@hookform/resolvers/zod"
import * as icons from "lucide-react"
import ts from "typescript"
import { z } from "zod"
import type { User } from "../drizzle/schema"
import { Button } from "../components/ui/button"
import * as cards from "../components/ui/card"
import * as forms from "../components/ui/form"
import * as inputs from "../components/ui/input"
import * as switches from "../components/ui/switch"
import * as emailConfirmation from "../lib/email-auth-confirmation"
import * as authReturn from "../lib/auth-return"
import * as communityWorkReturn from "../lib/community-work-return"
import { publicRedirect } from "../lib/public-redirect"
import { EditProfileSchema } from "../lib/schemas/profile"
import { initialTermFromSearchParam } from "../app/add/initial-term"

// Execute the real handlers, as in test-orcid-session-binding, while replacing
// every database/provider boundary. Unexpected imports or network calls fail.
function loadModule<T>(file: string, dependencies: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(resolve(file), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText
  const exports = {}
  runInNewContext(compiled, {
    exports,
    Buffer,
    Response,
    URLSearchParams,
    console,
    fetch: () => {
      throw new Error("Profile setup tests must not make network requests")
    },
    require(name: string) {
      if (!Object.hasOwn(dependencies, name))
        throw new Error(`Unexpected dependency in ${file}: ${name}`)
      return dependencies[name]
    }
  })
  return exports as T
}

type Handler = (request: NextRequest) => Promise<Response>
type Account = {
  id: number
  name: string
  firstName: string | null
  lastName: string | null
  emailVerifiedAt: string | null
  googleId?: string
}
const incompleteAccount: Account = {
  id: 41,
  name: "",
  firstName: null,
  lastName: null,
  emailVerifiedAt: null
}
const users = { id: "id", email: "email", isAi: "isAi", googleId: "googleId" }
const tokens = {
  tokenHash: "tokenHash",
  usedAt: "usedAt",
  expiresAt: "expiresAt"
}
const expressions = {
  and: (...values: unknown[]) => values,
  eq: (...values: unknown[]) => values,
  ne: (...values: unknown[]) => values,
  gt: (...values: unknown[]) => values,
  isNull: (value: unknown) => value,
  sql: (...values: unknown[]) => values
}

function accountStore({
  existing,
  concurrentInsert = false
}: {
  existing?: Account
  concurrentInsert?: boolean
}) {
  let account = existing && { ...existing }
  let inserts = 0
  let selects = 0
  let allowAccountCreation = true
  const operations = {
    query: {
      usersTable: {
        findFirst: async () => account
      }
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selects++
            return account ? [account] : []
          }
        })
      })
    }),
    update: (table: unknown) => ({
      set: (values: Partial<Account>) => ({
        where: () => ({
          returning: async () => {
            if (table === tokens)
              return [{ email: "fixture@example.test", allowAccountCreation }]
            assert.equal(table, users)
            assert.ok(account, "only an existing account may be updated")
            account = { ...account, ...values }
            return [account]
          }
        })
      })
    }),
    insert: (table: unknown) => {
      assert.equal(table, users)
      inserts++
      return {
        values: (values: Partial<Account>) => {
          const result = {
            onConflictDoNothing: () => result,
            returning: async () => {
              account = {
                ...incompleteAccount,
                ...values,
                id: concurrentInsert ? 43 : 42
              }
              return concurrentInsert ? [] : [account]
            }
          }
          return result
        }
      }
    }
  }
  return {
    db: {
      ...operations,
      transaction: async <T>(
        operation: (tx: typeof operations) => Promise<T>
      ) => operation(operations)
    },
    get account() {
      return account
    },
    get inserts() {
      return inserts
    },
    get selects() {
      return selects
    },
    forbidSignup: () => {
      allowAccountCreation = false
    }
  }
}

async function emailLogin(
  returnTo: string | null,
  options: { existing?: Account; concurrentInsert?: boolean; signup?: boolean }
) {
  const store = accountStore(options)
  if (options.signup === false) store.forbidSignup()
  let saves = 0
  const session = {
    emailAuthConfirmation: emailConfirmation.createEmailAuthConfirmation(
      "fixture-token-digest",
      undefined
    ),
    id: undefined as number | undefined,
    save: async () => {
      saves++
    }
  }
  const { POST } = loadModule<{ POST: Handler }>(
    "app/api/auth/email/verify/route.ts",
    {
      "@yamz/db": {
        db: store.db,
        usersTable: users,
        emailAuthTokensTable: tokens
      },
      "drizzle-orm": expressions,
      "@/lib/email-auth": {
        isEmailAuthEnabled: () => true,
        getAuthSiteUrl: () => new URL("https://sam.example.test"),
        hashEmailAuthToken: () => "fixture-token-digest"
      },
      "@/lib/session": { getSession: async () => session },
      "@/lib/email-auth-confirmation": emailConfirmation,
      "@/lib/auth-return": authReturn
    }
  )
  const response = await POST(
    new NextRequest("https://sam.example.test/api/auth/email/verify", {
      method: "POST",
      headers: {
        origin: "https://sam.example.test",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        token: "a".repeat(43),
        returnTo,
        action: "confirm",
        challenge: session.emailAuthConfirmation.challenge
      })
    })
  )
  return { response, session, store, saves, body: await response.json() }
}

async function googleLogin(
  returnTo: string | null,
  existing?: Account,
  options: {
    restricted?: boolean
    allowed?: boolean
    invalidState?: boolean
  } = {}
) {
  const store = accountStore({ existing })
  const session = {
    id: undefined as number | undefined,
    googleOAuthState: "fixture-state",
    authReturnTo: returnTo,
    save: async () => {}
  }
  const { GET } = loadModule<{ GET: Handler }>(
    "app/api/auth/callback/route.ts",
    {
      "node:crypto": await import("node:crypto"),
      "@yamz/db": { db: store.db, usersTable: users },
      "drizzle-orm": expressions,
      "@/lib/session": { getSession: async () => session },
      "@/lib/auth-return": authReturn,
      "next/navigation": {
        redirect: (destination: string) => {
          throw new Error(`REDIRECT:${destination}`)
        }
      },
      "@/lib/apis/google": {
        getGoogleAuthAccessMode: () =>
          options.restricted ? "existing-or-allowlisted" : "open",
        getGoogleAuthAllowedEmails: () =>
          new Set(options.allowed ? ["fixture@example.test"] : []),
        getGoogleClientId: () => "fixture-client",
        createGoogleOAuthClient: () => ({
          getToken: async () => ({ tokens: { id_token: "fixture-id-token" } }),
          verifyIdToken: async () => ({
            getPayload: () => ({
              sub: "fixture-google-id",
              email: "fixture@example.test",
              email_verified: true
              // An identity without given/family names is intentional.
            })
          })
        })
      }
    }
  )
  let destination: string | undefined
  try {
    const response = await GET(
      new NextRequest(
        `https://sam.example.test/api/auth/callback?state=${options.invalidState ? "wrong" : "fixture-state"}&code=fixture`
      )
    )
    if (options.invalidState) {
      assert.equal(response.status, 400)
      assert.equal(store.inserts, 0)
      assert.equal(session.id, undefined)
      return { destination, session, store }
    }
    assert.fail(
      "Google callback must redirect after authentication or policy rejection"
    )
  } catch (error) {
    assert.ok(error instanceof Error)
    assert.ok(error.message.startsWith("REDIRECT:"), error.message)
    destination = error.message.slice("REDIRECT:".length)
  }
  assert.equal(session.googleOAuthState, undefined)
  assert.equal(session.authReturnTo, undefined)
  return { destination, session, store }
}

async function orcidLogin(returnTo: string | null) {
  const session = {
    id: undefined as number | undefined,
    orcidOAuth: {
      startedAt: Date.now(),
      intent: "login",
      returnTo
    },
    save: async () => {}
  }
  const connected: number[] = []
  const { GET } = loadModule<{ GET: Handler }>(
    "app/api/auth/orcid/callback/route.ts",
    {
      "@/lib/session": { getSession: async () => session },
      "@/lib/auth-return": authReturn,
      "@/lib/public-redirect": { publicRedirect },
      "next/cache": {
        revalidatePath: () =>
          assert.fail("Login must not enter the connect branch")
      },
      "@/lib/email-auth": { isEmailAccountCreationEnabled: () => true },
      "@/lib/apis/orcid": {
        isOrcidAuthEnabled: () => true,
        completeOrcidAuthorization: async () => ({ orcidId: "fixture-orcid" }),
        describeOrcidFailure: () => "fixture failure"
      },
      "@/lib/orcid-account": {
        OrcidAccountError: class extends Error {},
        findOrcidAccountUserId: async () => incompleteAccount.id,
        connectOrcidAccount: async ({ userId }: { userId: number }) => {
          connected.push(userId)
          return { needsProfile: true }
        }
      }
    }
  )
  const response = await GET(
    new NextRequest(
      "https://sam.example.test/api/auth/orcid/callback?state=fixture&code=fixture"
    )
  )
  assert.equal(response.status, 307)
  assert.equal(session.orcidOAuth, undefined)
  assert.deepEqual(connected, [incompleteAccount.id])
  return { destination: response.headers.get("location"), session }
}

type GateContext = { userId?: number }
type Middleware = (options: {
  ctx: GateContext
  next: (options?: { ctx: GateContext }) => Promise<unknown>
}) => Promise<unknown> | unknown
function procedure(middleware: Middleware[] = []) {
  return {
    middleware,
    use: (next: Middleware) => procedure([...middleware, next])
  }
}

async function contributionAccess(user: Pick<Account, "name"> | undefined) {
  const { contributorProcedure } = loadModule<{
    contributorProcedure: ReturnType<typeof procedure>
  }>("trpc/procedures.ts", {
    "@trpc/server": { TRPCError },
    "./init": { baseProcedure: procedure() },
    "@/lib/crud": { GetUser: async () => user }
  })
  const run = async (index: number, ctx: GateContext): Promise<unknown> => {
    const middleware = contributorProcedure.middleware[index]
    if (!middleware) return "allowed"
    return middleware({
      ctx,
      next: (options) => run(index + 1, options?.ctx ?? ctx)
    })
  }
  return run(0, { userId: user ? 41 : undefined })
}

async function profileUiChecks() {
  const navigations: string[] = []
  let pending = false
  let skip: ComponentProps<typeof Button> | undefined
  const capturedSkip = () => skip
  const noSideEffect = () => assert.fail("Rendering or skipping must not save")
  const fixtureUser = {
    ...incompleteAccount,
    affiliation: null,
    isProfilePublic: false
  } as User
  const shared = {
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: Link },
    "@/lib/auth-return": authReturn,
    "@/lib/site": { SITE_NAME: "MatSci-SAM" },
    "@/lib/current-user": { getCurrentUser: async () => fixtureUser },
    "lucide-react": icons,
    "@/components/ui/button": {
      Button: (props: ComponentProps<typeof Button>) => {
        if (props.children === "Skip for now") skip = props
        return createElement(Button, props)
      }
    },
    "next/navigation": {
      redirect: () =>
        assert.fail("An optional profile must not force a redirect"),
      useRouter: () => ({
        push: (path: string) => navigations.push(path),
        refresh: noSideEffect
      })
    }
  }
  const profileForm = loadModule<{
    EditProfileForm: (props: {
      defaults: User
      isWelcome: boolean
      returnTo: string | null
    }) => ReactNode
  }>("app/profile/form.tsx", {
    ...shared,
    "@hookform/resolvers/zod": resolvers,
    "react-hook-form": formHooks,
    sonner: { toast: { success: noSideEffect, error: noSideEffect } },
    "@/components/ui/card": cards,
    "@/components/ui/form": forms,
    "@/components/ui/input": inputs,
    "@/components/ui/switch": switches,
    "@/lib/schemas/profile": { EditProfileSchema },
    "@/trpc/client": {
      trpc: {
        user: {
          edit: {
            useMutation: () => ({ mutate: noSideEffect, isPending: pending })
          }
        }
      }
    }
  })
  const { default: profilePage } = loadModule<{
    default: (props: {
      searchParams: Promise<{ welcome?: string; returnTo?: string }>
    }) => Promise<ReactNode>
  }>("app/profile/edit/page.tsx", {
    ...shared,
    "@/components/ui/card": cards,
    "@/lib/apis/orcid": { isOrcidAuthEnabled: () => false },
    "../form": profileForm,
    "@/components/orcid-id": {
      OrcidIcon: noSideEffect,
      OrcidIdLink: noSideEffect
    }
  })
  const { default: addPage } = loadModule<{
    default: (props: {
      searchParams: Promise<Record<string, string>>
    }) => Promise<ReactNode>
  }>("app/add/page.tsx", {
    ...shared,
    "@trpc/server": { TRPCError },
    "@yamz/db": { db: {} },
    zod: { z },
    "@/trpc/server": {
      HydrateClient: ({ children }: { children: ReactNode }) => children,
      trpc: { terms: { list: { prefetch: noSideEffect } } }
    },
    "./initial-term": { initialTermFromSearchParam },
    "./page-content": {
      AddTermPageContent: ({ draftId }: { draftId?: string }) => {
        assert.ok(
          draftId,
          "An unnamed user can only restore a saved private draft"
        )
        return createElement("p", null, `Private draft ${draftId}`)
      }
    },
    "@/lib/community-queries": { getActiveCommunity: noSideEffect },
    "@/lib/community-work-return": communityWorkReturn,
    "@/lib/community-work-return.server": {
      communityForTermDraft: async () => null,
      communityForWorkVocabulary: async () => null
    },
    "@/lib/setup-service": {
      requireSetupVocabularyForContribution: noSideEffect
    }
  })

  const addParameters = {
    vocabularySlug: "materials",
    term: "grain boundary",
    draftId: "74dde90f-41bf-4912-bccc-d1761cf58a50",
    setupReturnTo: "/setup?task=import&vocabularySlug=materials"
  }
  const addDestination = `/add?${new URLSearchParams(addParameters)}`
  for (const requested of [
    undefined,
    addDestination,
    "/setup",
    "/profile/drafts",
    "/profile/drafts/imports/74dde90f-41bf-4912-bccc-d1761cf58a50",
    "/studies/profile-fixture/run",
    `/invite/${"a".repeat(43)}`,
    "//other.example.test/setup",
    "/profile/edit?welcome=1"
  ]) {
    skip = undefined
    const markup = renderToStaticMarkup(
      await profilePage({
        searchParams: Promise.resolve({ welcome: "1", returnTo: requested })
      })
    )
    assert.match(markup, /Your account is ready/)
    assert.match(markup, /Save and continue/)
    assert.match(markup, /Affiliation \(optional\)/)
    const skipButton = capturedSkip()
    assert.ok(skipButton, "Welcome profile offers a skip control")
    assert.equal(
      skipButton.type,
      "button",
      "Skip must not submit the profile form"
    )
    assert.equal(skipButton.disabled, false)
    const navigationCount = navigations.length
    skipButton.onClick?.({} as MouseEvent<HTMLButtonElement>)
    assert.equal(
      navigations.length,
      navigationCount + 1,
      "Each Skip click must navigate exactly once"
    )
    assert.equal(
      navigations.at(-1),
      authReturn.normalizeAuthReturnTo(requested) ?? "/profile"
    )
  }

  skip = undefined
  const regular = renderToStaticMarkup(
    await profilePage({ searchParams: Promise.resolve({}) })
  )
  assert.match(regular, /Edit profile/)
  assert.match(regular, /Save profile/)
  assert.equal(
    skip,
    undefined,
    "Normal profile editing has no signup-only Skip"
  )

  pending = true
  renderToStaticMarkup(
    await profilePage({ searchParams: Promise.resolve({ welcome: "1" }) })
  )
  const pendingSkip = capturedSkip()
  assert.ok(pendingSkip)
  assert.equal(
    pendingSkip.disabled,
    true,
    "Do not leave while a profile save is pending"
  )

  const privateDraft = renderToStaticMarkup(
    await addPage({ searchParams: Promise.resolve(addParameters) })
  )
  assert.match(
    privateDraft,
    /Private draft 74dde90f-41bf-4912-bccc-d1761cf58a50/
  )
  const newTermParameters = { ...addParameters, draftId: "" }
  const newTermDestination = `/add?${new URLSearchParams({
    vocabularySlug: addParameters.vocabularySlug,
    term: addParameters.term,
    setupReturnTo: addParameters.setupReturnTo
  })}`
  const gate = renderToStaticMarkup(
    await addPage({ searchParams: Promise.resolve(newTermParameters) })
  )
  assert.match(gate, /Add your name to contribute/)
  const href = /<a[^>]*href="([^"]+)"/.exec(gate)?.[1]
  assert.equal(
    href?.replaceAll("&amp;", "&"),
    authReturn.profileCompletionPath(newTermDestination),
    "Inline attribution gate retains term, vocabulary and setup context"
  )
  // Re-entering /add after Skip reaches this gate again, without redirecting or
  // touching the editor/data dependencies guarded above.
  assert.equal(
    renderToStaticMarkup(
      await addPage({ searchParams: Promise.resolve(newTermParameters) })
    ),
    gate
  )
}

async function main() {
  const returns = [
    null,
    "/setup",
    "/add?vocabularySlug=materials&term=grain+boundary",
    "/profile/drafts",
    "/studies/profile-fixture/run",
    `/invite/${"a".repeat(43)}`,
    "https://other.example.test/setup",
    "//other.example.test/setup",
    "/profile/edit?welcome=1",
    "/setup?next=https://other.example.test"
  ]
  for (const requested of returns) {
    const safeReturn = authReturn.normalizeAuthReturnTo(requested)
    const destination = safeReturn ?? "/profile"
    const email = await emailLogin(requested, {
      existing: incompleteAccount,
      signup: false
    })
    assert.equal(email.response.status, 200)
    assert.equal(email.body.redirectTo, destination)
    assert.equal(email.session.id, incompleteAccount.id)
    assert.equal(email.saves, 1)
    assert.equal(email.store.inserts, 0)

    const google = await googleLogin(requested, incompleteAccount)
    assert.equal(google.destination, destination)
    assert.equal(google.session.id, incompleteAccount.id)
    assert.equal(google.store.inserts, 0)

    const orcid = await orcidLogin(requested)
    assert.equal(orcid.destination, destination)
    assert.equal(orcid.session.id, incompleteAccount.id)

    const signup = await emailLogin(requested, {})
    assert.equal(signup.response.status, 200)
    assert.equal(
      signup.body.redirectTo,
      authReturn.profileCompletionPath(safeReturn)
    )
    assert.equal(signup.session.id, 42)
    assert.equal(signup.store.inserts, 1)

    const googleSignup = await googleLogin(requested)
    assert.equal(
      googleSignup.destination,
      authReturn.profileCompletionPath(safeReturn)
    )
    assert.equal(googleSignup.session.id, 42)
    assert.equal(googleSignup.store.inserts, 1)

    const rejected = await googleLogin(requested, undefined, {
      restricted: true
    })
    assert.equal(
      rejected.destination,
      authReturn.authPathWithReturnTo(
        "/login?google=not-authorized",
        safeReturn
      )
    )
    assert.equal(
      rejected.session.id,
      undefined,
      "policy rejection must not authenticate"
    )
    assert.equal(
      rejected.store.inserts,
      0,
      "recovery must not bypass Google access policy"
    )
    const returning = await googleLogin(requested, incompleteAccount, {
      restricted: true
    })
    assert.equal(returning.destination, destination)
    assert.equal(returning.session.id, incompleteAccount.id)
    const allowed = await googleLogin(requested, undefined, {
      restricted: true,
      allowed: true
    })
    assert.equal(
      allowed.destination,
      authReturn.profileCompletionPath(safeReturn)
    )
    assert.equal(allowed.store.inserts, 1)
    await googleLogin(requested, undefined, {
      restricted: true,
      invalidState: true
    })
  }

  const existingSignup = await emailLogin("/setup", {
    existing: incompleteAccount
  })
  assert.equal(existingSignup.body.redirectTo, "/setup")
  assert.equal(existingSignup.store.inserts, 0)
  const concurrent = await emailLogin("/setup", { concurrentInsert: true })
  assert.equal(concurrent.body.redirectTo, "/setup")
  assert.equal(
    concurrent.session.id,
    43,
    "use the account created concurrently"
  )
  assert.equal(concurrent.store.selects, 2, "read the concurrent winner")
  const missing = await emailLogin("/setup", { signup: false })
  assert.equal(missing.response.status, 400)
  assert.equal(
    missing.store.inserts,
    0,
    "sign-in must never register an address"
  )
  assert.equal(missing.session.id, undefined)
  assert.equal(missing.saves, 0)

  await assert.rejects(contributionAccess(undefined), { code: "UNAUTHORIZED" })
  for (const name of ["", "   "])
    await assert.rejects(contributionAccess({ name }), {
      code: "PRECONDITION_FAILED",
      message: "Complete your profile before contributing."
    })
  assert.equal(
    await contributionAccess({ name: "A contributor" }),
    "allowed",
    "optional onboarding must preserve the existing display-name gate"
  )
  assert.equal(
    EditProfileSchema.safeParse({
      firstName: "",
      lastName: "",
      affiliation: "",
      isProfilePublic: false
    }).success,
    false,
    "skipping is separate from saving an invalid attribution profile"
  )
  await profileUiChecks()

  console.log(
    "Profile setup checks passed: real auth redirects, safe continuations, concurrent signup, Skip without saving and retained contribution gate."
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
