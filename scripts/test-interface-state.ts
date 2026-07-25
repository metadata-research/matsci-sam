import assert from "node:assert/strict"
import { initialTermFromSearchParam } from "../app/add/initial-term"
import {
  parseSearchAuthor,
  updateSearchResultSelection
} from "../app/search/search-state"
import { isFeedbackPagePath } from "../lib/feedback-path"
import {
  FEEDBACK_PAGE_PATH_MAX_LENGTH,
  TERM_MAX_LENGTH
} from "../lib/input-limits"

assert.equal(parseSearchAuthor(null), "all")
assert.equal(parseSearchAuthor(""), "all")
assert.equal(parseSearchAuthor("bogus"), "all")
assert.equal(parseSearchAuthor("all"), "all")
assert.equal(parseSearchAuthor("human"), "human")
assert.equal(parseSearchAuthor("ai"), "ai")

assert.deepEqual(
  updateSearchResultSelection(
    { showTerms: true, showDefinitions: true },
    "terms",
    false
  ),
  { showTerms: false, showDefinitions: true }
)
assert.deepEqual(
  updateSearchResultSelection(
    { showTerms: false, showDefinitions: true },
    "definitions",
    false
  ),
  { showTerms: false, showDefinitions: true }
)
assert.deepEqual(
  updateSearchResultSelection(
    { showTerms: true, showDefinitions: false },
    "definitions",
    true
  ),
  { showTerms: true, showDefinitions: true }
)

assert.equal(initialTermFromSearchParam(undefined), "")
assert.equal(initialTermFromSearchParam("  martensite  "), "martensite")
assert.equal(initialTermFromSearchParam(["austenite", "ignored"]), "austenite")
assert.equal(
  initialTermFromSearchParam("x".repeat(TERM_MAX_LENGTH + 10)).length,
  TERM_MAX_LENGTH
)

for (const path of [
  "/",
  "/search",
  "/vocabulary/martensite",
  "/docs/metadata-access"
])
  assert.equal(isFeedbackPagePath(path), true, path)

for (const path of [
  "",
  "search",
  "//example.com",
  "/search?q=steel",
  "/search#results",
  "/docs\\search",
  "/docs/../api/auth/logout",
  "/docs/./search",
  "/docs/%2e%2e/api/auth/logout",
  "/api",
  "/api/auth/logout",
  "/_next",
  "/_next/static/chunk.js",
  `/search\u0000`,
  `/${"x".repeat(FEEDBACK_PAGE_PATH_MAX_LENGTH)}`
])
  assert.equal(isFeedbackPagePath(path), false, path)

console.log("Interface state tests passed")
