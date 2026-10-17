import assert from "node:assert/strict"
import {
  sourceDocumentProvenance,
  sourceExtractionProvenance
} from "../lib/source-document-provenance"
import type {
  SourceExtractionStep,
  SourceInputSnapshot
} from "../lib/source-document-types"

const source: SourceInputSnapshot = {
  fileId: "file-one",
  extractionId: "extraction-one",
  checkId: "check-one",
  title: "Materials handbook",
  origin: "upload",
  fileHash: "a".repeat(64),
  extractionTextHash: "b".repeat(64),
  text: "Austenite is an iron phase.\nIts crystal structure is face-centered cubic.",
  textHash: "c".repeat(64),
  mode: "passages",
  term: "austenite",
  aliases: ["gamma iron"],
  matches: [
    {
      id: "match-one",
      start: 120,
      end: 129,
      text: "Austenite",
      matchedTerm: "austenite",
      isAlias: false,
      page: 3
    }
  ],
  locations: [
    { page: 3, start: 120, end: 190, method: "ocr", label: "Page 3" }
  ],
  parserVersion: "Poppler 24; Tesseract 5; source-extraction-v1",
  method: "embedded+ocr",
  hasOcr: true,
  ocrReviewed: true,
  extractedAt: "2026-10-17T10:01:00Z",
  checkedAt: "2026-10-17T10:02:00Z",
  matcherVersion: "unicode-phrase-v1",
  ocrReviewRecordedAt: "2026-10-17T10:03:00Z",
  reviewerId: 17,
  contextSelectedAt: "2026-10-17T10:03:00Z"
}
const request = {
  suggestionId: 41,
  status: "accepted",
  outputDefinitionId: 51,
  outputRevisionNode: "def_51_v1",
  requester: "user_17",
  sources: [source]
}
const graph = sourceDocumentProvenance(request)
const node = (id: string) => {
  const found = graph.nodes.find((item) => item.id === id)
  assert(found, `Missing ${id}`)
  return found
}
const hasEdge = (from: string, to: string, rel: string) =>
  graph.edges.some(
    (edge) => edge.source === from && edge.target === to && edge.rel === rel
  )
assert(hasEdge("act_source_extraction_extraction-one", "file_file-one", "used"))
assert(
  hasEdge(
    "source_transcript_extraction-one",
    "act_source_extraction_extraction-one",
    "wasGeneratedBy"
  )
)
assert(
  hasEdge("source_transcript_extraction-one", "file_file-one", "wasDerivedFrom")
)
assert.equal(
  node("act_source_extraction_extraction-one").meta?.method,
  source.method
)
assert.equal(
  node("act_source_extraction_extraction-one").meta?.completedAt,
  source.extractedAt
)
assert.equal(
  node("source_transcript_extraction-one").meta?.contentHash,
  source.extractionTextHash
)
assert.equal(
  node("source_transcript_extraction-one").meta?.reader,
  "/sources/file-one"
)
assert.equal(
  node("source_transcript_extraction-one").meta?.download,
  "/api/contribution-files/file-one"
)

assert(
  hasEdge(
    "act_source_match_check-one",
    "source_transcript_extraction-one",
    "used"
  )
)
assert(hasEdge("act_source_match_check-one", "user_17", "wasAssociatedWith"))
assert(
  hasEdge(
    "source_match_check-one",
    "act_source_match_check-one",
    "wasGeneratedBy"
  )
)
assert.equal(
  node("source_match_check-one").meta?.aliases,
  JSON.stringify(source.aliases)
)
assert.equal(
  node("source_match_check-one").meta?.matches,
  JSON.stringify(source.matches)
)
assert.equal(node("source_match_check-one").meta?.checkedAt, source.checkedAt)
assert.match(
  String(node("source_match_check-one").meta?.qualification),
  /does not establish source support/
)
const software = graph.nodes.filter((item) => item.type === "software")
assert.equal(software.length, 2)
assert.deepEqual(
  new Set(software.map((item) => item.meta?.version)),
  new Set([source.parserVersion, source.matcherVersion])
)

