import assert from "node:assert/strict"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ProvenanceTimeline } from "../components/provenance/timeline"
import type { ProvEvent } from "../lib/provenance"
import {
  buildContributionEvidence,
  contributionEvidenceAnchor
} from "../lib/contribution-evidence"
import { createTextDiff } from "../lib/definition-comparison"
import {
  examplePublicationEvent,
  exampleSelectionEvents
} from "../lib/example-provenance-events"
import type { InferenceMetadata } from "../lib/llm/types"
import type { ModelReferenceInput } from "../lib/reference-types"
import type { ContributionFileItem } from "../lib/contribution-file-types"
import type { SourceInputSnapshot } from "../lib/source-document-types"

type EvidenceInput = Parameters<typeof buildContributionEvidence>[0]
type Revision = EvidenceInput["revisions"][number]
type Suggestion = EvidenceInput["suggestions"][number]
const generatedAt = "2026-09-01T10:00:00Z"
const publishedAt = "2026-09-01T10:05:00Z"
const editedAt = "2026-09-02T10:00:00Z"
const inference: InferenceMetadata = {
  provider: "wolfram-agent-one",
  profile: "agent-one",
  model: "wolfram-agent-one",
  configHash: "test-hash"
}
const reference: ModelReferenceInput = {
  referenceId: "private-reference-id",
  term: "ceric oxide",
  definition: "Stored source text.",
  source: "ChEBI",
  sourceIri: "http://purl.obolibrary.org/obo/CHEBI_79041",
  sourceKey: "chebi",
  kind: "definition",
  usageStatus: "open",
  version: "test-release",
  license: "CC-BY-4.0",
  contentHash: "source-content-hash",
  retrievedAt: generatedAt,
  context: null,
  responseUuid: null
}
const privateReference = {
  ...reference,
  lookupId: "private-lookup-id",
  endpoint: "https://private.example.test/lookup",
  requestedById: 701,
  copiedAt: generatedAt,
  addedToDraftAt: generatedAt
}
const revision = (overrides: Partial<Revision> = {}): Revision => ({
  id: 501,
  definitionId: 7,
  version: 1,
  definitionDiff: createTextDiff("", "Generated definition."),
  createdAt: publishedAt,
  model: null,
  inference: null,
  prompt: null,
  ...overrides
})
const suggestion = (overrides: Partial<Suggestion> = {}): Suggestion => ({
  status: "accepted",
  outputDefinitionId: 7,
  createdAt: generatedAt,
  decidedAt: publishedAt,
  model: "wolfram-agent-one",
  inference,
  suggestedDefinition: "Generated definition.",
  inputDefinition: "Contributor notes.",
  inputExample: "Contributor example.",
  feedback: "Clarify the material.",
  promptText: "Exact system prompt.",
  userPrompt: "Exact user message.",
  referenceInputs: [privateReference],
  ...overrides
})
const evidence = (overrides: Partial<EvidenceInput> = {}) =>
  buildContributionEvidence({
    definitions: [{ id: 7, definitionNumber: 42 }],
    revisions: [revision()],
    citations: [],
    suggestions: [suggestion()],
    ...overrides
  })

