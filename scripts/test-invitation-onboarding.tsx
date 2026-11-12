import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import Link from "next/link"
import Image from "next/image"
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"
import * as jsxRuntime from "react/jsx-runtime"
import * as icons from "lucide-react"
import ts from "typescript"
import { Button } from "../components/ui/button"
import * as cards from "../components/ui/card"
import * as inputs from "../components/ui/input"
import * as labels from "../components/ui/label"
import * as authReturn from "../lib/auth-return"
import * as identifiers from "../lib/public-identifiers"
import * as communities from "../lib/communities"
import * as invitationCopy from "../lib/invitation-presentation"
import * as communityJoinLink from "../lib/community-join-link"
import { ORCID_SIGN_IN_CANCELLED_NOTICE } from "../lib/orcid"

// Execute the actual server pages with explicit, in-memory boundaries. An
// unexpected import fails; no database, email or OAuth provider is available.
const token = "a".repeat(43)
const destination = `/invite/${token}`
type Options = {
  googleOpen?: boolean
  googleConfigured?: boolean
  signup?: boolean
  email?: boolean
  orcid?: boolean
  orcidSignup?: boolean
  dev?: boolean
  user?: boolean
  outcome?: "live" | "expired" | "revoked" | "redeemed"
  retired?: boolean
  missing?: boolean
  open?: boolean
  reusable?: boolean
  study?: boolean
}
function loadServerModule(file: string, deps: Record<string, unknown>) {
  const exports: Record<string, unknown> = {}
  runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(Object.hasOwn(deps, name), `Unexpected dependency ${name}`)
        return deps[name]
      }
    }
  )
  return exports
}
async function render(file: string, params = {}, options: Options = {}) {
  const signup = options.signup !== false && options.email !== false
  const deps: Record<string, unknown> = {
    "server-only": {},
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: Link },
    "next/image": { default: Image },
    "lucide-react": icons,
    "next/navigation": {
      redirect: (url: string) => {
        throw new Error(`REDIRECT:${url}`)
      },
      notFound: () => {
        throw new Error("NOT_FOUND")
      }
    },
    "@/components/ui/button": { Button },
    "@/components/ui/card": cards,
    "@/components/ui/input": inputs,
    "@/components/ui/label": labels,
    "@/lib/auth-return": authReturn,
    "@/lib/site": { SITE_NAME: "MatSci-SAM" },
    "@/lib/email-auth": {
      isEmailAuthEnabled: () => options.email !== false,
      isEmailAccountCreationEnabled: () => signup
    },
    "@/lib/dev-auth": { isDevAuthEnabled: () => options.dev === true },
    "@/lib/apis/google": {
      isGoogleAuthConfigured: () => options.googleConfigured !== false,
      getGoogleAuthAccessMode: () =>
        options.googleOpen ? "open" : "existing-or-allowlisted"
    },
    "@/lib/apis/orcid": {
      isOrcidAuthEnabled: () => options.orcid === true,
      isOrcidAccountCreationEnabled: () =>
        options.orcid === true && options.orcidSignup === true
    },
    "@/lib/orcid": { ORCID_SIGN_IN_CANCELLED_NOTICE },
    "@/lib/current-user": {
      getCurrentUser: async () => (options.user ? { id: 1 } : null)
    },
    "@/lib/public-identifiers": identifiers,
    "@/lib/communities": communities,
    "@/lib/invitation-presentation": invitationCopy,
    "@/lib/community-join-link": communityJoinLink,
    "@/lib/community-queries": {
      isMemberOf: async () => false,
      invitationForToken: async () =>
        options.missing
          ? null
          : {
              kind: options.open ? "open" : "invitation",
              outcome: options.outcome ?? "live",
              community: {
                id: 1,
                slug: "materials",
                title: "Materials",
                visibility: "members",
                retiredAt: options.retired ? "2026-01-01" : null
              },
              email: "contributor@example.test",
              study: options.study
                ? {
                    title: "Materials survey",
                    slug: "survey",
                    welcome: null,
                    opensAt: null,
                    closesAt: null,
                    retiredAt: null,
                    collectionTitle: "Materials"
                  }
                : null
            }
    },
    "@/components/communities/accept-invitation": {
      AcceptInvitation: () => <button>Accept invitation</button>
    },
    "@/components/studies/action-button": { StudyActionButton: Button },
    "@/components/studies/instruction-content": {
      StudyInstructionContent: () => null
    },
    "@yamz/db": { db: {} },
    "@/lib/community-reviews": {
      reviewInvitation: async () =>
        options.missing
          ? null
          : { title: "Materials", name: "Materials review" }
    },
    "@/components/communities/review-invitation": {
      AcceptReviewInvitation: () => <button>Join review</button>
    }
  }
  deps["@/lib/account-creation"] = loadServerModule(
    "lib/account-creation.ts",
    deps
  )
  const page = loadServerModule(file, deps).default as (
    props: unknown
  ) => Promise<ReactNode>
  return renderToStaticMarkup(
    await page({
      params: Promise.resolve({
        token: options.reusable
          ? `${communityJoinLink.COMMUNITY_JOIN_TOKEN_PREFIX}${token}`
          : token
      }),
      searchParams: Promise.resolve(params)
    })
  )
}
const invite = "app/invite/[token]/page.tsx"
const reviewInvite = "app/review-invite/[token]/page.tsx"
const login = "app/login/page.tsx"
const register = "app/register/page.tsx"
const checkEmail = "app/register/check-email/page.tsx"
const registrationLink = authReturn.authPathWithReturnTo(
  "/register",
  destination
)
const loginLink = authReturn.authPathWithReturnTo("/login", destination)
const href = (path: string, returnTo: string | null) =>
  `href="${authReturn.authPathWithReturnTo(path, returnTo).replaceAll("&", "&amp;")}"`

