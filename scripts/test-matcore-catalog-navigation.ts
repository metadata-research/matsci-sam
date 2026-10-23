import assert from "node:assert/strict"
import {
  matcoreCatalogHref,
  normalizeMatcoreCatalogReturnTo,
  withMatcoreCatalogReturn
} from "../lib/matcore-catalog-navigation"
import { normalizeAuthReturnTo } from "../lib/auth-return"

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
  offset: 40
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
