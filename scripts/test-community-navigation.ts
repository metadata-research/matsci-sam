import { compareCommunityContributions } from "../lib/community-contribution-order"
import assert from "node:assert/strict"
import {
  COMMUNITY_SECTIONS,
  communitySection,
  communitySectionHref
} from "../lib/community-navigation"
import {
  communityContributionActions,
  communityCreationActions,
  setupHref
} from "../lib/community-actions"
import {
  normalizeCommunityContributionReturnTo,
  withCommunityContributionReturn
} from "../lib/community-contribution-return"
import { normalizeAuthReturnTo } from "../lib/auth-return"
import {
  communityWorkspaceReturnLabel,
  withCommunityWorkspaceReturn
} from "../lib/community-workspace-return"

assert.deepEqual(
  COMMUNITY_SECTIONS.map((section) => section.label),
  ["Quick start", "Browse", "Contributions", "Reviews", "My work", "People"]
)
assert.equal(communitySection("proposals"), "contributions")
assert.equal(communitySection("releases"), "vocabulary")

const context = {
  communityId: 7,
  communitySlug: "materials_group",
  vocabularySlug: "shared_terms",
  profile: "pf"
}
const ordinary = communityContributionActions(context)
assert.equal(ordinary.field, null)
assert.equal(ordinary.term.href, "/add?vocabularySlug=shared_terms")
const metadata = communityContributionActions({
  ...context,
  metadataEnabled: true
})
assert.equal(
  metadata.term.href,
  ordinary.term.href,
  "metadata never silently changes the term editor"
)
assert.equal(
  metadata.field?.href,
  "/communities/materials_group?view=contributions&profile=pf&action=new"
)
const olderReferenceAction = communityContributionActions({
  ...context,
  metadataEnabled: true,
  release: "matcore:0.2.0"
})
const olderField = new URL(
  olderReferenceAction.field!.href,
  "https://example.org"
)
assert.equal(
  olderField.searchParams.get("release"),
  "matcore:0.2.0",
  "New field action retains the selected reference release"
)
assert.equal(
  olderField.searchParams.get("profile"),
  "pf",
  "New field action retains the selected area"
)
assert.equal(
  olderField.searchParams.get("action"),
  "new",
  "Reference context still opens the new-field dialog"
)
assert.equal(
  normalizeAuthReturnTo(olderField.pathname + olderField.search),
  olderField.pathname + olderField.search,
  "New field signup return accepts the selected reference version"
)
assert.equal(
  olderReferenceAction.term.href,
  ordinary.term.href,
  "Reference context does not redirect the ordinary term editor"
)
assert.equal(
  communityContributionActions({ metadataEnabled: true }).field,
  null,
  "no field editor without a known community destination"
)
assert.equal(
  metadata.change.href,
  "/communities/materials_group?view=vocabulary&profile=pf"
)
assert.equal(
  metadata.feedback.href,
  "/communities/materials_group?view=review&profile=pf"
)
assert.equal(
  metadata.draft.href,
  "/communities/materials_group?view=work&profile=pf"
)
assert.equal(communityContributionActions().draft.href, "/profile/drafts")
assert.equal(
  communityCreationActions(context).some((action) => action.id === "field"),
  false
)
assert.equal(
  communityCreationActions({ ...context, metadataEnabled: true }).find(
    (action) => action.id === "field"
  )?.href,
  metadata.field?.href
)
assert.equal(
  setupHref(context, "import"),
  "/setup?task=import&communityId=7&vocabularySlug=shared_terms"
)

const navigationContext = new URLSearchParams({
  view: "contributions",
  profile: "pf",
  standard: "reference",
  release: "matcore:0.3.0",
  layout: "hierarchy",
  q: "mesh & domain",
  status: "awaiting_review",
  type: "proposal",
  action: "new",
  target: "proposal:private",
  offset: "80"
})
const next = new URL(
  communitySectionHref(context.communitySlug, "vocabulary", navigationContext),
  "https://example.org"
)
assert.equal(next.searchParams.get("view"), "vocabulary")
for (const key of [
  "profile",
  "standard",
  "release",
  "layout",
  "q",
  "status",
  "type"
]) {
  assert.equal(next.searchParams.get(key), navigationContext.get(key), key)
}
for (const key of ["action", "target", "offset"])
  assert.equal(
    next.searchParams.has(key),
    false,
    `do not replay ${key} on another tab`
  )

