import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"
import {
  importOriginProvenance,
  publicImportOrigin,
  publicDeclaredSource
} from "../lib/import-origin-provenance"
import type { RevisionImportReceipt } from "../lib/import-draft-types"
import { importEvidenceSchema } from "../lib/import-draft-types"
import { ContributionEvidencePanel } from "../components/provenance/contribution-evidence"

const receipt: RevisionImportReceipt = {
  schemaVersion: 1,
  parserVersion: "draft-csv-v1",
  inputHash: "a".repeat(64),
  rowHash: "b".repeat(64),
  rowIdentity: "ion-1",
  record: 2,
  importedAt: "2026-10-20T12:00:00Z",
  importedById: 42,
  originalTerm: "Ion transport",
  originalDefinition: "Original wording <script>unsafe</script>",
  declaredOrigin: {
    title: "Materials glossary",
    creator: "Glossary authors",
    url: "https://example.org/glossary",
    version: "1",
    license: "CC BY 4.0"
  },
  ontology: [
    {
      id: "ontology-1",
      iri: "https://example.org/private-proposal",
      label: "Unreviewed proposal",
      ontology: "",
      version: "",
      sourceUrl: "",
      note: "private-note",
      decision: "include"
    }
  ],
  scopeNote: { text: "private-scope", decision: "include" }
}
assert.equal(importEvidenceSchema.parse({}).publishOriginalWording, false)
for (const publishOriginalWording of [undefined, false, true]) {
  const origin = publicImportOrigin({ ...receipt, publishOriginalWording })
  const serialized = JSON.stringify(origin)
  for (const privateField of [
    "inputHash",
    "rowHash",
    "importedById",
    "record",
    "rowIdentity",
    "ontology",
    "scopeNote"
  ])
    assert.ok(!(privateField in origin), `${privateField} must stay private`)
  assert.doesNotMatch(serialized, /private-proposal|private-note|private-scope/)
  const graph = importOriginProvenance(origin, "revision_1", "contributor_1")
  assert.ok(graph.edges.some((edge) => edge.rel === "wasDerivedFrom"))
  assert.ok(graph.edges.some((edge) => edge.rel === "wasAssociatedWith"))
  assert.ok(
    graph.edges.every(
      (edge) => edge.rel !== "used" && edge.rel !== "references"
    )
  )
  assert.ok(graph.nodes.every((node) => node.type !== "software"))
  const html = renderToStaticMarkup(
    <ContributionEvidencePanel
      termSlug="ion_transport"
      vocabularySlug="matsci-sam"
      contributions={[
        {
          definitionNumber: 1,
          version: 1,
          publishedAt: receipt.importedAt,
          publishedText: "Reviewed wording.",
          sources: [],
          citations: [],
          manualCitations: [publicDeclaredSource(receipt.declaredOrigin!)],
          importOrigin: origin,
          model: null
        }
      ]}
    />
  )
  assert.match(html, /1 citation/)
  assert.match(html, /Import and source credit/)
  assert.match(html, /Source credited to:.*Glossary authors/)
  assert.match(html, /Declared references/)
  assert.doesNotMatch(
    html,
    /Recorded model assistance|private-proposal|private-note|private-scope|<script>/
  )
  for (const view of [serialized, JSON.stringify(graph), html]) {
    assert.ok(!view.includes(receipt.inputHash))
    assert.ok(!view.includes(receipt.rowHash))
    if (publishOriginalWording !== true) {
      assert.ok(!view.includes(receipt.originalTerm))
      assert.ok(!view.includes("Original wording"))
    }
  }
  if (publishOriginalWording === true) {
    assert.equal(origin.originalWording?.definition, receipt.originalDefinition)
    assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/)
  } else {
    assert.equal(origin.originalWording, null)
    assert.match(html, /Original imported wording was kept private/)
  }
}
console.log(
  "Import provenance: private defaults, explicit wording opt-in, private hashes, separate origin/citation/use and escaped public presentation pass."
)