async function main() {
  for (const study of [false, true]) {
    const html = await render(invite, {}, { study })
    assert.ok(html.includes(`href="${registrationLink}"`))
    assert.ok(html.includes(`href="${loginLink}"`))
    assert.ok(html.indexOf(registrationLink) < html.indexOf(loginLink))
    assert.match(html, /Create an account<\/a>/)
    assert.doesNotMatch(html, /<button[^>]*>Accept invitation/)
  }
  for (const options of [{ signup: false }, { email: false }]) {
    const html = await render(invite, {}, options)
    assert.ok(html.includes(loginLink))
    assert.doesNotMatch(html, /href="\/register/)
    const registration = await render(register, {}, options)
    assert.match(registration, /Account creation is unavailable/)
    assert.ok(registration.includes('href="/login"'))
    assert.doesNotMatch(registration, /<form/)
  }
  for (const options of [
    { outcome: "expired" as const },
    { outcome: "revoked" as const },
    { outcome: "redeemed" as const },
    { retired: true },
    { missing: true },
    { open: true }
  ]) {
    const html = await render(invite, {}, options)
    assert.doesNotMatch(html, /href="\/(register|login)/)
    assert.doesNotMatch(html, /<button[^>]*>Accept invitation/)
  }
  const authenticated = await render(invite, {}, { user: true })
  assert.match(authenticated, /<button>Accept invitation<\/button>/)
  assert.doesNotMatch(authenticated, /href="\/(register|login)/)

  const reusableToken = `${communityJoinLink.COMMUNITY_JOIN_TOKEN_PREFIX}${token}`
  const reusableDestination = `/invite/${reusableToken}`
  const reusable = await render(invite, {}, { open: true, reusable: true })
  for (const path of ["/register", "/login"] as const)
    assert.ok(
      reusable.includes(
        authReturn.authPathWithReturnTo(path, reusableDestination)
      )
    )
  assert.match(reusable, /member access to the private content/)
  assert.doesNotMatch(reusable, /<button[^>]*>Accept invitation/)
  const reusableSignedIn = await render(
    invite,
    {},
    {
      open: true,
      reusable: true,
      user: true
    }
  )
  assert.match(reusableSignedIn, /<button>Accept invitation<\/button>/)
  assert.doesNotMatch(reusableSignedIn, /This community requires approval/)

  for (const google of [undefined, "not-authorized"]) {
    const html = await render(login, { returnTo: destination, google })
    assert.equal(html.split(`href="${registrationLink}"`).length - 1, 1)
    assert.ok(html.indexOf(registrationLink) < html.indexOf("/api/auth/google"))
    assert.match(html, /name="intent" value="sign-in"/)
    if (google)
      assert.match(html, /role="status"[^>]*>Google sign-in is restricted/)
  }
  for (const options of [{ signup: false }, { email: false }]) {
    const html = await render(
      login,
      { returnTo: destination, google: "not-authorized" },
      options
    )
    assert.doesNotMatch(html, /href="\/register/)
    assert.match(html, /Try another account or contact the site administrator/)
  }
  const signup = await render(register, { returnTo: destination })
  assert.match(signup, /name="intent" value="create"/)
  assert.ok(signup.includes(`name="returnTo" value="${destination}"`))
  assert.ok(signup.includes(`href="${loginLink}"`))
  assert.doesNotMatch(signup, /\/api\/auth\/google/)
  const openSignup = await render(
    register,
    { returnTo: destination },
    { googleOpen: true }
  )
  assert.match(openSignup, /Create account with Google/)
  assert.ok(
    openSignup.includes(
      `href="${authReturn.authPathWithReturnTo("/api/auth/google", destination)}"`
    )
  )
  const unconfigured = await render(
    register,
    {},
    { googleOpen: true, googleConfigured: false }
  )
  assert.doesNotMatch(unconfigured, /Create account with Google/)
  const allMethods = {
    googleOpen: true,
    orcid: true,
    orcidSignup: true
  }
  const methodConfigurations: {
    name: string
    options: Options
    methods: { google: boolean; orcid: boolean; email: boolean }
  }[] = [
    {
      name: "Google only",
      options: { googleOpen: true, email: false },
      methods: { google: true, orcid: false, email: false }
    },
    {
      name: "ORCID only",
      options: {
        googleConfigured: false,
        email: false,
        orcid: true,
        orcidSignup: true
      },
      methods: { google: false, orcid: true, email: false }
    },
    {
      name: "email only",
      options: { googleConfigured: false },
      methods: { google: false, orcid: false, email: true }
    },
    {
      name: "none",
      options: { googleConfigured: false, email: false },
      methods: { google: false, orcid: false, email: false }
    },
    {
      name: "all",
      options: allMethods,
      methods: { google: true, orcid: true, email: true }
    },
    {
      name: "ORCID sign-in without creation",
      options: { googleConfigured: false, email: false, orcid: true },
      methods: { google: false, orcid: false, email: false }
    },
    {
      name: "ORCID creation flag without authentication",
      options: { googleConfigured: false, email: false, orcidSignup: true },
      methods: { google: false, orcid: false, email: false }
    }
  ]
  for (const { name, options, methods } of methodConfigurations) {
    const anyMethod = Object.values(methods).some(Boolean)
    for (const returnTo of [destination, `/review-invite/${token}`]) {
      const registration = await render(register, { returnTo }, options)
      assert.match(registration, /Create an account/)
      assert.equal(
        registration.includes(href("/api/auth/google", returnTo)),
        methods.google,
        `${name} Google choice`
      )
      assert.equal(
        registration.includes(href("/api/auth/orcid?intent=signup", returnTo)),
        methods.orcid,
        `${name} ORCID signup choice`
      )
      assert.equal(
        registration.includes('action="/api/auth/email/start"'),
        methods.email,
        `${name} email form`
      )
      assert.equal(
        registration.includes('name="intent" value="create"'),
        methods.email
      )
      assert.equal(
        registration.includes(`name="returnTo" value="${returnTo}"`),
        methods.email
      )
      assert.ok(registration.includes(href("/login", returnTo)))
      assert.equal(
        registration.includes("unavailable on this site"),
        !anyMethod
      )
      assert.doesNotMatch(registration, /intent=login|disabled=""/)

      const signIn = await render(login, { returnTo }, options)
      assert.equal(signIn.includes(href("/register", returnTo)), anyMethod)
      assert.doesNotMatch(signIn, /Create an account with email|intent=signup/)
      if (options.email !== false)
        assert.match(signIn, /name="intent" value="sign-in"/)
      const invitation = await render(
        returnTo.startsWith("/review-invite/") ? reviewInvite : invite,
        {},
        options
      )
      assert.equal(invitation.includes(href("/register", returnTo)), anyMethod)
      assert.ok(invitation.includes(href("/login", returnTo)))
      assert.doesNotMatch(
        invitation,
        /<button[^>]*>(Accept invitation|Join review)/
      )
    }
    const signIn = await render(login, {}, options)
    assert.equal(signIn.includes('href="/register"'), anyMethod)
    const signInEmail = await render(
      checkEmail,
      { intent: "sign-in", returnTo: destination },
      { ...options, email: true, signup: methods.email }
    )
    assert.equal(
      signInEmail.includes(href("/register", destination)),
      anyMethod
    )
  }
  const devPreview = await render(
    register,
    { returnTo: destination },
    { dev: true, googleConfigured: false, email: false }
  )
  assert.match(devPreview, /Create account with Google/)
  assert.match(devPreview, /Create account with ORCID/)
  assert.equal((devPreview.match(/disabled=""/g) ?? []).length, 2)
  assert.equal((devPreview.match(/Unavailable/g) ?? []).length, 2)
  assert.ok(devPreview.includes(href("/dev-login", destination)))
  assert.doesNotMatch(devPreview, /href="\/api\/auth\//)

  const unknownOrcid = await render(
    register,
    { source: "orcid", returnTo: destination },
    allMethods
  )
  assert.match(unknownOrcid, /Create an account with ORCID, or sign in/)
  assert.doesNotMatch(unknownOrcid, /Verify your email first/)
  const unknownOrcidWithoutSignup = await render(
    register,
    { source: "orcid" },
    { googleOpen: true, email: false, orcid: true }
  )
  assert.match(
    unknownOrcidWithoutSignup,
    /then connect ORCID from your profile/
  )
  assert.doesNotMatch(unknownOrcidWithoutSignup, /Verify your email|with email/)
  const cancelledOrcid = await render(
    register,
    { orcid: "cancelled", returnTo: destination },
    allMethods
  )
  assert.ok(cancelledOrcid.includes(ORCID_SIGN_IN_CANCELLED_NOTICE))
  assert.ok(
    cancelledOrcid.includes(href("/api/auth/orcid?intent=signup", destination))
  )
  const recoveredWithOrcid = await render(
    login,
    { google: "not-authorized", returnTo: destination },
    { email: false, orcid: true, orcidSignup: true }
  )
  assert.match(recoveredWithOrcid, /Google sign-in is restricted on this site/)
  assert.ok(recoveredWithOrcid.includes(href("/register", destination)))
  assert.doesNotMatch(recoveredWithOrcid, /with email/)
  const signedInReview = await render(reviewInvite, {}, { user: true })
  assert.match(signedInReview, /<button>Join review<\/button>/)
  assert.doesNotMatch(signedInReview, /href="\/(register|login)/)
  const missingReview = await render(reviewInvite, {}, { missing: true })
  assert.match(missingReview, /Invitation unavailable/)
  assert.doesNotMatch(missingReview, /href="\/(register|login)/)
  for (const unsafe of [
    "https://elsewhere.test",
    "//elsewhere.test",
    "/admin/users",
    "/\\elsewhere.test",
    `${destination}#fragment`
  ]) {
    for (const file of [login, register, checkEmail]) {
      const html = await render(
        file,
        { returnTo: unsafe, google: "not-authorized", intent: "sign-in" },
        allMethods
      )
      assert.ok(!html.includes(unsafe))
      assert.ok(!html.includes(encodeURIComponent(unsafe)))
      assert.doesNotMatch(html, /name="returnTo"/)
    }
  }
  for (const file of [login, register]) {
    for (const returnTo of [destination, `/review-invite/${token}`])
      await assert.rejects(
        render(file, { returnTo }, { user: true }),
        (error: Error) => error.message === `REDIRECT:${returnTo}`
      )
    for (const returnTo of [undefined, "https://elsewhere.test"])
      await assert.rejects(
        render(file, { returnTo }, { user: true, email: false }),
        (error: Error) => error.message === "REDIRECT:/profile"
      )
  }
  console.log(
    "Invitation onboarding pages passed: Google/ORCID/email account creation matrix, Google recovery, ORCID signup and cancellation, safe continuations, signed-in redirects and explicit invitation acceptance."
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
