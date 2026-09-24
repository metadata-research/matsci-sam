import assert from "node:assert/strict"
import { termMetadataInputSchema } from "../lib/term-metadata-validation"
import {
  getMetadataCatalogFields,
  metadataFieldKeys
} from "../lib/dictionary-metadata"
import { identifierBaseUrl } from "../lib/public-identifiers"

const base = {
  termId: 1,
  fieldKey: "usageNote" as const,
  value: " Used for materials methods. "
}
const normalized = termMetadataInputSchema.parse({
  ...base,
  language: "EN-gb",
  sourceLabel: " Paper ",
  sourceVersion: " v1 "
})
assert.equal(normalized.value, "Used for materials methods.")
assert.equal(normalized.language, "en-gb")
assert.equal(normalized.definitionRevisionId, null)
assert.equal(normalized.valueType, "text")
assert.equal(normalized.sourceLabel, "Paper")
for (const input of [
  { ...base, termId: 0 },
  { ...base, value: " " },
  { ...base, value: "x".repeat(4001) },
  { ...base, fieldKey: "arbitraryPredicate" },
  { ...base, language: "en_uk" },
  { ...base, sourceVersion: "v1" },
  { ...base, sourceIri: "javascript:alert(1)" },
  { ...base, fieldKey: "relatedConcept", value: "https://example.org/<bad>" },
  {
    ...base,
    fieldKey: "relatedConcept",
    value: "https://example.org/id",
    language: "en"
  },
  {
    ...base,
    fieldKey: "usedAsValueFor",
    value: "https://example.org/unknown-field"
  },
  {
    ...base,
    fieldKey: "describesMetadataField",
    value: "https://example.org/unknown-field"
  }
])
  assert.equal(
    termMetadataInputSchema.safeParse(input).success,
    false,
    JSON.stringify(input)
  )
for (const field of getMetadataCatalogFields(identifierBaseUrl)) {
  assert.equal(
    termMetadataInputSchema.parse({
      ...base,
      fieldKey: "usedAsValueFor",
      value: field.iri
    }).valueType,
    "iri"
  )
  assert.equal(
    termMetadataInputSchema.parse({
      ...base,
      fieldKey: "describesMetadataField",
      value: field.iri
    }).value,
    field.iri
  )
}
assert.equal(
  termMetadataInputSchema.parse({
    ...base,
    fieldKey: "relatedConcept",
    value: "https://example.org/ontology#Process"
  }).valueType,
  "iri"
)
assert.deepEqual([...metadataFieldKeys].sort(), [
  "alternateLabel",
  "describesMetadataField",
  "relatedConcept",
  "usageNote",
  "usedAsValueFor"
])
console.log("Term metadata validation checks passed.")