const bound = evidence({
  definitions: [
    { id: 7, definitionNumber: 42 },
    { id: 8, definitionNumber: 3 }
  ],
  revisions: [
    revision(),
    revision({
      id: 502,
      version: 2,
      createdAt: editedAt,
      definitionDiff: createTextDiff("Generated definition.", "Human revision.")
    }),
    revision({ id: 601, definitionId: 8 }),
    revision({ id: 999, definitionId: 999 })
  ],
  citations: [
    { ...privateReference, revisionId: 501 },
    {
      ...reference,
      sourceIri: "https://example.test/revision-two",
      definition: "Later source.",
      revisionId: 502
    },
    { ...reference, revisionId: 999 }
  ]
})
assert.deepEqual(
  bound.map(({ definitionNumber, version }) => [definitionNumber, version]),
  [
    [42, 1],
    [42, 2]
  ]
)
assert.equal(bound[0].model?.publication, "unchanged")
assert.equal(bound[0].publishedText, "Generated definition.")
assert.equal(bound[0].publishedAt, publishedAt)
assert.equal(
  bound[1].model,
  null,
  "later revisions must not inherit the first revision's accepted suggestion"
)
assert.equal(bound[1].publishedText, "Human revision.")
assert.equal(bound[1].citations[0].definition, "Later source.")
assert.equal(bound[0].citations[0].definition, reference.definition)
assert.equal(bound[0].model?.recordedAt, generatedAt)
assert.equal(bound[0].model?.acceptedAt, publishedAt)
assert.equal(bound[0].model?.inputDefinition, "Contributor notes.")
assert.equal(bound[0].model?.inputExample, "Contributor example.")
assert.equal(bound[0].model?.feedback, "Clarify the material.")
assert.equal(bound[0].model?.systemPrompt, "Exact system prompt.")
assert.equal(bound[0].model?.userPrompt, "Exact user message.")
assert.equal(bound[0].model?.output, "Generated definition.")
for (const projected of [
  bound[0].citations[0],
  bound[0].model!.references[0]
]) {
  for (const field of [
    "referenceId",
    "lookupId",
    "endpoint",
    "requestedById",
    "copiedAt",
    "addedToDraftAt",
    "revisionId"
  ])
    assert(
      !Object.hasOwn(projected, field),
      `private reference field ${field} must not escape`
    )
  assert.equal(projected.contentHash, reference.contentHash)
  assert.equal(projected.version, reference.version)
  assert.equal(projected.sourceIri, reference.sourceIri)
  assert.equal(projected.retrievedAt, reference.retrievedAt)
  assert(!Object.hasOwn(projected, "query"))
  assert(!Object.hasOwn(projected, "request"))
}
assert(!JSON.stringify(bound).includes("private-lookup-id"))
assert.equal(
  contributionEvidenceAnchor(42, 2),
  "definition-42-revision-2-evidence"
)

const wolframReference: ModelReferenceInput = {
  ...reference,
  sourceKey: "wolfram",
  source: "Wolfram|Alpha",
  kind: "context",
  usageStatus: "prototype",
  license: null,
  responseUuid: "recorded-response-uuid",
  context: "polishing materials",
  query: "ceric oxide",
  request: {
    input: "ceric oxide\nContext: polishing materials",
    context: "polishing materials",
    options: { units: "metric", assumptions: ["Chemical"] }
  }
}
const wolframEvidence = evidence({
  suggestions: [suggestion({ referenceInputs: [wolframReference] })]
})[0].model!.references[0]
assert.deepEqual(wolframEvidence.request, wolframReference.request)
assert.equal(wolframEvidence.query, wolframReference.query)
assert.equal(wolframEvidence.responseUuid, wolframReference.responseUuid)
assert.equal(wolframEvidence.license, null)
assert.equal(wolframEvidence.usageStatus, "prototype")

for (const status of ["generated", "discarded", "pending"])
  assert.deepEqual(
    evidence({ suggestions: [suggestion({ status })] }),
    [],
    `${status} previews are not published evidence`
  )
assert.deepEqual(
  evidence({ suggestions: [suggestion({ outputDefinitionId: null })] }),
  []
)
assert.deepEqual(
  evidence({ suggestions: [suggestion({ outputDefinitionId: 8 })] }),
  [],
  "matching text cannot substitute for an exact accepted output identity"
)
assert.deepEqual(evidence({ suggestions: [] }), [])
assert.equal(
  evidence({
    revisions: [
      revision({
        definitionDiff: createTextDiff(
          "Generated definition.",
          "Contributor-edited definition."
        )
      })
    ]
  })[0].model?.publication,
  "edited"
)
assert.equal(
  evidence({
    revisions: [
      revision({ definitionDiff: createTextDiff("", "Generated definition. ") })
    ]
  })[0].model?.publication,
  "edited",
  "even whitespace edits must not be called an exact model output"
)

