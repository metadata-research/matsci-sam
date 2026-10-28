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
  user?: boolean
  outcome?: "live" | "expired" | "revoked" | "redeemed"
  retired?: boolean
  missing?: boolean
  open?: boolean
  study?: boolean
}
async function render(file: string, params = {}, options: Options = {}) {
  const signup = options.signup !== false && options.email !== false
  const deps: Record<string, unknown> = {
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
    "@/lib/dev-auth": { isDevAuthEnabled: () => false },
    "@/lib/apis/google": {
      isGoogleAuthConfigured: () => options.googleConfigured !== false,
      getGoogleAuthAccessMode: () =>
        options.googleOpen ? "open" : "existing-or-allowlisted"
    },
    "@/lib/apis/orcid": { isOrcidAuthEnabled: () => false },
    "@/lib/orcid": { ORCID_SIGN_IN_CANCELLED_NOTICE },
    "@/lib/current-user": {
      getCurrentUser: async () => (options.user ? { id: 1 } : null)
    },
    "@/lib/public-identifiers": identifiers,
    "@/lib/communities": communities,
    "@/lib/invitation-presentation": invitationCopy,
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
    }
  }
  const exports: { default?: (props: unknown) => Promise<ReactNode> } = {}
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
  return renderToStaticMarkup(
    await exports.default!({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve(params)
    })
  )
}
const invite = "app/invite/[token]/page.tsx"
const login = "app/login/page.tsx"
const register = "app/register/page.tsx"
const registrationLink = authReturn.authPathWithReturnTo(
  "/register",
  destination
)
const loginLink = authReturn.authPathWithReturnTo("/login", destination)

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
    await assert.rejects(render(register, {}, options), /NOT_FOUND/)
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
  for (const unsafe of [
    "https://elsewhere.test",
    "//elsewhere.test",
    "/admin/users"
  ]) {
    for (const file of [login, register]) {
      const html = await render(file, {
        returnTo: unsafe,
        google: "not-authorized"
      })
      assert.ok(!html.includes(unsafe))
      assert.doesNotMatch(html, /name="returnTo"/)
    }
  }
  await assert.rejects(
    render(login, { returnTo: destination }, { user: true }),
    (error: Error) => error.message === `REDIRECT:${destination}`
  )
  console.log(
    "Invitation onboarding pages passed: signup/sign-in choices, Google recovery, safe continuations, feature flags and explicit acceptance."
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
