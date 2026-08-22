import assert from "node:assert/strict"
import {
  applicationMetadataNamespaceUri,
  applicationMetadataUri,
  collectionPath,
  collectionUri,
  collectionsIndexPath,
  communitiesIndexPath,
  communityPath,
  conceptPath,
  conceptSchemePath,
  conceptSchemeUri,
  conceptUri,
  definitionPath,
  invitePath,
  studiesIndexPath,
  studyPath,
  studyUri,
  definitionUri,
  identifierBaseUrl,
  matCoreElementUri,
  matCoreNamespaceUri,
  matCoreProfileUri,
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
import { SITE_URL, resolveIdentifierBase } from "../lib/site"

// The identifier authority is separate from the application origin: set, it
// replaces the origin in every IRI and nothing else; unset or blank, the
// origin stands in. A trailing slash is dropped, and a value that is not an
// absolute http(s) URL refuses rather than minting malformed identifiers.
assert.equal(
  resolveIdentifierBase(undefined, "https://ego.example"),
  "https://ego.example"
)
assert.equal(
  resolveIdentifierBase("  ", "https://ego.example/"),
  "https://ego.example"
)
assert.equal(
  resolveIdentifierBase("https://w3id.org/matsci-sam/", "https://ego.example"),
  "https://w3id.org/matsci-sam"
)
assert.equal(
  resolveIdentifierBase("http://localhost:3000", "https://ego.example"),
  "http://localhost:3000"
)
assert.throws(() =>
  resolveIdentifierBase("w3id.org/matsci-sam", "https://ego.example")
)
assert.throws(() => resolveIdentifierBase("https://", "https://ego.example"))
assert.throws(() => resolveIdentifierBase(undefined, "ego.example"))

const base = resolveIdentifierBase(process.env.IDENTIFIER_BASE_URL, SITE_URL)

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

// MatCore elements sit in their own namespace, so a consumer can tell a
// transcribed standard from terms this application defines for itself.
assert.equal(matCoreNamespaceUri, `${base}/metadata/matcore#`)
assert.equal(matCoreElementUri("creator"), `${base}/metadata/matcore#creator`)
assert.equal(
  matCoreElementUri("xc-functional"),
  `${base}/metadata/matcore#xc-functional`
)
assert.equal(matCoreProfileUri("minimal"), `${base}/metadata/matcore#minimal`)
assert.notEqual(matCoreNamespaceUri, applicationMetadataNamespaceUri)
assert.throws(() => matCoreElementUri(""), RangeError)
assert.throws(() => matCoreProfileUri(""), RangeError)

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

assert.equal(communitiesIndexPath, "/communities")
assert.equal(communityPath("zhang_lab"), "/communities/zhang_lab")
assert.equal(invitePath("abc-123_XYZ"), "/invite/abc-123_XYZ")
assert.throws(() => communityPath(""), RangeError)
assert.throws(() => invitePath(""), RangeError)
assert.equal(studiesIndexPath, "/studies")
assert.equal(studyPath("id4_round_two"), "/studies/id4_round_two")
// A study is an activity with a published IRI; the people in it have none.
assert.equal(studyUri("id4_round_two"), `${base}/studies/id4_round_two`)
assert.throws(() => studyPath(""), RangeError)
assert.throws(() => studyUri(""), RangeError)

console.log("Public identifier tests passed")
