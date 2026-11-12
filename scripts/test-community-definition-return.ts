import assert from "node:assert/strict"
import { communityDefinitionReturn } from "../lib/community-definition-return"

const work =
  "/communities/materials?view=work&release=matcore%3A0.3.0&contributionOffset=40#submitted-work"
const reviews =
  "/communities/materials?view=review&content=contributions&release=matcore%3A0.3.0&profile=pf&q=mesh&offset=50"

assert.deepEqual(communityDefinitionReturn(work, "materials"), {
  href: work,
  label: "Back to My work"
})
assert.deepEqual(communityDefinitionReturn(reviews, "materials"), {
  href: reviews,
  label: "Back to reviews"
})
for (const view of ["contributions", "proposals"]) {
  const legacy = `/communities/materials?view=${view}&release=matcore%3A0.3.0`
  assert.deepEqual(communityDefinitionReturn(legacy, "materials"), {
    href: legacy,
    label: "Back to reviews"
  })
}

for (const invalid of [
  null,
  undefined,
  "",
  `https://other.example${work}`,
  `//other.example${work}`,
  "/communities/other?view=work",
  "/communities/other?view=review&content=contributions",
  "/communities/materials?view=people",
  "/communities/materials?view=work&redirect=/admin",
  "/communities/materials?view=review&content=contributions&content=contributions",
  "/communities/materials?view=work&contributionOffset=10001"
]) {
  assert.equal(communityDefinitionReturn(invalid, "materials"), null)
}
assert.equal(communityDefinitionReturn(work, null), null)
assert.equal(communityDefinitionReturn(reviews, undefined), null)

console.log(
  "Definition returns preserve work/review context and reject unrelated or unsafe destinations"
)
