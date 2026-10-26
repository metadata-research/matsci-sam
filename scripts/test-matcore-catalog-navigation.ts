import assert from "node:assert/strict"
import {
  matcoreCatalogHref,
  normalizeMatcoreCatalogReturnTo,
  withMatcoreCatalogReturn
} from "../lib/matcore-catalog-navigation"
import { normalizeAuthReturnTo } from "../lib/auth-return"
import { buildHierarchy, matchingHierarchy } from "../lib/hierarchy"

const source = "matcore:0.3.0:dft:computation.software"
const context = {
  communitySlug: "matcore_development",
  releaseId: "matcore:0.3.0",
  source
}
const href = matcoreCatalogHref(context.communitySlug, {
  releaseId: context.releaseId,
  source,
  profileKey: "dft",
  offset: 40,
  search: "diffusion α & method",
  layout: "hierarchy"
})
assert.equal(normalizeMatcoreCatalogReturnTo(href, context), href)
assert.equal(normalizeAuthReturnTo(href), href)
const draft = withMatcoreCatalogReturn(
  "/metadata/workspace/12345678-1234-1234-1234-123456789abc",
  href
)
assert.equal(normalizeAuthReturnTo(draft), draft)
assert.equal(new URL(draft, "http://local").searchParams.get("returnTo"), href)
assert.equal(
  normalizeMatcoreCatalogReturnTo(href, {
    ...context,
    communitySlug: "another_community"
  }),
  null
)
assert.equal(
  normalizeMatcoreCatalogReturnTo(href, {
    ...context,
    releaseId: "matcore:0.2.0"
  }),
  null
)
assert.equal(
  normalizeMatcoreCatalogReturnTo(href, {
    ...context,
    source: "different-source"
  }),
  null
)
assert.equal(
  normalizeMatcoreCatalogReturnTo(href, { ...context, source: null }),
  null
)
for (const bad of [
  `https://example.com${href}`,
  `//example.com${href}`,
  ` ${href}`,
  `${href} `,
  `${href}#my-field-drafts`,
  `${href}&view=work`,
  `${href}&source=another`,
  `${href}&redirect=https://example.com`,
  `${href}&offset=0`,
  `${href}&q=duplicate`,
  `${href}&layout=list`,
  "/communities/example?view=vocabulary&layout=graph",
  "/communities/example?view=vocabulary&q=%00",
  `/communities/example?view=vocabulary&q=${"a".repeat(201)}`,
  "/communities/matcore_development?view=vocabulary&source=orphan",
  "/communities/matcore_development?view=vocabulary&release=%2Fetc%2Fpasswd",
  "/communities/matcore_development?view=vocabulary&source=%00&release=matcore:0.3.0",
  "/communities/matcore_development?view=vocabulary&profile=unknown",
  "/communities/matcore_development?view=vocabulary&offset=10001",
  "/communities/matcore_development?view=vocabulary&offset=-1"
]) {
  assert.equal(normalizeMatcoreCatalogReturnTo(bad), null, bad)
  assert.equal(
    normalizeAuthReturnTo(withMatcoreCatalogReturn(draft.split("?")[0], bad)),
    draft.split("?")[0]
  )
}
assert.equal(
  normalizeMatcoreCatalogReturnTo("/communities/matcore_development?view=work"),
  null
)
assert.equal(
  normalizeAuthReturnTo(
    "/communities/matcore_development?view=work#my-field-drafts"
  ),
  "/communities/matcore_development?view=work#my-field-drafts"
)
console.log(
  "MatCore catalog identity-pinned navigation and authentication returns passed"
)

const roots = buildHierarchy(
  [
    { id: "one", label: "First" },
    { id: "two", label: "Second" }
  ],
  [
    {
      id: "child",
      group: "one",
      path: ["specimen", "name"],
      label: "Name",
      href: "/child",
      matches: true
    },
    {
      id: "parent",
      group: "one",
      path: ["specimen"],
      label: "Specimen",
      href: "/parent",
      matches: false
    },
    {
      id: "different",
      group: "two",
      path: ["specimen", "name"],
      label: "Name",
      href: "/different",
      matches: false
    },
    {
      id: "duplicate",
      group: "one",
      path: ["specimen", "name"],
      label: "Second name record",
      href: "/duplicate",
      matches: true
    }
  ]
)
assert.equal(
  roots[0].children[0].href,
  "/parent",
  "Parents remain selectable even when encountered after children"
)
assert.equal(
  roots[0].children[0].children[0].href,
  undefined,
  "A shared path is a navigation group"
)
assert.equal(roots[0].children[0].children[0].children[0].href, "/child")
assert.notEqual(
  roots[0].children[0].id,
  roots[1].children[0].id,
  "Paths are scoped to their group"
)
assert.equal(
  roots[1].children[0].href,
  undefined,
  "An absent source parent is only a navigation group"
)
assert.equal(
  roots[0].children[0].children[0].children[1].href,
  "/duplicate",
  "Colliding paths do not discard source records"
)
const matches = matchingHierarchy(roots)
assert.equal(matches.length, 1, "Unmatched groups are omitted")
assert.equal(
  matches[0].children[0].href,
  "/parent",
  "Search retains a matching field's parent context"
)
assert.equal(
  roots.length,
  2,
  "Filtering does not mutate the original hierarchy"
)
assert.deepEqual(
  matchingHierarchy(buildHierarchy([{ id: "empty", label: "Empty" }], [])),
  []
)
console.log(
  "Generic hierarchy grouping, duplicate identities, parent links and search context passed"
)

const communityEdition = "12345678-1234-1234-1234-123456789abc"
assert.equal(
  normalizeMatcoreCatalogReturnTo(
    `/communities/example?view=vocabulary&standard=release&edition=${communityEdition}&layout=list`
  ),
  `/communities/example?view=vocabulary&standard=release&edition=${communityEdition}&layout=list`
)
assert.equal(
  normalizeMatcoreCatalogReturnTo(
    `/communities/example?view=vocabulary&edition=${communityEdition}`
  ),
  null
)
assert.equal(
  normalizeMatcoreCatalogReturnTo(
    "/communities/example?view=vocabulary&standard=release&edition=------------------------------------"
  ),
  null
)
assert.ok(
  matcoreCatalogHref("example", {
    standard: "working",
    layout: "list"
  }).includes("layout=list")
)
