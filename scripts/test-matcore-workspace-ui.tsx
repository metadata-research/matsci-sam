import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"
import { matcoreDraftPayloadSchema } from "../lib/matcore-workflow-types"
import {
  emptyFieldPayload,
  proposalDifferences,
  workspaceDestination
} from "../components/metadata-workspace/workspace-presenters"
import {
  FieldSpecification,
  SpecificationSummary
} from "../components/metadata-workspace/field-specification"
import { SourceBaseline } from "../components/metadata-workspace/source-history"
import { FieldCitations } from "../components/metadata-workspace/field-citations"

// Route identity comes from the community mapping, not the vocabulary slug.
assert.equal(
  workspaceDestination({ slug: "sample_fields", communityId: 8 }, [
    { id: 8, slug: "materials_group" }
  ]),
  "/communities/materials_group?view=work"
)
assert.equal(
  workspaceDestination({ slug: "sample_fields", communityId: 8 }, [
    { id: 9, slug: "unrelated_group" }
  ]),
  "/metadata/workspace?vocabularySlug=sample_fields",
  "missing community mapping must use the resolver rather than invent a route"
)
assert.equal(
  workspaceDestination({ slug: "sample_fields", communityId: null }, []),
  "/metadata/workspace?vocabularySlug=sample_fields"
)

const baseline = emptyFieldPayload()
baseline.label = "Creator / Name"
baseline.definition = "The creator’s name. <script>untrusted()</script>"
baseline.specification.path = "creator.name"
assert.equal(matcoreDraftPayloadSchema.safeParse(baseline).success, true)
assert.deepEqual(proposalDifferences(baseline, baseline), [])

const proposal = structuredClone(baseline)
proposal.definition =
  "Name of the person or organization that created the dataset."
proposal.specification.requirement = "conditional"
proposal.specification.condition =
  "Required when the optional creator object is present."
proposal.specification.repeatability = "no"
proposal.specification.allowedValues = ["A", "B"]
proposal.rationale = "Clarify the parent context."
proposal.citations = [
  {
    title: "A source",
    url: "https://example.org/field",
    note: "Supports the requirement."
  }
]
const differences = proposalDifferences(proposal, baseline)
assert.deepEqual(
  differences.map((item) => item.label),
  [
    "Definition",
    "Requirement",
    "Condition",
    "Repeatable",
    "Allowed values",
    "Rationale",
    "Citations"
  ]
)
assert.equal(
  differences.find((item) => item.label === "Requirement")?.before,
  "Not specified"
)
assert.equal(
  differences.find((item) => item.label === "Repeatable")?.after,
  "No"
)
assert.equal(
  baseline.specification.requirement,
  "unspecified",
  "review must not mutate the baseline"
)
assert.ok(
  proposalDifferences(proposal, null).some(
    (item) => item.label === "Field path"
  )
)

const editor = renderToStaticMarkup(
  <FieldSpecification
    specification={proposal.specification}
    profileKey="minimal"
    onChange={() => {}}
  />
)
assert.match(editor, /Required when the optional creator object is present/)
assert.match(editor, /required means required when its parent is present/)
assert.match(editor, /does not mean optional/)
assert.match(editor, /A list value is a separate choice/)
assert.match(editor, /<label[^>]*for="field-requirement"/)
assert.match(editor, /<option value="conditional" selected=""/)
const summary = renderToStaticMarkup(
  <SpecificationSummary
    specification={baseline.specification}
    profileKey="minimal"
  />
)
assert.match(summary, /Not specified/)
assert.doesNotMatch(summary, />Optional</)

const source = renderToStaticMarkup(
  <SourceBaseline
    baseline={baseline}
    sourceOccurrence={{
      sourceFieldId: "matcore:creator.name",
      sourceKey: "name",
      profileKey: "minimal",
      path: ["creator", "name"],
      sourceUrl: "https://matcore.org/standard-document-content.html#creator",
      sourceAnchor: "creator",
      sourceTableId: "Min-1",
      sourceRow: 1,
      rawText: baseline.definition,
      warnings: ["Requirement applies within its parent context."]
    }}
    sourceRelease={{
      version: "0.3.0",
      sourceUrl: "https://matcore.org/standard-document-content.html",
      sha256: "a".repeat(64),
      attribution: "MatCore authors",
      license: null,
      parserVersion: "test-v1",
      retrievedOn: "2026-10-23",
      artifactPath: "data/matcore/test.html"
    }}
  />
)
assert.match(source, /Preserved source baseline/)
assert.match(source, /creator \/ name/)
assert.match(source, /Not established for this source snapshot/)
assert.match(source, /MatCore authors/)
assert.match(source, /&lt;script&gt;untrusted\(\)&lt;\/script&gt;/)
assert.doesNotMatch(source, /<script>/)

const noSource = renderToStaticMarkup(
  <SourceBaseline
    baseline={null}
    sourceOccurrence={null}
    sourceRelease={null}
  />
)
assert.match(noSource, /No imported source baseline/)
assert.doesNotMatch(noSource, /MatCore/)
const citations = renderToStaticMarkup(
  <FieldCitations citations={proposal.citations} />
)
assert.match(citations, /Supporting citations/)
assert.doesNotMatch(citations, /MatCore|imported baseline/)
assert.match(citations, /Supports the requirement/)
assert.doesNotMatch(citations, /Used by assistant/)
const baselineCitations = renderToStaticMarkup(
  <FieldCitations citations={proposal.citations} hasBaseline />
)
assert.match(baselineCitations, /imported baseline is recorded separately/)

const genericEditor = renderToStaticMarkup(
  <FieldSpecification
    specification={proposal.specification}
    profileKey={null}
    onChange={() => {}}
  />
)
assert.match(genericEditor, /identifies the field within this vocabulary/)
assert.match(genericEditor, /for="field-requirement"[^>]*>Requirement</)
assert.doesNotMatch(genericEditor, /MatCore|Common core|Requirement in/)
const genericSummary = renderToStaticMarkup(
  <SpecificationSummary
    specification={proposal.specification}
    profileKey={null}
  />
)
assert.doesNotMatch(genericSummary, />Profile</)
assert.match(genericSummary, /creator.name/)
assert.match(genericSummary, /Conditional/)
assert.match(
  genericSummary,
  /Required when the optional creator object is present/
)
console.log(
  "Metadata workspace presentation checks passed for MatCore and community fields."
)
