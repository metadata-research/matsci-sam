import assert from "node:assert/strict"
import { Parser } from "n3"
import {
  publicImportOrigin,
  importOriginProvenance
} from "../lib/import-origin-provenance"
import type { RevisionImportReceipt } from "../lib/import-draft-types"
import {
  provenanceBodyTurtle,
  PROVENANCE_PREFIXES
} from "../lib/provenance-rdf"

const receipt: RevisionImportReceipt = {
  schemaVersion: 1,
  parserVersion: "draft-csv-v1",
  inputHash: "private-input-hash",
  rowHash: "private-row-hash",
  rowIdentity: "private-row",
  record: 7,
  importedAt: "2026-10-20T12:00:00Z",
  importedById: 42,
  originalTerm: "Private original term",
  originalDefinition: "Private original wording",
  declaredOrigin: null,
  ontology: [],
  scopeNote: null
}

for (const publishOriginalWording of [undefined, false, true]) {
  const graph = importOriginProvenance(
    publicImportOrigin({ ...receipt, publishOriginalWording }),
    "revision_1",
    "contributor_1"
  )
  const turtle =
    PROVENANCE_PREFIXES +
    provenanceBodyTurtle({
      term: {
        id: 1,
        term: "Reviewed term",
        slug: "reviewed_term",
        vocabularySlug: "matsci-sam"
      },
      graph
    })
  assert.ok(new Parser().parse(turtle).length > 0)
  assert.match(turtle, /prov:wasDerivedFrom/)
  assert.match(turtle, /prov:wasAssociatedWith/)
  assert.doesNotMatch(turtle, /private-input-hash|private-row-hash|private-row/)
  if (publishOriginalWording === true) {
    assert.ok(turtle.includes(receipt.originalTerm))
    assert.ok(turtle.includes(receipt.originalDefinition))
  } else {
    assert.ok(!turtle.includes(receipt.originalTerm))
    assert.ok(!turtle.includes(receipt.originalDefinition))
  }
}
console.log(
  "Import RDF: default/legacy wording privacy, explicit opt-in and private hashes pass."
)
