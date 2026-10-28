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
import {
  isValidOrcidId,
  normalizeOrcidId,
  ORCID_PROFILE_NOTICES,
  ORCID_SIGN_IN_CANCELLED_NOTICE,
  orcidProfileNotice
} from "../lib/orcid"
import { publicRedirect } from "../lib/public-redirect"
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

for (const outcome of ["connected", "cancelled", "disconnected"] as const)
  assert.equal(orcidProfileNotice(outcome), ORCID_PROFILE_NOTICES[outcome])
for (const value of [undefined, "", "toString", "__proto__", ["connected"]])
  assert.equal(orcidProfileNotice(value), null, String(value))

// Behind the proxy the request URL names 127.0.0.1, so the ORCID routes never
// build a URL from it, and redirects within the site use relative Locations.
for (const [path, status] of [
  ["/profile?orcid=connected", 307],
  ["/profile?orcid=disconnected", 303]
] as const) {
  const response = publicRedirect(path, status)
  assert.equal(response.status, status)
  assert.equal(response.headers.get("location"), path)
}
assert.throws(() => publicRedirect("//example.org/profile"))
for (const routePath of [
  "app/api/auth/orcid/route.ts",
  "app/api/auth/orcid/callback/route.ts",
  "app/api/auth/orcid/disconnect/route.ts"
]) {
  const source = readFileSync(resolve(routePath), "utf8")
  assert.doesNotMatch(
    source,
    /\b(?:request|req)\.url\b/,
    `${routePath}: an ORCID route must not use the internal request URL`
  )
}
const orcidCallbackRoute = readFileSync(
  resolve("app/api/auth/orcid/callback/route.ts"),
  "utf8"
)
assert.match(
  orcidCallbackRoute,
  /completeOrcidAuthorization\(request\.nextUrl\.search, pending\)/
)
assert.match(orcidCallbackRoute, /"\/login\?orcid=cancelled"/)
assert.match(orcidCallbackRoute, /providerError === "access_denied"/)

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
  process.env.GOOGLE_AUTH_ACCESS_MODE = "open"
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
for (const path of [
  "/setup",
  "/setup?task=import&vocabularySlug=materials&communityId=12",
  "/add",
  "/add?vocabularySlug=materials&term=grain+boundary",
  "/add?term=Fe%2FC",
  "/profile/drafts/imports/74dde90f-41bf-4912-bccc-d1761cf58a50",
  "/communities/matcore_development?view=work",
  "/metadata/workspace?vocabularySlug=local_fields&offset=40",
  "/metadata/workspace",
  "/metadata/workspace/74dde90f-41bf-4912-bccc-d1761cf58a50"
])
  assert.equal(normalizeAuthReturnTo(path), path)
for (const path of [
  "/setup?next=https://example.org",
  "/setup?task=admin",
  "/setup?task=import&task=community",
  "/setup?communityId=-1",
  "/setup?vocabularySlug=../admin",
  "/add?term=a%0Ab",
  "/add?vocabularySlug=a&vocabularySlug=b",
  "/add#example",
  "/setup/../admin",
  "//example.org/setup",
  "/add\\example",
  "/setup?task=import?next=x",
  "/profile/drafts/imports/not-an-id",
  "/profile/drafts/imports/74dde90f-41bf-4912-bccc-d1761cf58a50?next=/admin",
  "/profile/drafts/imports/74dde90f-41bf-4912-bccc-d1761cf58a50/../../admin",
  "/communities/example?view=work&next=/admin",
  "/communities/example?view=work&view=people",
  "/communities/example?offset=-1",
  "/communities/example#private",
  "/metadata/workspace/not-an-id",
  "/metadata/workspace?next=https://example.org",
  "/metadata/workspace/74dde90f-41bf-4912-bccc-d1761cf58a50/../../admin",
  "/metadata/workspace/74dde90f-41bf-4912-bccc-d1761cf58a50?next=/admin",
  "/metadata/workspace#private",
  "//example.org/metadata/workspace"
])
  assert.equal(normalizeAuthReturnTo(path), null, path)