assert(
  hasEdge(
    "act_source_ocr_review_41_file-one",
    "source_transcript_extraction-one",
    "used"
  )
)
assert(
  hasEdge("act_source_ocr_review_41_file-one", "user_17", "wasAssociatedWith")
)
assert.equal(
  node("act_source_ocr_review_41_file-one").label,
  "OCR review confirmed"
)
assert.equal(
  node("act_source_ocr_review_41_file-one").meta?.recordedAt,
  source.ocrReviewRecordedAt
)
assert.match(
  String(node("act_source_ocr_review_41_file-one").meta?.qualification),
  /not proof of reading/
)
assert(
  hasEdge(
    "source_ocr_review_41_file-one",
    "act_source_ocr_review_41_file-one",
    "wasGeneratedBy"
  )
)
assert(
  hasEdge(
    "act_source_context_41_file-one",
    "source_ocr_review_41_file-one",
    "used"
  )
)
assert(
  hasEdge("act_source_context_41_file-one", "source_match_check-one", "used")
)
assert(
  hasEdge(
    "act_source_context_41_file-one",
    "source_transcript_extraction-one",
    "used"
  )
)
assert(
  hasEdge("act_source_context_41_file-one", "user_17", "wasAssociatedWith")
)
assert(
  hasEdge(
    "source_input_41_file-one",
    "act_source_context_41_file-one",
    "wasGeneratedBy"
  )
)
assert.equal(node("source_input_41_file-one").detail, source.text)
assert.equal(
  node("source_input_41_file-one").meta?.contentHash,
  source.textHash
)
assert.equal(
  node("source_input_41_file-one").meta?.originalFileHash,
  source.fileHash
)
assert.equal(
  node("source_input_41_file-one").meta?.locations,
  JSON.stringify(source.locations)
)
assert.equal(
  node("act_source_context_41_file-one").meta?.at,
  source.contextSelectedAt
)
assert(
  hasEdge(
    "act_ai_contribution_suggestion_41",
    "source_input_41_file-one",
    "used"
  )
)
assert(
  hasEdge(
    "ai_contribution_suggestion_41",
    "source_input_41_file-one",
    "wasDerivedFrom"
  )
)
assert(hasEdge("def_51_v1", "source_input_41_file-one", "wasDerivedFrom"))
assert(
  !graph.edges.some((edge) => edge.rel === "references"),
  "Actual model use must not create a contributor citation"
)
assert(
  !graph.nodes.some((item) => item.id === "file_file-one"),
  "The published file record supplies the original entity and its metadata"
)

for (const status of ["generated", "discarded", "pending", "failed"])
  assert.deepEqual(sourceDocumentProvenance({ ...request, status }), {
    nodes: [],
    edges: []
  })
assert.deepEqual(
  sourceDocumentProvenance({ ...request, outputDefinitionId: null }),
  { nodes: [], edges: [] }
)
assert.deepEqual(sourceDocumentProvenance({ ...request, sources: [] }), {
  nodes: [],
  edges: []
})

const manual = sourceExtractionProvenance({
  fileId: source.fileId,
  extractionId: source.extractionId,
  title: source.title,
  textHash: source.extractionTextHash,
  parserVersion: source.parserVersion,
  method: source.method,
  hasOcr: false,
  extractedAt: source.extractedAt
})
assert(
  !JSON.stringify(manual).includes("ai_contribution"),
  "A manually cited source has no implied model use"
)
assert(
  !JSON.stringify(manual).includes("source_match"),
  "Extraction alone does not imply a term check"
)
assert(
  !JSON.stringify(manual).includes("source_ocr_review"),
  "Extraction alone does not imply contributor review"
)

for (const noReview of [
  { hasOcr: false },
  { ocrReviewed: false },
  { ocrReviewRecordedAt: null },
  { reviewerId: null }
]) {
  const unreviewed = sourceDocumentProvenance({
    ...request,
    sources: [{ ...source, ...noReview }]
  })
  assert(
    !unreviewed.nodes.some((item) =>
      item.id.startsWith("act_source_ocr_review_")
    ),
    "Do not invent a missing review receipt"
  )
}

const originalGraph = JSON.stringify(graph)
const later = sourceDocumentProvenance({
  ...request,
  suggestionId: 42,
  outputDefinitionId: 52,
  outputRevisionNode: "def_52_v1",
  sources: [
    {
      ...source,
      extractionId: "extraction-two",
      checkId: "check-two",
      mode: "full",
      text: "A later extraction has different text.",
      aliases: ["another explicit alias"],
      contextSelectedAt: "2026-10-18T10:00:00Z"
    }
  ]
})
assert.equal(
  later.nodes.find((item) => item.id === "act_source_context_42_file-one")
    ?.label,
  "Select full source text"
)
assert.equal(
  later.nodes.find((item) => item.id === "source_input_42_file-one")?.detail,
  "A later extraction has different text."
)
assert.equal(JSON.stringify(graph), originalGraph)
assert(
  !later.edges.some(
    (edge) =>
      edge.source === "def_51_v1" || edge.target.includes("extraction-one")
  ),
  "Later extraction/selection receipts cannot be linked to an earlier publication"
)

