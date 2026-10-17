import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"
import { ContributionFileDownloads } from "../components/definition/contribution-file-downloads"
import {
  ContributionFilesReview,
  ContributionFileFields
} from "../components/definition/contribution-files"
import { SourceInputEvidence } from "../components/definition/source-document-context"
import { DefinitionToolbox } from "../components/definition/add-definition-workspace"
import {
  emptyTermDraftPayload,
  termDraftPayloadSchema
} from "../lib/term-draft-types"
import type {
  SourceContextSelection,
  SourceInputSnapshot
} from "../lib/source-document-types"
import type { ContributionFileItem } from "../lib/contribution-file-types"
import { sourceInputSnapshotSchema } from "../lib/source-document-selection"

const file: ContributionFileItem = {
  id: "c95c251c-cb45-40f8-84e9-dd73c036dd91",
  filename: "pasted-source.txt",
  mediaType: "text/plain",
  byteSize: 100,
  contentHash: "fixture-hash",
  role: "source",
  title: "Laboratory notes",
  caption: "Source for grain boundary",
  citation: null,
  page: null,
  createdAt: "2026-10-17T12:00:00Z",
  publishedRevisionId: null,
  exampleId: null,
  publishedAt: null,
  origin: "paste"
}
const selection: SourceContextSelection = {
  fileId: file.id,
  checkId: "a58f976c-6360-4c84-a9d8-3ce2bba26c16",
  mode: "passages",
  passageIds: ["first-passage"],
  ocrReviewed: true
}
const snapshot: SourceInputSnapshot = {
  ...selection,
  extractionId: "e470797b-4210-43aa-be58-43e90bd11211",
  title: file.title,
  origin: "paste",
  fileHash: "fixture-hash",
  extractionTextHash: "transcript-hash",
  text: "A grain boundary separates adjacent crystals. <script>untrusted</script>",
  textHash: "input-hash",
  term: "grain boundary",
  aliases: [],
  matches: [],
  locations: [],
  parserVersion: "fixture-v1",
  hasOcr: false,
  extractedAt: file.createdAt,
  checkedAt: file.createdAt,
  matcherVersion: "fixture-v1",
  ocrReviewRecordedAt: null,
  reviewerId: null,
  contextSelectedAt: file.createdAt
}

// Public labels describe two independent facts, not an implication between them.
const citedOnly = renderToStaticMarkup(
  <ContributionFileDownloads files={[{ ...file, contributorCited: true }]} />
)
assert.match(citedOnly, /Cited by contributor/)
assert.doesNotMatch(citedOnly, /Used by assistant/)
assert.match(citedOnly, /Read pasted text/)
assert.match(citedOnly, new RegExp(`/sources/${file.id}`))
const usedOnly = renderToStaticMarkup(
  <ContributionFileDownloads
    files={[{ ...file, contributorCited: false, assistantUsed: true }]}
  />
)
assert.match(usedOnly, /Used by assistant/)
assert.doesNotMatch(usedOnly, /Cited by contributor/)
const both = renderToStaticMarkup(
  <ContributionFileDownloads
    files={[{ ...file, contributorCited: true, assistantUsed: true }]}
  />
)
assert.match(both, /Cited by contributor/)
assert.match(both, /Used by assistant/)

// Required model evidence is visible even when the contributor citation is off.
const review = renderToStaticMarkup(
  <ContributionFilesReview
    files={[{ ...file, publish: false }]}
    onFilesChange={() => {}}
    assistantSourceInputs={[snapshot]}
  />
)
assert.match(review, /Used by assistant · included with this definition/)
assert.doesNotMatch(review, /checked=""/)
const recoveredEvidence = renderToStaticMarkup(
  <ContributionFilesReview
    files={[]}
    onFilesChange={() => {}}
    assistantSourceInputs={[snapshot]}
  />
)
assert.match(recoveredEvidence, /Laboratory notes/)
assert.match(recoveredEvidence, /Used by assistant/)
const evidence = renderToStaticMarkup(
  <SourceInputEvidence inputs={[snapshot]} />
)
assert.match(evidence, /A grain boundary separates adjacent crystals/)
assert.doesNotMatch(evidence, /<script>/)
assert.match(evidence, /&lt;script&gt;/)

const panel = renderToStaticMarkup(
  <ContributionFileFields
    files={[]}
    onFilesChange={() => {}}
    term="grain boundary"
    vocabularySlug="materials"
  />
)
assert.match(panel, /Upload file/)
assert.match(panel, /Paste text/)
assert.match(panel, /\.docx/)
assert.match(panel, /\.txt/)
assert.match(panel, /image\/png/)
assert.match(panel, /role="tabpanel"/)
const sourceLimit = renderToStaticMarkup(
  <ContributionFileFields
    files={[]}
    onFilesChange={() => {}}
    term="grain boundary"
    vocabularySlug="materials"
    assistantSourceInputs={[
      snapshot,
      { ...snapshot, fileId: "3e54d7a2-6625-4204-a3dc-1f845546e0bd" },
      { ...snapshot, fileId: "ec001ca4-6354-41da-b82c-226d05c83e01" }
    ]}
  />
)
assert.doesNotMatch(sourceLimit, /Upload file/)
assert.doesNotMatch(sourceLimit, /Paste text/)
const toolbox = renderToStaticMarkup(
  <DefinitionToolbox
    view="advanced"
    active={null}
    onSelect={() => {}}
    panels={{ files: null, citations: null, assistant: null, wolfram: null }}
  />
)
assert.match(toolbox, /Add file or text/)
const fileButton = toolbox.match(
  /<button[^>]*id="[^"]*-files-command"[^>]*>/
)?.[0]
assert.ok(fileButton, "The source action is a button")
assert.match(fileButton, /class="[^"]* border bg-background/)

// Legacy drafts remain readable; selected evidence survives serialization.
const draft = emptyTermDraftPayload("materials")
const legacy = { ...draft } as Partial<typeof draft>
delete legacy.sources
assert.deepEqual(termDraftPayloadSchema.parse(legacy).sources, [])
const restored = termDraftPayloadSchema.parse(
  JSON.parse(JSON.stringify({ ...draft, sources: [selection] }))
)
assert.deepEqual(restored.sources, [selection])
const extractionSteps = [
  {
    id: snapshot.extractionId,
    parentExtractionId: "445892c6-9736-41a7-9f97-566fe0e8c643",
    correctedById: 1,
    textHash: "corrected-hash",
    parserVersion: "contributor-transcript-v1",
    method: "contributor-correction",
    hasOcr: true,
    completedAt: file.createdAt
  }
]
assert.deepEqual(
  sourceInputSnapshotSchema.parse({ ...snapshot, extractionSteps })
    .extractionSteps,
  extractionSteps,
  "Draft validation preserves correction lineage from authoritative receipts"
)
assert.equal(
  termDraftPayloadSchema.safeParse({
    ...draft,
    sources: [selection, selection]
  }).success,
  false
)

console.log(
  "Source compose UI: upload/paste surface, citation/use separation, immutable evidence rendering, and draft recovery passed."
)
