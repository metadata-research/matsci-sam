import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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
  positionAcceptanceExplanation,
  scaleLabelsForPrompt,
  studyWindowExplanation
} from "../lib/study-presentation"
import {
  parseSearchHeadline,
  SEARCH_HIGHLIGHT_END,
  SEARCH_HIGHLIGHT_START
} from "../lib/search-evidence"
import { studyActivityActionLabel } from "../components/studies/progress"
import {
  communityInvitationPageCopy,
  communityInvitationMessage,
  invitationOutcomeLabel,
  invitationRedeemedByLabel
} from "../lib/invitation-presentation"
import { parseStudyInstructions } from "../lib/study-instructions"

assert.deepEqual(
  parseStudyInstructions(
    "Short introduction.\n\n1. Choose the closest definition.\n2. Accept or revise it.\n3. Propose a new one if needed.\n\nOne closing sentence."
  ),
  [
    { kind: "paragraph", text: "Short introduction." },
    {
      kind: "steps",
      items: [
        "Choose the closest definition.",
        "Accept or revise it.",
        "Propose a new one if needed."
      ]
    },
    { kind: "paragraph", text: "One closing sentence." }
  ]
)
assert.deepEqual(parseStudyInstructions("1. One sentence, not a list."), [
  { kind: "paragraph", text: "1. One sentence, not a list." }
])

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

assert.equal(studyActivityActionLabel(0, 1, 11), "Begin study")
assert.equal(
  studyActivityActionLabel(5, 6, 11),
  "Continue study (step 6 of 11)"
)
assert.equal(studyActivityActionLabel(11, null, 11), null)

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

assert.equal(
  positionAcceptanceExplanation(null),
  "Accepting records this definition as your position and adds your upvote."
)
assert.equal(
  positionAcceptanceExplanation("up"),
  "You already upvoted this definition. Accept will use that vote as your position."
)
assert.equal(
  positionAcceptanceExplanation("down"),
  "You previously downvoted this definition. Accept will change it to an upvote."
)

assert.equal(invitationOutcomeLabel("live"), "Pending")
assert.equal(invitationOutcomeLabel("redeemed"), "Accepted")
assert.equal(invitationOutcomeLabel("expired"), "Expired")
assert.equal(invitationOutcomeLabel("revoked"), "Revoked")
assert.equal(
  invitationRedeemedByLabel({
    intendedEmail: "invited@example.test",
    name: "Jane Scientist",
    email: "jane@example.test"
  }),
  "Jane Scientist (jane@example.test)"
)
assert.equal(
  invitationRedeemedByLabel({
    intendedEmail: "JANE@example.test",
    name: "Jane Scientist",
    email: "jane@example.test"
  }),
  "Jane Scientist",
  "the account address is not repeated when it matches the intended recipient"
)
assert.equal(
  invitationRedeemedByLabel({
    intendedEmail: "invited@example.test",
    name: null,
    email: null
  }),
  "a signed-in participant"
)

// The invitation email leads with the study when the invitation carries one,
// because the recipient may already be in the community. A community
// invitation keeps the join wording.
const studyMessage = communityInvitationMessage({
  communitySlug: "mrc",
  communityTitle: "Metadata Research Center",
  studyTitle: "New Materials workflow rehearsal",
  url: "https://example.test/invite/token",
  siteName: "MatSci-SAM"
})
assert.equal(
  studyMessage.subject,
  "You have been asked to take part in New Materials workflow rehearsal"
)
assert.match(
  studyMessage.text,
  /Metadata Research Center has asked you to take part in the study New Materials workflow rehearsal on MatSci-SAM\./
)
assert.match(
  studyMessage.text,
  /joins you to Metadata Research Center if you are not already in it/
)
assert.doesNotMatch(studyMessage.text, /You have been invited to join/)

const communityMessage = communityInvitationMessage({
  communitySlug: "mrc",
  communityTitle: "Metadata Research Center",
  studyTitle: null,
  url: "https://example.test/invite/token",
  siteName: "MatSci-SAM"
})
assert.equal(
  communityMessage.subject,
  "Invitation to join the Metadata Research Center Vocabulary Community"
)
assert.match(
  communityMessage.text,
  /You have been invited to join the Metadata Research Center Vocabulary Community on MatSci-SAM\./
)
assert.doesNotMatch(communityMessage.text, /take part in the study/)

assert.deepEqual(
  communityInvitationPageCopy({
    communitySlug: "id4",
    communityTitle: "ID4",
    siteName: "MatSci-SAM",
    alreadyIn: false
  }),
  {
    title: "Join ID4",
    description:
      "You have been invited to join the NSF Institute for Data-Driven Dynamical Design (ID4) Vocabulary Community on MatSci-SAM."
  }
)
assert.deepEqual(
  communityInvitationPageCopy({
    communitySlug: "id4",
    communityTitle: "ID4",
    siteName: "MatSci-SAM",
    alreadyIn: true
  }),
  {
    title: "ID4",
    description:
      "You are already a member of the NSF Institute for Data-Driven Dynamical Design (ID4) Vocabulary Community."
  }
)

const communityPage = readFileSync(
  resolve("app/communities/[slug]/page.tsx"),
  "utf8"
)
assert.match(
  communityPage,
  /\{\(runs \|\| loose\.length > 0\) && \(/,
  "plain members must not see an empty additional-collections section"
)
assert.match(
  communityPage,
  /row\.studySlug === null && \(runs \|\| row\.retiredAt === null\)/,
  "plain members must not see retired additional collections"
)
assert.match(
  communityPage,
  /collection\.retiredAt === null &&\s*!onWorklist\.has\(collection\.id\)/,
  "stewards must not be offered a retired collection to add"
)
assert.match(communityPage, />Additional collections<\/h2>/)
assert.doesNotMatch(communityPage, /Other terms in view/)

// Titles are contributor text, so the HTML body escapes them.
assert.match(
  communityInvitationMessage({
    communitySlug: "alloys",
    communityTitle: "Alloys <careful> & co",
    studyTitle: null,
    url: "https://example.test/invite/token",
    siteName: "MatSci-SAM"
  }).html,
  /Alloys &lt;careful&gt; &amp; co/
)

console.log("Interface state tests passed")
