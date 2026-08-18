import assert from "node:assert/strict"
import {
  applicationMetadataNamespaceUri,
  applicationMetadataUri,
  collectionPath,
  collectionUri,
  collectionsIndexPath,
  conceptPath,
  conceptSchemePath,
  conceptSchemeUri,
  conceptUri,
  definitionPath,
  definitionUri,
  identifierBaseUrl,
  rankPath,
  rankUri,
  revisionPath,
  revisionUri,
  schemePath,
  schemeUri,
  statementUri,
  tagsIndexPath,
  tagsIndexUri,
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

// Knowledge-organization identifiers: schemes, concepts, collections and the
// hash IRI of one stored statement.
assert.equal(identifierBaseUrl, base)
assert.equal(tagsIndexPath, "/tags")
assert.equal(tagsIndexUri, `${base}/tags`)
assert.equal(collectionsIndexPath, "/collections")
assert.equal(conceptSchemePath("pspp"), "/tags/pspp")
assert.equal(conceptSchemeUri("topics"), `${base}/tags/topics`)
assert.equal(conceptPath("pspp", "processing"), "/tags/pspp/processing")
assert.equal(conceptUri("pspp", "processing"), `${base}/tags/pspp/processing`)
assert.equal(conceptPath("topics", "topic_2"), "/tags/topics/topic_2")
assert.equal(collectionPath("demo-terms"), "/collections/demo-terms")
assert.equal(collectionUri("demo-terms"), `${base}/collections/demo-terms`)
assert.equal(
  statementUri(termUri("martensite"), "0f2c9d1e-1111-4222-8333-444455556666"),
  `${base}/vocabulary/martensite#statement-0f2c9d1e-1111-4222-8333-444455556666`
)
assert.throws(() => conceptSchemePath(""), RangeError)
assert.throws(() => conceptPath("pspp", ""), RangeError)
assert.throws(() => conceptPath("", "processing"), RangeError)
assert.throws(() => collectionPath(""), RangeError)
assert.throws(() => statementUri("", "k"), RangeError)
assert.throws(() => statementUri(termUri("x"), ""), RangeError)

for (const invalid of [0, -1, 1.2, Number.NaN])
  assert.throws(() => definitionPath("martensite", invalid), RangeError)

assert.throws(() => revisionPath("martensite", 1, 0), RangeError)
assert.throws(() => rankPath("martensite", 0), RangeError)
assert.throws(() => termPath(""), RangeError)
assert.throws(() => applicationMetadataUri(""), RangeError)

console.log("Public identifier tests passed")