const reportedUrl = "https://www.wolframalpha.com/input?i=ceric+oxide"
const humanAddedUrl = "https://example.test/human-added-source"
const footer = (url: string) =>
  `\n\n#### Wolfram Sources\n\n- Wolfram|Alpha: [\\[1\\]](${url})`
const originalOutput = "Original model response." + footer(reportedUrl)
const humanPublication = "Edited publication." + footer(humanAddedUrl)
const returned = evidence({
  revisions: [
    revision({ definitionDiff: createTextDiff("", humanPublication) })
  ],
  suggestions: [suggestion({ suggestedDefinition: originalOutput })]
})[0]
assert.equal(returned.model?.output, originalOutput)
assert.equal(returned.publishedText, humanPublication)
assert.equal(returned.model?.publication, "edited")
assert.deepEqual(returned.model?.reportedSources, [{ url: reportedUrl }])
assert.equal(returned.model?.references[0].sourceIri, reference.sourceIri)
assert.deepEqual(
  returned.citations,
  [],
  "model inputs and reported links do not create human citations"
)

const unknown = evidence({
  revisions: [
    revision({
      model: "legacy model",
      inference,
      prompt: "Known legacy system prompt.",
      definitionDiff: createTextDiff("", humanPublication)
    })
  ],
  suggestions: []
})[0].model!
assert.equal(unknown.name, "legacy model")
assert.equal(unknown.publication, "unknown")
assert.equal(unknown.systemPrompt, "Known legacy system prompt.")
for (const field of [
  "recordedAt",
  "acceptedAt",
  "inputDefinition",
  "inputExample",
  "feedback",
  "userPrompt",
  "output"
] as const)
  assert.equal(
    unknown[field],
    null,
    `${field} must stay unknown rather than reconstructed`
  )
assert.deepEqual(unknown.references, [])
assert.deepEqual(
  unknown.reportedSources,
  [],
  "never mine contributor publication text for legacy provider source claims"
)
assert.deepEqual(
  evidence({
    revisions: [
      revision({
        model: "legacy model",
        inference: { ...inference, reportedSources: [{ url: reportedUrl }] }
      })
    ],
    suggestions: []
  })[0].model?.reportedSources,
  [{ url: reportedUrl }],
  "existing explicit metadata can be displayed even when legacy output is missing"
)
assert.equal(
  evidence({
    citations: [{ ...reference, revisionId: 501 }],
    suggestions: []
  })[0].model,
  null,
  "a cited source does not imply AI assistance"
)

