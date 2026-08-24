import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { resolveFeaturedActivity } from "../lib/featured-provenance"

const canonical = {
  intent: "new_term" as const,
  model: "canonical-model",
  createdAt: "2026-08-24T10:00:00.000Z",
  decidedAt: "2026-08-24T10:05:00.000Z"
}
const legacyDiscussion = {
  model: "discussion-model",
  createdAt: "2025-01-02T10:00:00.000Z",
  acceptedAt: "2025-01-02T10:10:00.000Z"
}
const legacyRefinement = {
  model: "refinement-model",
  suggestedAt: "2024-01-02T10:00:00.000Z",
  decidedAt: "2024-01-02T10:10:00.000Z"
}

assert.deepEqual(
  resolveFeaturedActivity({
    canonicalSuggestion: canonical,
    legacyDiscussionSuggestion: legacyDiscussion,
    legacyRefinement,
    refinedFromId: 4,
    createdAt: "2026-08-24T11:00:00.000Z"
  }),
  {
    activityKind: "canonical-ai",
    aiIntent: "new_term",
    activityModel: "canonical-model",
    suggestedAt: canonical.createdAt,
    decidedAt: canonical.decidedAt
  },
  "canonical output provenance takes precedence over historical records"
)

assert.deepEqual(
  resolveFeaturedActivity({
    legacyDiscussionSuggestion: legacyDiscussion,
    legacyRefinement,
    refinedFromId: 4,
    createdAt: "2026-08-24T11:00:00.000Z"
  }),
  {
    activityKind: "legacy-ai",
    aiIntent: "revise_definition",
    activityModel: "discussion-model",
    suggestedAt: legacyDiscussion.createdAt,
    decidedAt: legacyDiscussion.acceptedAt
  },
  "an accepted retired discussion suggestion keeps its AI attribution"
)

assert.equal(
  resolveFeaturedActivity({
    legacyRefinement,
    refinedFromId: 4,
    createdAt: "2026-08-24T11:00:00.000Z"
  }).activityModel,
  "refinement-model"
)
assert.equal(
  resolveFeaturedActivity({
    refinedFromId: 4,
    createdAt: "2026-08-24T11:00:00.000Z"
  }).activityKind,
  "human-revision"
)
assert.equal(
  resolveFeaturedActivity({
    refinedFromId: null,
    createdAt: "2026-08-24T11:00:00.000Z"
  }).activityKind,
  "initial"
)

const querySource = readFileSync(
  resolve("lib/ai-contribution-provenance.ts"),
  "utf8"
)
assert.match(
  querySource,
  /discussionSuggestionsTable\.outputDefinitionId,[\s\S]*outputDefinitionIds/,
  "legacy discussion provenance is joined by its exact output definition"
)
assert.match(
  querySource,
  /aiContributionSuggestionsTable\.status, "accepted"[\s\S]*aiContributionSuggestionsTable\.outputDefinitionId,[\s\S]*outputDefinitionIds/,
  "canonical provenance requires accepted status and exact output linkage"
)

const homepageSource = readFileSync(resolve("app/page.tsx"), "utf8")
assert.match(
  homepageSource,
  /eq\(refinementsTable\.id, outputRevision\.sourceRefinementId\),[\s\S]*eq\(refinementsTable\.status, "accepted"\)/,
  "legacy refinement provenance requires an accepted source round"
)

console.log("Featured provenance routing checks passed.")
