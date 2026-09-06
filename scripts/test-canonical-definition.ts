import assert from "node:assert/strict"
import { compareDefinitions } from "../lib/canonical-definition"
import {
  preferredRepresentation,
  vocabularyDocument
} from "../lib/vocabulary-http"
import { publicRedirect } from "../lib/public-redirect"
import { turtleJsonLd } from "../lib/rdf-jsonld"

const earlier = {
  score: 3,
  createdAt: "2026-08-01T00:00:00Z",
  definitionNumber: 1
}
const later = {
  score: 2,
  createdAt: "2026-08-02T00:00:00Z",
  definitionNumber: 2
}
assert.ok(compareDefinitions(earlier, later) < 0, "votes take priority")
assert.ok(
  compareDefinitions({ ...earlier, score: 0 }, { ...later, score: 0 }) > 0,
  "newest wins with no votes"
)
assert.ok(
  compareDefinitions({ ...earlier, score: -1 }, { ...later, score: -2 }) < 0
)
assert.ok(compareDefinitions(earlier, { ...earlier, definitionNumber: 2 }) > 0)
assert.equal(
  compareDefinitions(earlier, {
    ...earlier,
    createdAt: "2026-07-31T20:00:00-04:00"
  }),
  0
)
for (const [accept, expected] of [
  [null, "html"],
  ["*/*", "html"],
  ["text/html,application/xhtml+xml,*/*;q=0.8", "html"],
  ["text/turtle", "ttl"],
  ["application/ld+json", "jsonld"],
  ["text/html;q=0.5,text/turtle;q=0.9", "ttl"],
  ["text/turtle;q=0,*/*;q=0.8", "html"],
  ["text/turtle,*/*", "ttl"],
  ["application/xml", null],
  ["*/*;q=0", null],
  ["text/turtle;q=2", null]
] as const)
  assert.equal(preferredRepresentation(accept), expected, String(accept))
assert.deepEqual(
  vocabularyDocument("/vocabulary/community_a/metal/provenance.ttl"),
  { resource: "/vocabulary/community_a/metal", provenance: true, format: "ttl" }
)
assert.deepEqual(vocabularyDocument("/vocabulary/community_b/metal"), {
  resource: "/vocabulary/community_b/metal",
  provenance: false,
  format: null
})
assert.ok(
  vocabularyDocument(
    "/vocabulary/community_a/metal/definitions/2/revisions/3/skos.jsonld"
  )
)
for (const path of [
  "/vocabulary/community_a/metal/rank/1",
  "/vocabulary/community_a/metal/activity",
  "/vocabulary/community_a/metal/definitions/0",
  "/vocabulary/x/../../secrets"
])
  assert.equal(vocabularyDocument(path), null)
const redirect = publicRedirect("/vocabulary/community_a/metal/definitions/1")
assert.equal(
  redirect.headers.get("location"),
  "/vocabulary/community_a/metal/definitions/1"
)
assert.equal(redirect.headers.get("cache-control"), "no-store")
for (const path of [
  "https://localhost:3000/x",
  "//evil.example",
  "/\\evil.example",
  "/a\r\nb"
])
  assert.throws(() => publicRedirect(path))
const json = turtleJsonLd(
  '<https://example.test/metal> <https://example.test/name> "metal"@en; <https://example.test/definition> <https://example.test/d1> .'
)
assert.deepEqual(json[0]["https://example.test/name"], [
  { "@value": "metal", "@language": "en" }
])
assert.deepEqual(json[0]["https://example.test/definition"], [
  { "@id": "https://example.test/d1" }
])
console.log(
  "Canonical ordering, HTTP negotiation, redirect, and RDF tests passed"
)
