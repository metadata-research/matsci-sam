import assert from "node:assert/strict"
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

console.log(
  "Contribution evidence revision binding, source privacy, model lineage and example event checks passed."
)
