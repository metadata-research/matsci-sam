import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"
import { ContributionEvidencePanel } from "../components/provenance/contribution-evidence"
import type {
  ContributionEvidence,
  PublishedSourceEvidence,
  SourceInputEvidence
} from "../lib/contribution-evidence"

const uploaded: PublishedSourceEvidence = {
  fileId: "2eb43b23-bfea-4b70-9c8b-ef92fc5cd1fc",
  origin: "upload",
  title: "Uploaded coupon specification",
  caption: "Source for the coupon geometry and identifier.",
  citation: "Development test fixture, October 18, 2026.",
  page: null,
  filename: "uploaded-specification.txt",
  mediaType: "text/plain",
  contentHash: "upload-hash",
  contributorCited: true,
  assistantUsed: true,
  readerHref: "/sources/2eb43b23-bfea-4b70-9c8b-ef92fc5cd1fc",
  downloadHref: "/api/contribution-files/2eb43b23-bfea-4b70-9c8b-ef92fc5cd1fc"
}
const pasted: PublishedSourceEvidence = {
  ...uploaded,
  fileId: "42cddcf9-bd4a-4dea-9e5c-87b79415dc9d",
  origin: "paste",
  title: "Pasted coupon context",
  caption: "Source for the microscopy use.",
  citation: null,
  filename: "pasted-source.txt",
  contentHash: "paste-hash",
  contributorCited: false,
  readerHref: "/sources/42cddcf9-bd4a-4dea-9e5c-87b79415dc9d",
  downloadHref: "/api/contribution-files/42cddcf9-bd4a-4dea-9e5c-87b79415dc9d"
}
const input = (file: PublishedSourceEvidence): SourceInputEvidence => ({
  fileId: file.fileId,
  readerHref: file.readerHref,
  downloadHref: file.downloadHref,
  title: file.title,
  origin: file.origin,
  mode: file.origin === "upload" ? "passages" : "full",
  term: "mixed source coupon 20261018",
  aliases: [],
  text:
    file.origin === "upload"
      ? "The coupon has five circular fiducials, each 3 millimeters in diameter."
      : "The fiducials register optical microscopy images. <script>untrusted</script>",
  textHash: file.contentHash,
  fileHash: file.contentHash,
  extractionTextHash: file.contentHash,
  hasOcr: false,
  ocrReviewed: false,
  parserVersion: "source-extraction-v1",
  extractedAt: "2026-10-18T08:21:40Z",
  checkedAt: "2026-10-18T08:22:00Z",
  matcherVersion: "unicode-phrase-v1",
  contextSelectedAt: "2026-10-18T08:23:11Z",
  ocrReviewRecordedAt: null
})

export const mixedSourceContribution: ContributionEvidence = {
  definitionNumber: 1,
  version: 1,
  publishedAt: "2026-10-18T08:27:00Z",
  publishedText: "A synthetic alignment specimen for optical microscopy.",
  citations: [],
  sources: [uploaded, pasted],
  model: {
    name: "gemma-4-26b",
    inference: null,
    recordedAt: "2026-10-18T08:23:11Z",
    acceptedAt: "2026-10-18T08:27:00Z",
    inputDefinition: null,
    inputExample: null,
    feedback: null,
    systemPrompt: null,
    userPrompt: null,
    output: "A synthetic alignment specimen for optical microscopy.",
    publication: "unchanged",
    references: [],
    sourceInputs: [input(uploaded), input(pasted)],
    reportedSources: []
  }
}
const render = (entry: ContributionEvidence) =>
  renderToStaticMarkup(
    <ContributionEvidencePanel
      contributions={[entry]}
      termSlug="mixed_source_coupon_20261018"
      vocabularySlug="ui_qa_20261017_134"
    />
  )
const summary = (html: string) =>
  html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)![1]
const mixed = render(mixedSourceContribution)
assert.match(summary(mixed), /2 uploaded or pasted sources · 1 citation/)
assert.doesNotMatch(summary(mixed), /0 citations/)
assert.match(mixed, /Uploaded and pasted sources \(2\)/)
assert.match(mixed, /Uploaded and pasted sources sent to the assistant \(2\)/)
assert.match(mixed, /Lookup references sent to the assistant \(0\)/)
assert.match(mixed, /Selected passages/)
assert.match(mixed, /Full text/)
assert.match(mixed, /Read pasted text/)
assert.match(mixed, /Download original file/)
assert.equal(mixed.match(/Cited by contributor/g)?.length, 1)
assert.equal(mixed.match(/Used by assistant/g)?.length, 2)
assert.match(mixed, /&lt;script&gt;untrusted&lt;\/script&gt;/)
assert.doesNotMatch(mixed, /<script>/)
for (const source of [uploaded, pasted]) {
  assert(mixed.includes(`href="${source.readerHref}"`))
  assert(mixed.includes(`href="${source.downloadHref}"`))
}

const lookup = {
  term: "coupon",
  definition: "A test specimen.",
  source: "Reference vocabulary",
  sourceKey: "fixture",
  sourceIri: "https://example.test/coupon",
  kind: "definition" as const,
  usageStatus: "open" as const,
  version: "test-release",
  license: null,
  contentHash: "reference-hash",
  retrievedAt: "2026-10-18T08:21:00Z",
  context: null,
  responseUuid: null
}
const combined = render({ ...mixedSourceContribution, citations: [lookup] })
assert.match(summary(combined), /2 uploaded or pasted sources · 2 citations/)
assert.match(combined, /Cited lookup references \(1\)/)
const citedOnly = render({
  ...mixedSourceContribution,
  model: null,
  sources: [{ ...uploaded, assistantUsed: false }]
})
assert.match(summary(citedOnly), /1 uploaded or pasted source · 1 citation/)
assert.doesNotMatch(citedOnly, /Recorded model assistance|Used by assistant/)
const usedOnly = render({
  ...mixedSourceContribution,
  sources: [{ ...uploaded, contributorCited: false }, pasted]
})
assert.match(summary(usedOnly), /2 uploaded or pasted sources · 0 citations/)
assert.doesNotMatch(usedOnly, /Cited by contributor/)
const legacy = render({
  ...mixedSourceContribution,
  sources: [],
  model: { ...mixedSourceContribution.model!, sourceInputs: null, output: null }
})
assert.doesNotMatch(
  legacy,
  /0 uploaded or pasted|sources sent to the assistant \(0\)/
)
assert.match(legacy, /No separate lookup-reference record is linked here/)
const missingReader = render({
  ...mixedSourceContribution,
  model: null,
  sources: [{ ...uploaded, readerHref: null, assistantUsed: false }]
})
assert.doesNotMatch(missingReader, /Read source text|href="null"/)
console.log(
  "Contribution evidence source counts, citations, links and escaped inputs passed."
)