assert.equal(normalizeAuthReturnTo(invitationReturnTo), invitationReturnTo)
assert.equal(normalizeAuthReturnTo("/invite/too-short"), null)
assert.equal(normalizeAuthReturnTo("/profile"), null)
assert.equal(normalizeAuthReturnTo("//example.org/invite/"), null)
assert.equal(normalizeAuthReturnTo("https://example.org/invite/token"), null)
const studyReturnTo = "/studies/id4_round_two"
const studyRunReturnTo = `${studyReturnTo}/run`
for (const path of [
  studyReturnTo,
  studyRunReturnTo,
  "/studies/materials-review"
]) {
  assert.equal(normalizeAuthReturnTo(path), path)
  assert.equal(
    profileCompletionPath(path),
    `/profile/edit?welcome=1&returnTo=${encodeURIComponent(path)}`
  )
}
for (const path of [
  "/studies",
  "/studies/",
  "/studies/id4_round_two/admin",
  "/studies/id4_round_two?returnTo=//example.org",
  "/studies/id4_round_two#fragment",
  "/studies/../admin",
  "/studies/%2e%2e%2fadmin",
  "/studies/id4%2frun",
  "/studies/id4\\run",
  "/studies/id4_round_two\n",
  `${invitationReturnTo}\n`,
  "//example.org/studies/id4_round_two",
  "https://example.org/studies/id4_round_two"
]) {
  assert.equal(normalizeAuthReturnTo(path), null, path)
}
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
  "unapproved continuations are not carried in email links"
)
for (const path of [studyReturnTo, studyRunReturnTo]) {
  const parameters = new URLSearchParams(
    createEmailAuthLinkFragment(emailToken, path)
  )
  assert.equal(parameters.get("returnTo"), path)
  assert.notEqual(
    hashEmailAuthToken(emailToken, path),
    hashEmailAuthToken(emailToken)
  )
}
assert.notEqual(
  hashEmailAuthToken(emailToken, studyReturnTo),
  hashEmailAuthToken(emailToken, studyRunReturnTo),
  "changing the study destination invalidates the email token digest"
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
const rootLayout = readFileSync(resolve("app/layout.tsx"), "utf8")
const emailVerifyPage = readFileSync(
  resolve("app/register/verify/page.tsx"),
  "utf8"
)
// Client navigation must explicitly restore the ordinary document policy after
// verification. Removing its no-referrer meta alone leaves native POST Origin
// null in the browser; keep token-page protection and the CSRF check intact.
assert.match(rootLayout, /referrer:\s*"strict-origin-when-cross-origin"/)
assert.match(emailVerifyPage, /referrer:\s*"no-referrer"/)
assert.match(
  emailStartRoute,
  /request\.headers\.get\("origin"\) !== expectedOrigin/
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
  loginPage.replace(/\s+/g, " "),
  /For existing accounts\. Use the email address on your MatSci-SAM account to receive a one-time sign-in link\./
)
assert.match(loginPage, /aria-describedby="login-email-help"/)
assert.match(
  checkEmailPage.replace(/\s+/g, " "),
  /If this email address belongs to an account, you will receive a one-time link to sign in\./
)
assert.match(
  checkEmailPage.replace(/\s+/g, " "),
  /Open the one-time link to confirm your email address and create your account\./
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
assert.match(loginPage, /orcid === "cancelled"/)
assert.match(loginPage, /ORCID_SIGN_IN_CANCELLED_NOTICE/)
assert.match(ORCID_SIGN_IN_CANCELLED_NOTICE, /^ORCID sign-in was cancelled\./)
assert.match(registrationPage, /Create an account with email/)
assert.match(registrationPage, /Create account with email/)
// Rendered invitation/signup affordances and disabled-signup cases are covered
// by test-invitation-onboarding, rather than source-order assertions here.
assert.match(invitationPage, /authPathWithReturnTo\("\/login", returnTo\)/)
assert.doesNotMatch(
  invitationPage,
  /community\.description\s*&&\s*!study/,
  "community invitations must not repeat the separate community description"
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