const extractionSteps: SourceExtractionStep[] = [
  {
    id: source.extractionId,
    parentExtractionId: null,
    correctedById: null,
    textHash: source.extractionTextHash,
    parserVersion: source.parserVersion,
    method: source.method!,
    hasOcr: true,
    completedAt: source.extractedAt
  },
  {
    id: "correction-one",
    parentExtractionId: source.extractionId,
    correctedById: 17,
    textHash: "d".repeat(64),
    parserVersion: "contributor-transcript-v1",
    method: "contributor-correction",
    hasOcr: true,
    completedAt: "2026-10-17T10:01:30Z"
  },
  {
    id: "private-later-correction",
    parentExtractionId: "correction-one",
    correctedById: 17,
    textHash: "e".repeat(64),
    parserVersion: "contributor-transcript-v1",
    method: "contributor-correction",
    hasOcr: true,
    completedAt: "2026-10-17T10:04:00Z"
  }
]
const corrected = sourceDocumentProvenance({
  ...request,
  sources: [
    {
      ...source,
      extractionId: "correction-one",
      extractionTextHash: "d".repeat(64),
      method: "contributor-correction",
      parserVersion: "contributor-transcript-v1",
      extractedAt: "2026-10-17T10:01:30Z",
      extractionSteps
    }
  ]
})
const correctedEdge = (from: string, to: string, rel: string) =>
  corrected.edges.some(
    (edge) => edge.source === from && edge.target === to && edge.rel === rel
  )
assert(
  correctedEdge("act_source_extraction_extraction-one", "file_file-one", "used")
)
assert(
  correctedEdge(
    "act_source_extraction_correction-one",
    "source_transcript_extraction-one",
    "used"
  )
)
assert(
  correctedEdge(
    "source_transcript_correction-one",
    "source_transcript_extraction-one",
    "wasDerivedFrom"
  )
)
assert(
  correctedEdge(
    "act_source_extraction_correction-one",
    "user_17",
    "wasAssociatedWith"
  )
)
assert(
  correctedEdge(
    "source_transcript_correction-one",
    "user_17",
    "wasAttributedTo"
  )
)
assert(
  correctedEdge(
    "act_source_match_check-one",
    "source_transcript_correction-one",
    "used"
  )
)
assert(
  correctedEdge(
    "act_source_ocr_review_41_file-one",
    "source_transcript_correction-one",
    "used"
  )
)
assert(
  correctedEdge(
    "source_input_41_file-one",
    "source_transcript_correction-one",
    "wasDerivedFrom"
  )
)
assert.equal(
  corrected.nodes.find(
    (item) => item.id === "act_source_extraction_correction-one"
  )?.label,
  "Correct source transcript"
)
assert.equal(
  corrected.nodes.find((item) => item.id === "source_transcript_extraction-one")
    ?.meta?.contentHash,
  source.extractionTextHash
)
assert.equal(
  corrected.nodes.find((item) => item.id === "source_transcript_correction-one")
    ?.meta?.contentHash,
  "d".repeat(64)
)
assert(
  !JSON.stringify(corrected).includes("private-later-correction"),
  "Only the selected extraction's ancestry is public"
)
assert(!corrected.edges.some((edge) => edge.rel === "references"))

const correctedCitation = sourceExtractionProvenance({
  fileId: source.fileId,
  extractionId: "correction-one",
  title: source.title,
  textHash: "d".repeat(64),
  parserVersion: "contributor-transcript-v1",
  method: "contributor-correction",
  hasOcr: true,
  extractedAt: "2026-10-17T10:01:30Z",
  extractionSteps
})
assert(
  correctedCitation.edges.some(
    (edge) =>
      edge.source === "source_transcript_correction-one" &&
      edge.target === "user_17" &&
      edge.rel === "wasAttributedTo"
  )
)
assert(!JSON.stringify(correctedCitation).includes("ai_contribution"))
assert(!JSON.stringify(correctedCitation).includes("source_ocr_review"))
assert(!JSON.stringify(correctedCitation).includes("private-later-correction"))

console.log(
  "Source document provenance: extraction/correction lineage, term checks, OCR confirmation, exact input, publication lineage and private-preview exclusion passed."
)