const revision = "b450446a-562c-4273-b78a-e4981d9b5199"
const returnTo = `/communities/materials_group?view=contributions&profile=pf&type=proposal&status=awaiting_review&q=mesh&selected=proposal:${revision}&action=export`
assert.equal(
  normalizeCommunityContributionReturnTo(returnTo, "materials_group"),
  returnTo
)
assert.equal(
  normalizeCommunityContributionReturnTo(returnTo, "other_group"),
  null
)
assert.equal(normalizeAuthReturnTo(returnTo), returnTo)
const draft = withCommunityContributionReturn(
  `/metadata/workspace/${revision}`,
  returnTo
)
assert.equal(
  new URL(draft, "http://local").searchParams.get("returnTo"),
  returnTo
)
assert.equal(normalizeAuthReturnTo(draft), draft)
assert.equal(communityWorkspaceReturnLabel(returnTo), "Back to contributions")
assert.equal(
  communityWorkspaceReturnLabel(
    "/communities/materials_group?view=work#my-field-drafts"
  ),
  "Back to My work"
)
for (const [mode, label] of [
  ["reference", "Back to reference"],
  ["working", "Back to working version"],
  ["release", "Back to community release"]
]) {
  assert.equal(
    communityWorkspaceReturnLabel(
      `/communities/materials_group?view=vocabulary&standard=${mode}`
    ),
    label
  )
}
assert.equal(
  communityWorkspaceReturnLabel("https://external.example/redirect"),
  "Community workspace"
)
const reviewReturn = `/communities/materials_group?view=review&round=${revision}&profile=pf&item=${revision}`
assert.equal(communityWorkspaceReturnLabel(reviewReturn), "Back to review")
for (const path of [
  `/metadata/workspace/${revision}`,
  `/metadata/fields/${revision}?revision=${revision}`
]) {
  const resumed = withCommunityWorkspaceReturn(path, reviewReturn)
  const params = new URL(resumed, "http://local").searchParams
  assert.equal(
    params.get("reviewReturn"),
    reviewReturn,
    "publication and revision editing keep the selected review item"
  )
  assert.equal(params.has("returnTo"), false)
}
assert.equal(
  normalizeAuthReturnTo(
    withCommunityWorkspaceReturn(
      `/metadata/workspace/${revision}`,
      reviewReturn
    )
  ),
  withCommunityWorkspaceReturn(`/metadata/workspace/${revision}`, reviewReturn)
)
assert.equal(
  normalizeCommunityContributionReturnTo(`${returnTo}&offset=50`),
  `${returnTo}&offset=50`
)
assert.equal(
  normalizeCommunityContributionReturnTo(
    "/communities/materials_group?view=proposals"
  ),
  "/communities/materials_group?view=proposals"
)
for (const invalid of [
  `https://other.example${returnTo}`,
  `//other.example${returnTo}`,
  ` ${returnTo}`,
  `${returnTo}#redirect`,
  `${returnTo}&view=people`,
  `${returnTo}&redirect=https://other.example`,
  `${returnTo}&action=delete`,
  `/communities/materials_group?view=contributions&selected=definition:-1`,
  `/communities/materials_group?view=contributions&selected=proposal:not-a-revision`,
  `/communities/materials_group?view=contributions&q=${"a".repeat(201)}`,
  `/communities/materials_group?view=contributions&q=%00`,
  `/communities/materials_group?view=contributions&type=admin`,
  `/communities/materials_group?view=contributions&offset=-1`,
  `/communities/materials_group?view=contributions&offset=10001`,
  `/communities/materials_group?view=settings`
]) {
  assert.equal(normalizeCommunityContributionReturnTo(invalid), null, invalid)
  assert.equal(withCommunityContributionReturn("/add", invalid), "/add")
}
console.log(
  "Shared community navigation, contribution actions and bounded return paths passed"
)

const tiedDefinitions = Array.from({ length: 70 }, (_, index) => ({
  target: `definition:${70 - index}`,
  createdAt: "2026-11-10T12:00:00Z"
}))
const firstPage = tiedDefinitions
  .slice(0, 51)
  .sort(compareCommunityContributions)
  .slice(0, 50)
const secondPage = tiedDefinitions.sort(compareCommunityContributions).slice(50)
assert.deepEqual(
  [...firstPage, ...secondPage].map((row) => row.target),
  Array.from({ length: 70 }, (_, index) => `definition:${70 - index}`),
  "Pagination preserves numeric revision order when imported definitions share a timestamp"
)
const fractionalDefinitions = Array.from({ length: 70 }, (_, index) => ({
  target: `definition:${index + 1}`,
  createdAt:
    index === 69
      ? "2026-11-10 12:00:00+00"
      : `2026-11-10 12:00:00.${String(69 - index).padStart(6, "0")}+00`
}))
const fractionalFirstPage = fractionalDefinitions
  .slice(0, 51)
  .sort(compareCommunityContributions)
  .slice(0, 50)
const fractionalSecondPage = fractionalDefinitions
  .toSorted(compareCommunityContributions)
  .slice(50)
assert.deepEqual(
  [...fractionalFirstPage, ...fractionalSecondPage].map((row) => row.target),
  fractionalDefinitions.map((row) => row.target),
  "Pagination retains PostgreSQL microsecond chronology instead of lexical fraction or ID order"
)
assert.deepEqual(
  [
    { target: "definition:4", createdAt: "2026-11-10 10:00:00+00" },
    { target: "definition:3", createdAt: "2026-11-10 10:00:00.1+00" },
    { target: "definition:2", createdAt: "2026-11-10 10:00:00.11+00" },
    { target: "definition:1", createdAt: "2026-11-10 10:00:00.9+00" }
  ]
    .sort(compareCommunityContributions)
    .map((row) => row.target),
  ["definition:1", "definition:2", "definition:3", "definition:4"],
  "Whole seconds and variable-width fractions sort chronologically"
)
assert.deepEqual(
  [
    { target: "definition:3", createdAt: "2026-11-10T12:00:00.123456Z" },
    { target: "definition:4", createdAt: "2026-11-10 07:00:00.123455-05" },
    { target: "definition:2", createdAt: "2026-11-10 13:00:00.123456+01" },
    { target: "definition:1", createdAt: "2026-11-10T12:00:00.123457+0000" }
  ]
    .sort(compareCommunityContributions)
    .map((row) => row.target),
  ["definition:1", "definition:3", "definition:2", "definition:4"],
  "ISO and PostgreSQL offsets compare by the same instant before the ID tie-breaker"
)
