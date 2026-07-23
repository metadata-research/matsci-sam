import assert from "node:assert/strict"
import {
  createOneTimeToken,
  hashOneTimeToken,
  oneTimeTokenExpiry
} from "../lib/auth-tokens"
import {
  DEFINITION_MAX_LENGTH,
  EXAMPLE_MAX_LENGTH,
  TERM_MAX_LENGTH
} from "../lib/input-limits"
import { isValidOrcidId, normalizeOrcidId } from "../lib/orcid"
import { DefineTermSchema } from "../lib/schemas/terms"

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

const validTerm = {
  term: "t".repeat(TERM_MAX_LENGTH),
  definition: "d".repeat(DEFINITION_MAX_LENGTH),
  examples: "e".repeat(EXAMPLE_MAX_LENGTH)
}
assert.equal(DefineTermSchema.safeParse(validTerm).success, true)
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
assert.equal(
  DefineTermSchema.safeParse({
    ...validTerm,
    examples: `${validTerm.examples}e`
  }).success,
  false
)

console.log("Authentication plumbing helper checks passed.")
