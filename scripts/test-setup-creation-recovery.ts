import assert from "node:assert/strict"
import {
  isKnownSetupCreationRejection,
  newSetupCreationAttempt,
  restoreSetupCreationAttempt,
  setupCreationMatches,
  setupCreationStorageKey
} from "../lib/setup-creation-recovery"

const context = { userId: 7, storageKey: "matsci:setup:v1:7:guided::materials" }
const attempt = newSetupCreationAttempt({
  ...context,
  kind: "vocabulary",
  title: "  Materials  "
})
assert.equal(attempt.title, "Materials")
assert.equal(
  setupCreationStorageKey(context.storageKey),
  `${context.storageKey}:creation`
)
assert.deepEqual(
  restoreSetupCreationAttempt(JSON.stringify(attempt), context),
  attempt
)
assert.equal(
  restoreSetupCreationAttempt(JSON.stringify(attempt), {
    ...context,
    userId: 8
  }),
  null
)
assert.equal(
  restoreSetupCreationAttempt(JSON.stringify(attempt), {
    ...context,
    storageKey: "another-draft"
  }),
  null
)
assert.equal(restoreSetupCreationAttempt("not json", context), null)
assert.equal(
  restoreSetupCreationAttempt(
    JSON.stringify({ ...attempt, version: 2 }),
    context
  ),
  null
)

for (const code of [
  "BAD_REQUEST",
  "FORBIDDEN",
  "CONFLICT",
  "TOO_MANY_REQUESTS"
])
  assert.equal(isKnownSetupCreationRejection({ data: { code } }), true)
for (const error of [
  new TypeError("Failed to fetch"),
  { data: { code: "INTERNAL_SERVER_ERROR" } },
  { data: { code: "TIMEOUT" } },
  { data: null },
  { code: "FORBIDDEN" },
  null
])
  assert.equal(isKnownSetupCreationRejection(error), false)

const options = {
  communities: [
    {
      id: 3,
      slug: "materials",
      title: "Materials",
      vocabularySlug: "materials"
    }
  ],
  vocabularies: [
    { slug: "materials", title: "Materials", communityId: 3 },
    { slug: "materials_2", title: "Materials", communityId: null },
    { slug: "materials_3", title: "materials", communityId: null },
    { slug: "other", title: "Different materials", communityId: null }
  ],
  collections: [{ id: 4, slug: "materials_review", title: "Materials" }]
}
assert.deepEqual(
  setupCreationMatches(attempt, options).map((match) => match.slug),
  ["materials_2", "materials_3"],
  "Vocabulary recovery lists all possible standalone matches and never chooses automatically"
)
assert.equal(
  setupCreationMatches({ ...attempt, kind: "community" }, options)[0].href,
  "/communities/materials"
)
assert.equal(
  setupCreationMatches({ ...attempt, kind: "collection" }, options)[0].href,
  "/collections/materials_review"
)
console.log(
  "Setup creation recovery: account isolation, uncertain outcomes, and explicit candidate selection passed."
)
