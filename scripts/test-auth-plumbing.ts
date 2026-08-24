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
import { DEFINITION_MAX_LENGTH, TERM_MAX_LENGTH } from "../lib/input-limits"
import { isValidOrcidId, normalizeOrcidId } from "../lib/orcid"
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

const loginPage = readFileSync(resolve("app/login/page.tsx"), "utf8")
const registrationPage = readFileSync(resolve("app/register/page.tsx"), "utf8")
const emailStartRoute = readFileSync(
  resolve("app/api/auth/email/start/route.ts"),
  "utf8"
)
const emailVerifyRoute = readFileSync(
  resolve("app/api/auth/email/verify/route.ts"),
  "utf8"
)
assert.match(loginPage, /name="intent" value="sign-in"/)
assert.match(registrationPage, /name="intent" value="create"/)
assert.match(registrationPage, /isEmailAccountCreationEnabled\(\)/)
assert.match(
  emailStartRoute,
  /if \(!allowAccountCreation\)[\s\S]*usersTable\.email[\s\S]*if \(!existingUser\) return false/
)
assert.match(
  emailVerifyRoute,
  /else if \(claimed\.allowAccountCreation\)[\s\S]*insert\(usersTable\)/
)

const validTerm = {
  term: "t".repeat(TERM_MAX_LENGTH),
  definition: "d".repeat(DEFINITION_MAX_LENGTH)
}
assert.equal(DefineTermSchema.safeParse(validTerm).success, true)
assert.deepEqual(
  Object.keys(DefineTermSchema.shape),
  ["term", "definition"],
  "publishing a new term does not bundle an example contribution"
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
    definition: `${validTerm.definition}d`
  }).success,
  false
)

console.log("Authentication plumbing helper checks passed.")
