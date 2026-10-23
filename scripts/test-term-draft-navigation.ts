import assert from "node:assert/strict"
import {
  normalizeAuthReturnTo,
  normalizeSetupReturnTo
} from "../lib/auth-return"
import {
  communityWorkReturn,
  normalizeCommunityWorkReturnTo,
  withCommunityWorkReturn
} from "../lib/community-work-return"

const id = "550e8400-e29b-41d4-a716-446655440000"
const setup = `/setup?task=vocabulary&vocabularySlug=mat-core&draftId=${id}`
for (const path of [
  `/add?draftId=${id}`,
  setup,
  `/add?draftId=${id}&setupReturnTo=${encodeURIComponent(setup)}`,
  "/profile/drafts"
])
  assert.equal(normalizeAuthReturnTo(path), path)
assert.equal(normalizeSetupReturnTo(setup), setup)
for (const path of [
  "/add?draftId=invalid",
  `/add?draftId=${id}&draftId=${id}`,
  `/add?setupReturnTo=${encodeURIComponent("https://example.com/setup")}`,
  `/add?setupReturnTo=${encodeURIComponent("//example.com/setup")}`,
  `/add?setupReturnTo=${encodeURIComponent("/setup?setupReturnTo=/setup")}`,
  `/add?setupReturnTo=${encodeURIComponent("/setup/../admin")}`,
  "/profile/drafts?redirect=/admin"
])
  assert.equal(normalizeAuthReturnTo(path), null, path)
const community = { slug: "materials", title: "Materials" }
const workspace =
  "/communities/materials?view=work&profile=dft&offset=40#my-field-drafts"
assert.equal(
  normalizeCommunityWorkReturnTo(workspace, community.slug),
  workspace
)
assert.deepEqual(communityWorkReturn(community, workspace), {
  href: workspace,
  label: "Back to Materials · My work"
})
assert.equal(
  communityWorkReturn(community, "/communities/other?view=work#term-drafts")
    .href,
  "/communities/materials?view=work#term-drafts"
)
assert.equal(communityWorkReturn(null, workspace).href, "/profile/drafts")
assert.equal(
  communityWorkReturn(community, null, undefined, "term-imports").href,
  "/communities/materials?view=work#term-imports"
)

for (const target of [
  `/add?draftId=${id}`,
  `/setup?task=import&vocabularySlug=materials`,
  `/metadata/workspace/${id}`,
  `/profile/drafts/imports/${id}?review=${id}`
]) {
  const carried = withCommunityWorkReturn(target, workspace)
  assert.equal(
    new URL(carried, "https://local.test").searchParams.get("returnTo"),
    workspace
  )
  assert.equal(
    normalizeAuthReturnTo(carried),
    carried,
    "Login/profile completion retains work context"
  )
  assert.equal(
    withCommunityWorkReturn(carried, workspace),
    carried,
    "Carrying context twice does not duplicate it"
  )
}
const nestedSetup = withCommunityWorkReturn("/setup?task=import", workspace)
assert.equal(normalizeSetupReturnTo(nestedSetup), nestedSetup)
const fullEditor = withCommunityWorkReturn(
  `/add?draftId=${id}&setupReturnTo=${encodeURIComponent(nestedSetup)}`,
  workspace
)
assert.equal(normalizeAuthReturnTo(fullEditor), fullEditor)
assert.equal(normalizeAuthReturnTo(workspace), workspace)

for (const unsafe of [
  "https://example.test/communities/materials?view=work",
  "//example.test/communities/materials?view=work",
  "/communities/materials/../other?view=work",
  "/communities/materials?view=people",
  "/communities/materials?view=work&view=work",
  "/communities/materials?view=work&profile=admin",
  "/communities/materials?view=work&offset=-1",
  "/communities/materials?view=work&offset=10001",
  "/communities/materials?view=work&returnTo=/admin",
  "/communities/materials?view=work#other-users-drafts",
  "/communities/materials?view=work#term-drafts#other",
  "/communities/materials?view=work\\admin",
  "/communities/materials?view=work\n",
  [workspace],
  null
]) {
  assert.equal(normalizeCommunityWorkReturnTo(unsafe), null, String(unsafe))
  assert.equal(
    communityWorkReturn(community, unsafe).href,
    "/communities/materials?view=work#term-drafts"
  )
  if (typeof unsafe === "string") {
    assert.equal(
      withCommunityWorkReturn(`/add?draftId=${id}`, unsafe),
      `/add?draftId=${id}`
    )
    assert.equal(
      normalizeAuthReturnTo(`/add?returnTo=${encodeURIComponent(unsafe)}`),
      null
    )
  }
}
console.log("Term draft navigation and scoped community return checks passed")
