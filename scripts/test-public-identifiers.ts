import assert from "node:assert/strict"
import {
  applicationMetadataNamespaceUri,
  applicationMetadataUri,
  definitionPath,
  definitionUri,
  rankPath,
  rankUri,
  revisionPath,
  revisionUri,
  schemePath,
  schemeUri,
  termPath,
  termUri
} from "../lib/public-identifiers"
import { SITE_URL } from "../lib/site"

const base = SITE_URL.replace(/\/+$/, "")

assert.equal(schemePath, "/vocabulary")
assert.equal(schemeUri, `${base}/vocabulary`)
assert.equal(termPath("martensite"), "/vocabulary/martensite")
assert.equal(termUri("martensite"), `${base}/vocabulary/martensite`)
assert.equal(
  definitionPath("martensite", 2),
  "/vocabulary/martensite/definitions/2"
)
assert.equal(
  definitionUri("martensite", 2),
  `${base}/vocabulary/martensite/definitions/2`
)
assert.equal(
  revisionPath("martensite", 2, 3),
  "/vocabulary/martensite/definitions/2/revisions/3"
)
assert.equal(
  revisionUri("martensite", 2, 3),
  `${base}/vocabulary/martensite/definitions/2/revisions/3`
)
assert.equal(rankPath("martensite", 4), "/vocabulary/martensite/rank/4")
assert.equal(rankUri("martensite", 4), `${base}/vocabulary/martensite/rank/4`)
assert.equal(termPath("high-entropy_alloy"), "/vocabulary/high-entropy_alloy")
assert.equal(applicationMetadataNamespaceUri, `${base}/metadata#`)
assert.equal(
  applicationMetadataUri("definitionNumber"),
  `${base}/metadata#definitionNumber`
)

for (const invalid of [0, -1, 1.2, Number.NaN])
  assert.throws(() => definitionPath("martensite", invalid), RangeError)

assert.throws(() => revisionPath("martensite", 1, 0), RangeError)
assert.throws(() => rankPath("martensite", 0), RangeError)
assert.throws(() => termPath(""), RangeError)
assert.throws(() => applicationMetadataUri(""), RangeError)

console.log("Public identifier tests passed")