const sourceFile = (
  overrides: Partial<ContributionFileItem> = {}
): ContributionFileItem => ({
  id: "uploaded-source",
  filename: "source.txt",
  mediaType: "text/plain",
  byteSize: 100,
  contentHash: "original-file-hash",
  role: "source",
  title: "Uploaded source",
  caption: "Contributor's description of the source.",
  citation: "Contributor-provided citation.",
  page: null,
  createdAt: generatedAt,
  publishedRevisionId: 501,
  exampleId: null,
  publishedAt,
  origin: "upload",
  contributorCited: true,
  publishedExtractionId: "private-extraction-id",
  // This global query field must not imply use by this revision's assistant.
  assistantUsed: false,
  ...overrides
})
const sourceInput = (
  overrides: Partial<SourceInputSnapshot> = {}
): SourceInputSnapshot => ({
  fileId: "uploaded-source",
  extractionId: "private-extraction-id",
  checkId: "private-check-id",
  title: "Uploaded source at request time",
  origin: "upload",
  fileHash: "original-file-hash",
  extractionTextHash: "extracted-text-hash",
  text: "Exact selected passage supplied to the model.",
  textHash: "model-input-hash",
  mode: "passages",
  term: "ceric oxide",
  aliases: ["ceria"],
  matches: [],
  locations: [],
  parserVersion: "source-extraction-v1",
  method: "text",
  hasOcr: false,
  ocrReviewed: false,
  extractedAt: generatedAt,
  checkedAt: generatedAt,
  matcherVersion: "unicode-phrase-v1",
  ocrReviewRecordedAt: null,
  reviewerId: 701,
  contextSelectedAt: generatedAt,
  extractionSteps: [
    {
      id: "private-extraction-id",
      parentExtractionId: null,
      correctedById: 701,
      textHash: "extracted-text-hash",
      parserVersion: "source-extraction-v1",
      method: "text",
      hasOcr: false,
      completedAt: generatedAt
    }
  ],
  ...overrides
})
const privateFile = {
  ...sourceFile(),
  uploadedById: 701,
  bytes: "PRIVATE FILE BYTES",
  storagePath: "/private/source/path",
  draftId: "private-draft-id"
}
const privateSourceInput = {
  ...sourceInput(),
  draftId: "private-draft-id",
  storagePath: "/private/source/path",
  requestId: "private-request-id"
}
const pastedFile = sourceFile({
  id: "pasted-source",
  title: "Pasted context",
  origin: "paste",
  contributorCited: false
})
const pastedInput = sourceInput({
  fileId: "pasted-source",
  title: "Pasted context at request time",
  origin: "paste",
  mode: "full",
  text: "Exact full pasted text supplied to the model."
})
const mixedSources = evidence({
  publishedFiles: [privateFile, pastedFile, privateFile],
  suggestions: [
    suggestion({
      referenceInputs: [],
      sourceInputs: [privateSourceInput, pastedInput, privateSourceInput]
    })
  ]
})[0]
assert.equal(mixedSources.citations.length, 0)
assert.equal(mixedSources.sources.length, 2, "a source is counted once")
assert.equal(
  mixedSources.citations.length +
    mixedSources.sources.filter((source) => source.contributorCited).length,
  1,
  "only the uploaded source was explicitly cited; assistant use adds no citation"
)
assert.deepEqual(
  mixedSources.sources.map(({ origin, contributorCited, assistantUsed }) => ({
    origin,
    contributorCited,
    assistantUsed
  })),
  [
    { origin: "upload", contributorCited: true, assistantUsed: true },
    { origin: "paste", contributorCited: false, assistantUsed: true }
  ]
)
assert.equal(mixedSources.model?.sourceInputs?.length, 2)
assert.equal(mixedSources.model?.references.length, 0)
assert.equal(
  mixedSources.model?.sourceInputs?.[0].title,
  privateSourceInput.title,
  "model input metadata comes from the accepted immutable receipt"
)
assert.deepEqual(
  mixedSources.model?.sourceInputs?.map(({ mode, text }) => ({ mode, text })),
  [
    { mode: "passages", text: privateSourceInput.text },
    { mode: "full", text: pastedInput.text }
  ]
)
assert.equal(mixedSources.sources[0].readerHref, "/sources/uploaded-source")
assert.equal(
  mixedSources.sources[0].downloadHref,
  "/api/contribution-files/uploaded-source"
)
assert.equal(
  mixedSources.model?.sourceInputs?.[0].readerHref,
  mixedSources.sources[0].readerHref
)
for (const projected of mixedSources.sources)
  for (const field of [
    "uploadedById",
    "bytes",
    "storagePath",
    "draftId",
    "publishedExtractionId",
    "publishedRevisionId"
  ])
    assert(!Object.hasOwn(projected, field), `${field} is not public evidence`)
for (const projected of mixedSources.model!.sourceInputs!)
  for (const field of [
    "extractionId",
    "checkId",
    "reviewerId",
    "extractionSteps",
    "draftId",
    "storagePath",
    "requestId"
  ])
    assert(!Object.hasOwn(projected, field), `${field} is not public evidence`)
for (const privateValue of [
  "PRIVATE FILE BYTES",
  "private-extraction-id",
  "private-check-id",
  "private-draft-id",
  "/private/source/path",
  "private-request-id"
])
  assert(!JSON.stringify(mixedSources).includes(privateValue))

