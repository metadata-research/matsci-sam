import assert from "node:assert/strict"
import { initialTermFromSearchParam } from "../app/add/initial-term"
import {
  parseSearchAuthor,
  parseSearchFacets,
  updateSearchFacetSelection,
  updateSearchResultSelection
} from "../app/search/search-state"
import { isFeedbackPagePath } from "../lib/feedback-path"
import {
  FEEDBACK_PAGE_PATH_MAX_LENGTH,
  TERM_MAX_LENGTH
} from "../lib/input-limits"
import {
  DEFAULT_LIKELIHOOD_QUESTION,
  MOST_SUPPORTED_DEFINITIONS_HEADING,
  scaleLabelsForPrompt,
  studySupportDescription,
  studyWindowExplanation,
  studyWelcomeHeading
} from "../lib/study-presentation"
import {
  parseSearchHeadline,
  SEARCH_HIGHLIGHT_END,
  SEARCH_HIGHLIGHT_START
} from "../lib/search-evidence"

assert.equal(parseSearchAuthor(null), "all")
assert.equal(parseSearchAuthor(""), "all")
assert.equal(parseSearchAuthor("bogus"), "all")
assert.equal(parseSearchAuthor("all"), "all")
assert.equal(parseSearchAuthor("human"), "human")
assert.equal(parseSearchAuthor("ai"), "ai")

assert.deepEqual(
  parseSearchFacets([
    "pspp:processing",
    "pspp:processing",
    "topics:heat-treatment",
    "not a facet"
  ]),
  ["pspp:processing", "topics:heat-treatment"]
)
assert.deepEqual(
  updateSearchFacetSelection(["pspp:processing"], "pspp:structure", true),
  ["pspp:processing", "pspp:structure"]
)
assert.deepEqual(
  updateSearchFacetSelection(
    ["pspp:processing", "pspp:structure"],
    "pspp:processing",
    false
  ),
  ["pspp:structure"]
)
assert.deepEqual(
  updateSearchFacetSelection(["pspp:processing"], "invalid key", true),
  ["pspp:processing"]
)

assert.deepEqual(parseSearchHeadline("plain evidence"), [
  { text: "plain evidence", highlighted: false }
])
assert.deepEqual(
  parseSearchHeadline(
    `before ${SEARCH_HIGHLIGHT_START}steel${SEARCH_HIGHLIGHT_END} after`
  ),
  [
    { text: "before ", highlighted: false },
    { text: "steel", highlighted: true },
    { text: " after", highlighted: false }
  ]
)
const malformedHeadline = parseSearchHeadline(
  `before ${SEARCH_HIGHLIGHT_START}unfinished`
)
assert.ok(malformedHeadline.every((part) => !part.highlighted))
assert.equal(
  malformedHeadline.map((part) => part.text).join(""),
  `before ${SEARCH_HIGHLIGHT_START}unfinished`
)

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

assert.equal(studyWelcomeHeading("closed", 0), "About this study")
assert.equal(studyWelcomeHeading("open", 7), "What to do")
assert.equal(studyWelcomeHeading("draft", 7), "What to do")

assert.equal(MOST_SUPPORTED_DEFINITIONS_HEADING, "Most supported definitions")
assert.equal(
  studySupportDescription(null),
  "For each term, the candidate with the greatest site-wide net support is " +
    "shown. Support is current-revision upvotes minus downvotes from all " +
    "accounts, not only this study or community. A tie goes to the earlier " +
    "candidate."
)
const closedSupport = studySupportDescription("Sep 17, 2025 at 12:00 AM")
assert.match(closedSupport, /vote events recorded at or before/)
assert.match(
  closedSupport,
  /candidates, their text, and the collection's terms remain current/i
)
assert.match(closedSupport, /not limited to this study or community/)
assert.doesNotMatch(closedSupport, /agreed|consensus|snapshot/i)

const walkthroughWindow = studyWindowExplanation(7)
assert.match(walkthroughWindow, /only while the study is open/)
assert.match(walkthroughWindow, /before a future opening date/)
assert.match(walkthroughWindow, /not once the study has closed or been retired/)
assert.doesNotMatch(walkthroughWindow, /nothing is locked/i)
const archivalWindow = studyWindowExplanation(0)
assert.match(archivalWindow, /record the study period/)
assert.doesNotMatch(archivalWindow, /walkthrough/)

assert.deepEqual(scaleLabelsForPrompt(DEFAULT_LIKELIHOOD_QUESTION), {
  minimum: "Not likely",
  maximum: "Very likely"
})
assert.deepEqual(scaleLabelsForPrompt(`${DEFAULT_LIKELIHOOD_QUESTION} `), {
  minimum: "Lowest",
  maximum: "Highest"
})
assert.deepEqual(scaleLabelsForPrompt("How complete is this list?"), {
  minimum: "Lowest",
  maximum: "Highest"
})

console.log("Interface state tests passed")
