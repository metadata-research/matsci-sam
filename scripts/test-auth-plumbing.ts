import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { GET as getLogin } from "../app/api/login/route"
import {
  createOneTimeToken,
  hashOneTimeToken,
  oneTimeTokenExpiry
} from "../lib/auth-tokens"
import { EmailAuthIntentSchema } from "../lib/email-auth-intent"
import {
  authPathWithReturnTo,
  normalizeAuthReturnTo,
  profileCompletionPath
} from "../lib/auth-return"
import {
  createEmailAuthLinkFragment,
  hashEmailAuthToken
} from "../lib/email-auth-token"
import {
  DEFINITION_MAX_LENGTH,
  EXAMPLE_MAX_LENGTH,
  TERM_MAX_LENGTH
} from "../lib/input-limits"
import { isValidOrcidId, normalizeOrcidId } from "../lib/orcid"
import { isGoogleAuthConfigured } from "../lib/apis/google"
import { DefineTermSchema } from "../lib/schemas/terms"

const loginResponse = getLogin()
assert.equal(loginResponse.status, 307)
assert.equal(loginResponse.headers.get("location"), "/login")

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && /\.(?:jsx?|tsx?)$/.test(entry.name) ? [path] : []
  })

for (const sourcePath of [
  ...sourceFiles(resolve("app")),
  ...sourceFiles(resolve("components"))
]) {
  const source = readFileSync(sourcePath, "utf8")
  const displayPath = relative(process.cwd(), sourcePath)
  assert.doesNotMatch(
    source,
    /<Link\b[^>]*\bhref\s*=\s*(?:\{\s*)?["'`]\/api\//,
    `${displayPath}: Next Link must not client-navigate to a Route Handler`
  )
  assert.doesNotMatch(
    source,
    /\brouter\.(?:push|replace)\(\s*["'`]\/api\//,
    `${displayPath}: the client router must not navigate to a Route Handler`
  )
}

assert.equal(
  normalizeOrcidId("https://orcid.org/0000-0002-1825-0097"),
  "0000-0002-1825-0097"
)
assert.equal(isValidOrcidId("0000-0002-1825-0097"), true)
assert.equal(isValidOrcidId("0000-0002-1825-0098"), false)
assert.equal(isValidOrcidId("not-an-orcid"), false)

const googleSettingNames = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_CALLBACK_URL",
  "GOOGLE_AUTH_ACCESS_MODE"
] as const
const originalGoogleSettings = Object.fromEntries(
  googleSettingNames.map((name) => [name, process.env[name]])
)
try {
  process.env.GOOGLE_CLIENT_ID = "client"
  process.env.GOOGLE_CLIENT_SECRET = "secret"
  process.env.GOOGLE_CALLBACK_URL = "https://example.test/auth/callback"
  process.env.GOOGLE_AUTH_ACCESS_MODE = "existing-or-allowlisted"
  assert.equal(isGoogleAuthConfigured(), true)
  delete process.env.GOOGLE_CLIENT_SECRET
  assert.equal(isGoogleAuthConfigured(), false)
  process.env.GOOGLE_CLIENT_SECRET = "secret"
  process.env.GOOGLE_AUTH_ACCESS_MODE = "unsupported"
  assert.equal(isGoogleAuthConfigured(), false)
} finally {
  for (const name of googleSettingNames) {
    const value = originalGoogleSettings[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

const firstToken = createOneTimeToken()
const secondToken = createOneTimeToken()
assert.match(firstToken, /^[A-Za-z0-9_-]{43}$/)
assert.notEqual(firstToken, secondToken)
assert.equal(hashOneTimeToken(firstToken).length, 64)
assert.equal(hashOneTimeToken(firstToken), hashOneTimeToken(firstToken))
assert.notEqual(hashOneTimeToken(firstToken), hashOneTimeToken(secondToken))
assert.equal(
  oneTimeTokenExpiry({ lifetimeMinutes: 15, now: 0 }),
  "1970-01-01T00:15:00.000Z"
)
assert.equal(EmailAuthIntentSchema.safeParse("sign-in").success, true)
assert.equal(EmailAuthIntentSchema.safeParse("create").success, true)
assert.equal(EmailAuthIntentSchema.safeParse("register").success, false)

const invitationReturnTo = `/invite/${"a".repeat(43)}`
assert.equal(normalizeAuthReturnTo(invitationReturnTo), invitationReturnTo)
assert.equal(normalizeAuthReturnTo("/invite/too-short"), null)
assert.equal(normalizeAuthReturnTo("/profile"), null)
assert.equal(normalizeAuthReturnTo("//example.org/invite/"), null)
assert.equal(normalizeAuthReturnTo("https://example.org/invite/token"), null)
assert.equal(
  authPathWithReturnTo("/login", invitationReturnTo),
  `/login?returnTo=${encodeURIComponent(invitationReturnTo)}`
)
assert.equal(
  authPathWithReturnTo("/api/auth/orcid?intent=login", invitationReturnTo),
  `/api/auth/orcid?intent=login&returnTo=${encodeURIComponent(invitationReturnTo)}`
)
assert.equal(
  profileCompletionPath(invitationReturnTo),
  `/profile/edit?welcome=1&returnTo=${encodeURIComponent(invitationReturnTo)}`
)

const emailToken = createOneTimeToken()
const otherInvitationReturnTo = `/invite/${"b".repeat(43)}`
assert.equal(
  hashEmailAuthToken(emailToken),
  hashOneTimeToken(emailToken),
  "ordinary links retain their token-only digest"
)
assert.notEqual(
  hashEmailAuthToken(emailToken, invitationReturnTo),
  hashEmailAuthToken(emailToken),
  "an invitation continuation is bound to the email token digest"
)
assert.notEqual(
  hashEmailAuthToken(emailToken, invitationReturnTo),
  hashEmailAuthToken(emailToken, otherInvitationReturnTo),
  "changing the invitation changes the email token digest"
)

const emailLinkParameters = new URLSearchParams(
  createEmailAuthLinkFragment(emailToken, invitationReturnTo)
)
assert.equal(emailLinkParameters.get("token"), emailToken)
assert.equal(emailLinkParameters.get("returnTo"), invitationReturnTo)
assert.equal(
  new URLSearchParams(createEmailAuthLinkFragment(emailToken, "/profile")).get(
    "returnTo"
  ),
  null,
  "non-invitation continuations are not carried in email links"
)

const loginPage = readFileSync(resolve("app/login/page.tsx"), "utf8")
const registrationPage = readFileSync(resolve("app/register/page.tsx"), "utf8")
const checkEmailPage = readFileSync(
  resolve("app/register/check-email/page.tsx"),
  "utf8"
)
const invitationPage = readFileSync(
  resolve("app/invite/[token]/page.tsx"),
  "utf8"
)
const emailStartRoute = readFileSync(
  resolve("app/api/auth/email/start/route.ts"),
  "utf8"
)
const emailVerifyRoute = readFileSync(
  resolve("app/api/auth/email/verify/route.ts"),
  "utf8"
)
const emailVerifyClient = readFileSync(
  resolve("app/register/verify/verify-email-link.tsx"),
  "utf8"
)
const schemaSource = readFileSync(resolve("drizzle/schema.ts"), "utf8")
const emailAuthTokenSchema = schemaSource.slice(
  schemaSource.indexOf("export const emailAuthTokensTable"),
  schemaSource.indexOf("export const usersTableRelations")
)
assert.match(loginPage, /name="intent" value="sign-in"/)
assert.match(registrationPage, /name="intent" value="create"/)
assert.match(registrationPage, /isEmailAccountCreationEnabled\(\)/)
assert.match(loginPage, /Continue to \{SITE_NAME\}/)
assert.match(loginPage, /isGoogleAuthConfigured\(\)/)
assert.match(loginPage, /Continue with Google/)
assert.match(loginPage, /Google sign-in is not configured on this site\./)
assert.match(loginPage, /Continue with ORCID/)
assert.match(loginPage, /ORCID sign-in is not available yet\./)
assert.match(
  loginPage,
  /If an account exists for this address, MatSci-SAM will[\s\S]*email a one-time sign-in link\./
)
assert.match(loginPage, /aria-describedby="login-email-help"/)
assert.match(
  checkEmailPage,
  /sends a sign-in link only for[\s\S]*an existing account/
)
assert.match(
  checkEmailPage,
  /New contributors receive a link after[\s\S]*choosing Create an account with email/
)
const orcidDescriptionReference = loginPage.indexOf(
  'aria-describedby="orcid-unavailable"'
)
assert.notEqual(orcidDescriptionReference, -1)
const unavailableOrcidButton = loginPage.slice(
  loginPage.lastIndexOf("<Button", orcidDescriptionReference),
  loginPage.indexOf("</Button>", orcidDescriptionReference)
)
assert.match(unavailableOrcidButton, /\bdisabled\b/)
assert.doesNotMatch(unavailableOrcidButton, /\bhref=/)
assert.match(loginPage, /id="orcid-unavailable"/)
assert.match(registrationPage, /Create an account with email/)
assert.match(registrationPage, /Create account with email/)
assert.match(registrationPage, /isGoogleAuthConfigured\(\)/)
assert.match(registrationPage, /Continue with Google instead/)
assert.ok(
  registrationPage.indexOf("Continue with Google instead") <
    registrationPage.indexOf('action="/api/auth/email/start"'),
  "Google must precede the email-creation form for returning contributors"
)
assert.match(invitationPage, /Continue to accept this invitation\./)
assert.match(invitationPage, /authPathWithReturnTo\("\/login", returnTo\)/)
assert.doesNotMatch(
  invitationPage,
  /community\.description\s*&&\s*!study/,
  "community invitations must not repeat the separate community description"
)
assert.doesNotMatch(
  invitationPage,
  /authPathWithReturnTo\("\/register", returnTo\)/,
  "the invitation must not offer a registration route that may be disabled"
)
assert.match(
  emailStartRoute,
  /if \(!allowAccountCreation\)[\s\S]*usersTable\.email[\s\S]*if \(!existingUser\) return false/
)
assert.match(
  emailVerifyRoute,
  /else if \(claimed\.allowAccountCreation\)[\s\S]*insert\(usersTable\)/
)
assert.match(emailStartRoute, /hashEmailAuthToken\(token, returnTo\)/)
assert.match(
  emailStartRoute,
  /sendEmailSignInLink\(\{ email, token, returnTo \}\)/
)
assert.match(emailVerifyRoute, /hashEmailAuthToken\(token, returnTo\)/)
assert.doesNotMatch(emailVerifyRoute, /emailAuthTokensTable\.returnTo/)
assert.match(emailVerifyClient, /JSON\.stringify\(\{ token, returnTo \}\)/)
assert.doesNotMatch(
  emailAuthTokenSchema,
  /\breturnTo\s*:/,
  "raw invitation continuations must not be persisted with email tokens"
)

const validTerm = {
  term: "t".repeat(TERM_MAX_LENGTH),
  definition: "d".repeat(DEFINITION_MAX_LENGTH),
  initialExample: "e".repeat(EXAMPLE_MAX_LENGTH)
}
assert.equal(DefineTermSchema.safeParse(validTerm).success, true)
assert.deepEqual(
  Object.keys(DefineTermSchema.shape),
  ["term", "definition", "initialExample"],
  "a first example can share the form while retaining independent storage"
)
assert.equal(
  DefineTermSchema.safeParse({
    ...validTerm,
    term: `${validTerm.term}t`
  }).success,
  false
)
assert.equal(
  DefineTermSchema.safeParse({
    ...validTerm,
    initialExample: `${validTerm.initialExample}e`
  }).success,
  false
)
assert.equal(
  DefineTermSchema.safeParse({
    ...validTerm,
    definition: `${validTerm.definition}d`
  }).success,
  false
)

console.log("Authentication plumbing helper checks passed.")