const sourceOnly = evidence({
  publishedFiles: [sourceFile({ assistantUsed: true })],
  suggestions: []
})[0]
assert.equal(sourceOnly.model, null)
assert.equal(sourceOnly.sources.length, 1)
assert.equal(sourceOnly.sources[0].contributorCited, true)
assert.equal(
  sourceOnly.sources[0].assistantUsed,
  false,
  "a published file's global use flag is not evidence of use for this revision"
)
const withLookupCitation = evidence({
  publishedFiles: [sourceFile()],
  citations: [{ ...reference, revisionId: 501 }],
  suggestions: []
})[0]
assert.equal(
  withLookupCitation.citations.length +
    withLookupCitation.sources.filter((source) => source.contributorCited)
      .length,
  2,
  "lookup citations and explicitly cited files are independent citations"
)
for (const excluded of [
  sourceFile({ role: "example", exampleId: 123 }),
  sourceFile({ publishedRevisionId: null, publishedAt: null }),
  sourceFile({ publishedAt: null }),
  sourceFile({ publishedRevisionId: 999 })
])
  assert.deepEqual(
    evidence({ publishedFiles: [excluded], suggestions: [] }),
    [],
    "examples, pending files and other revisions must not create evidence"
  )
const historicalSources = evidence({
  revisions: [revision(), revision({ id: 502, version: 2 })],
  publishedFiles: [
    sourceFile(),
    pastedFile,
    sourceFile({
      id: "later-source",
      publishedRevisionId: 502,
      assistantUsed: true
    })
  ],
  suggestions: [suggestion({ sourceInputs: [sourceInput(), pastedInput] })]
})
assert.deepEqual(
  historicalSources.map(({ sources }) => sources.map(({ fileId }) => fileId)),
  [["uploaded-source", "pasted-source"], ["later-source"]]
)
assert.equal(historicalSources[1].model, null)
assert.equal(historicalSources[1].sources[0].assistantUsed, false)
assert.equal(
  evidence({
    publishedFiles: [sourceFile({ publishedExtractionId: null })],
    suggestions: []
  })[0].sources[0].readerHref,
  null,
  "older attachments without a transcript retain only their download link"
)
for (const status of ["generated", "discarded", "pending"])
  assert.equal(
    evidence({
      publishedFiles: [sourceFile({ assistantUsed: true })],
      suggestions: [suggestion({ status, sourceInputs: [sourceInput()] })]
    })[0].sources[0].assistantUsed,
    false,
    "a preview must not make a published-source assistant-use claim"
  )
const unlinkedInput = evidence({
  publishedFiles: [sourceFile({ publishedRevisionId: 502 })],
  suggestions: [suggestion({ sourceInputs: [sourceInput()] })]
})[0].model!.sourceInputs![0]
assert.equal(unlinkedInput.text, sourceInput().text)
assert.equal(unlinkedInput.fileId, null)
assert.equal(unlinkedInput.readerHref, null)
assert.equal(unlinkedInput.downloadHref, null)
assert.equal(
  evidence({ suggestions: [suggestion({ sourceInputs: null })] })[0].model
    ?.sourceInputs,
  null,
  "older nullable receipts do not prove that zero documents were used"
)
assert.equal(evidence()[0].model?.sourceInputs, null)
assert.equal(unknown.sourceInputs, null)
assert.deepEqual(
  evidence({ suggestions: [suggestion({ sourceInputs: [] })] })[0].model
    ?.sourceInputs,
  [],
  "an explicit empty receipt records a known zero source count"
)

