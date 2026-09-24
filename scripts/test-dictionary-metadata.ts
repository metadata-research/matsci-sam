import assert from "node:assert/strict"
import { Parser } from "n3"
import {
  getMetadataCatalogFields,
  knownMetadataCatalogField,
  metadataPredicateIri
} from "../lib/dictionary-metadata"
import { generateDictionaryMetadataDefinitionsTurtle } from "../lib/dictionary-metadata-export"
import { TTL_PREFIXES } from "../lib/kos-export"
import { matCoreSourceSnapshot } from "../lib/matcore"

const base = "https://identifiers.example/dictionary"
const fields = getMetadataCatalogFields(`${base}/`)
assert.equal(fields.length, 29)
assert.equal(new Set(fields.map((field) => field.iri)).size, 29)
assert.ok(fields.every((field) => field.iri.startsWith(`${base}/metadata/`)))
assert.equal(
  fields.filter((field) => field.status === "preliminary").length,
  27
)
assert.ok(
  fields
    .filter((field) => field.status === "preliminary")
    .every(
      (field) => field.sourceVersion === matCoreSourceSnapshot.snapshotLabel
    )
)
assert.ok(
  fields
    .filter((field) => field.status === "proposed")
    .every(
      (field) => field.required === null && field.sourceVersion === "proposal-1"
    )
)
assert.equal(
  knownMetadataCatalogField(`${base}/metadata/matcore#method`, base)?.label,
  "Method"
)
assert.equal(
  knownMetadataCatalogField(
    "https://other.example/metadata/matcore#method",
    base
  ),
  undefined
)
assert.equal(
  metadataPredicateIri("usageNote", base),
  "http://www.w3.org/2004/02/skos/core#scopeNote"
)
assert.equal(
  metadataPredicateIri("usedAsValueFor", base),
  `${base}/metadata#usedAsValueFor`
)
const quads = new Parser().parse(
  TTL_PREFIXES + generateDictionaryMetadataDefinitionsTurtle()
)
assert.equal(
  quads.filter(
    (q) =>
      q.predicate.value.endsWith("#type") &&
      q.object.value.endsWith("#Property")
  ).length,
  6
)
assert.ok(!quads.some((q) => q.predicate.value.endsWith("#range")))
assert.ok(!quads.some((q) => q.predicate.value.endsWith("#equivalentProperty")))
console.log("Dictionary metadata catalog and RDF definitions passed")