const publicActor = {
  id: 11,
  name: "Public author",
  isAi: false,
  isProfilePublic: true
}
const privateActor = {
  id: 12,
  name: "Private author",
  isAi: false,
  isProfilePublic: false
}
const publication = {
  id: "example-publication",
  definitionNumber: 42,
  exampleNumber: 3,
  version: 2,
  text: "A contributed example.",
  createdAt: editedAt,
  legacyBackfill: false,
  author: publicActor,
  href: "/vocabulary/id4/ceric-oxide/definitions/42#example-3"
}
const published = examplePublicationEvent(publication)[0]
assert.equal(published.kind, "example-published")
assert.equal(published.at, editedAt)
assert.equal(published.profileUserId, publicActor.id)
assert.equal(published.actorKind, "person")
assert.match(published.detail!, /revision 2[\s\S]*A contributed example\./)
assert.equal(published.href, publication.href)
assert.deepEqual(
  examplePublicationEvent({ ...publication, legacyBackfill: true }),
  [],
  "import time must not become a claimed historical publication time"
)
for (const [author, actorKind] of [
  [privateActor, "person"],
  [{ ...publicActor, isAi: true }, "software"],
  [{ id: 13, name: "Unknown profile", isProfilePublic: true }, "person"],
  [null, "unknown"]
] as const) {
  const event = examplePublicationEvent({ ...publication, author })[0]
  assert.equal(event.profileUserId, undefined)
  assert.equal(event.actorKind, actorKind)
  assert.equal(event.actor, author?.name ?? "Unknown contributor")
}

const selection = {
  id: "feature-interval",
  definitionNumber: 42,
  exampleNumber: 3,
  selectedAt: publishedAt,
  endedAt: editedAt,
  legacyBackfill: false,
  selectedBy: publicActor,
  endedBy: privateActor,
  href: publication.href
}
const selected = exampleSelectionEvents(selection)
assert.deepEqual(
  selected.map(({ kind, at }) => [kind, at]),
  [
    ["example-featured", publishedAt],
    ["example-unfeatured", editedAt]
  ]
)
assert.notEqual(selected[0].id, selected[1].id)
assert.equal(selected[0].profileUserId, publicActor.id)
assert.equal(selected[1].actor, privateActor.name)
assert.equal(selected[1].profileUserId, undefined)
assert(
  !selected.some(({ summary }) => summary.includes("revision")),
  "feature decisions have definition scope, not an inferred revision"
)
assert.equal(exampleSelectionEvents({ ...selection, endedAt: null }).length, 1)
assert.deepEqual(
  exampleSelectionEvents({ ...selection, legacyBackfill: true, endedAt: null }),
  []
)
const importedEnd = exampleSelectionEvents({
  ...selection,
  legacyBackfill: true,
  endedBy: null
})
assert.equal(importedEnd.length, 1)
assert.equal(importedEnd[0].kind, "example-unfeatured")
assert.equal(importedEnd[0].at, editedAt)
assert.equal(importedEnd[0].actorKind, "unknown")
assert.equal(importedEnd[0].profileUserId, undefined)
assert.equal(importedEnd[0].href, selection.href)

const timelineEvent: ProvEvent = {
  id: "published-definition",
  at: publishedAt,
  kind: "definition-created",
  actor: "Human publisher",
  actorKind: "person",
  profileUserId: 701,
  summary: "Definition 4 · revision 1 published with AI assistance",
  model: "test-model"
}
const renderEvent = (overrides: Partial<ProvEvent> = {}) =>
  renderToStaticMarkup(
    createElement(ProvenanceTimeline, {
      events: [{ ...timelineEvent, ...overrides }]
    })
  )
const humanPublicationMarkup = renderEvent()
assert.match(humanPublicationMarkup, /Human publisher/)
assert.match(humanPublicationMarkup, /href="\/people\/701"/)
assert.match(humanPublicationMarkup, /test-model/)
assert.equal(
  renderEvent({
    actor: "test-model",
    actorKind: "software",
    profileUserId: undefined
  }).match(/test-model/g)?.length,
  1,
  "a software actor whose name matches the model needs only one label"
)
assert.match(
  renderEvent({
    actor: "Named software contributor",
    actorKind: "software",
    profileUserId: undefined
  }),
  /Named software contributor/,
  "a distinct software identity remains visible beside the model"
)

console.log(
  "Contribution evidence revision binding, source privacy, model lineage and example event checks passed."
)
