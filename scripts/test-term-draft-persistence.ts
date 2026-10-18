import assert from "node:assert/strict"
import { checkSourceDocument } from "../lib/source-document-matching"
import { sourceInputSnapshotSchema } from "../lib/source-document-selection"
import { sourceSelectionText } from "../lib/source-document-types"
import { compactTermDraftPayload } from "../lib/term-draft-persistence"
import { TermDraftSaveQueue } from "../lib/term-draft-save-queue"
import {
  emptyTermDraftPayload,
  TERM_DRAFT_MAX_CHARACTERS,
  termDraftPayloadSchema,
  type TermDraftEditorState,
  type TermDraftPayload
} from "../lib/term-draft-types"

// A valid document with many term occurrences can have a large evidence receipt
// even when only one short passage is sent to the assistant.
const term = "grain boundary"
const document = Array.from(
  { length: 1500 },
  (_, index) =>
    `The grain boundary measurement for sample ${index + 1} is recorded.\n`
).join("")
const check = checkSourceDocument({
  text: document,
  term,
  pages: [
    {
      page: null,
      start: 0,
      end: document.length,
      method: "text",
      label: "Source text",
      confidence: null
    }
  ]
})
const selection = {
  fileId: "a58f976c-6360-4c84-a9d8-3ce2bba26c16",
  checkId: "c95c251c-cb45-40f8-84e9-dd73c036dd91",
  mode: "passages" as const,
  passageIds: [check.passages[0].id],
  ocrReviewed: false
}
const text = sourceSelectionText(document, check.passages, selection)
const source = sourceInputSnapshotSchema.parse({
  ...selection,
  extractionId: "e470797b-4210-43aa-be58-43e90bd11211",
  title: "Measurement notes",
  origin: "paste",
  fileHash: "a".repeat(64),
  extractionTextHash: "b".repeat(64),
  text,
  textHash: "c".repeat(64),
  term,
  aliases: [],
  matches: check.matches,
  locations: check.passages[0].locations,
  parserVersion: "source-extraction-v1",
  method: "text",
  hasOcr: false,
  extractedAt: "2026-10-18T00:00:00Z",
  checkedAt: "2026-10-18T00:00:00Z",
  matcherVersion: check.matcherVersion,
  ocrReviewRecordedAt: null,
  reviewerId: null,
  contextSelectedAt: "2026-10-18T00:00:00Z"
})
const reference = {
  lookupId: "58d9ef59-dd48-4b45-965f-1e56643d8a9d",
  citedReferenceIds: ["f0e02f25-f5c6-4996-b346-3d0f05033735"],
  modelReferenceIds: ["f0e02f25-f5c6-4996-b346-3d0f05033735"],
  term,
  provider: "chebi" as const
}
const model: NonNullable<TermDraftEditorState["preview"]> & {
  futureProviderEvidence: { receiptId: string }
} = {
  suggestionId: 10,
  term,
  contextKey: `${term}:materials:::`,
  definition: "An interface between adjacent crystals.",
  model: "gemma4",
  assistantProfile: "default",
  assistantLabel: "Gemma 4",
  inference: { provider: "ollama", model: "gemma4" },
  referenceCount: 0,
  referenceInputs: [],
  sourceInputs: [source],
  requestInputs: { definition: "", example: "", userPrompt: text },
  baseline: {
    definition: "My earlier writing.",
    references: [reference]
  },
  promptInputs: [
    {
      id: `source:${source.fileId}`,
      label: "Source: Measurement notes",
      text,
      included: true,
      required: false
    }
  ],
  futureProviderEvidence: { receiptId: "provider-receipt" }
}
const payload: TermDraftPayload = {
  ...emptyTermDraftPayload("materials"),
  term,
  definition: "My current writing.",
  initialExample: "An example to keep.",
  collectionId: 5,
  files: [{ fileId: selection.fileId, publish: true }],
  sources: [selection],
  references: [
    {
      lookupId: reference.lookupId,
      citedReferenceIds: reference.citedReferenceIds
    }
  ],
  editorState: {
    step: "write",
    confirmed: { term, vocabularySlug: "materials" },
    references: [reference],
    preview: model,
    appliedDraft: null,
    undo: null,
    includeDefinition: true,
    includeExample: true,
    exampleOpen: true,
    assistantOpen: true,
    assistantProfile: "default"
  }
}

assert.equal(check.matches.length, 1500)
assert(text.length < 1200)
assert(JSON.stringify(payload).length > TERM_DRAFT_MAX_CHARACTERS)
const oldResult = termDraftPayloadSchema.safeParse(payload)
assert(!oldResult.success)
assert(
  oldResult.error.issues.some(
    (issue) => issue.message === "This draft is too large to save."
  )
)

const before = JSON.stringify(payload)
const compact = compactTermDraftPayload(payload)
assert.equal(JSON.stringify(payload), before, "Live preview is not changed")
assert.deepEqual(termDraftPayloadSchema.parse(compact), compact)
assert(JSON.stringify(compact).length < 5000)
assert.deepEqual(compact.sources, payload.sources)
assert.deepEqual(compact.files, payload.files)
assert.equal(compact.definition, payload.definition)
assert.equal(compact.initialExample, payload.initialExample)
assert.equal(compact.collectionId, payload.collectionId)
assert.deepEqual(
  compact.editorState?.preview?.baseline,
  payload.editorState?.preview?.baseline
)
assert.equal(compact.editorState?.preview?.suggestionId, model.suggestionId)
assert.equal(compact.editorState?.preview?.contextKey, model.contextKey)
assert.deepEqual(compact.editorState?.preview?.promptInputs, [
  { ...model.promptInputs[0], text: "" }
])
assert.equal(compact.editorState?.preview?.sourceInputs, undefined)
assert.equal(compact.editorState?.preview?.requestInputs, undefined)
assert.equal(compact.editorState?.preview?.inference, undefined)
assert.equal(compact.editorState?.preview?.definition, undefined)
assert.equal("futureProviderEvidence" in compact.editorState!.preview!, false)

// Applied and undo snapshots also retain independent IDs and writing while
// shedding receipts. Publishing must be able to flush the applied state.
const applied: TermDraftPayload = {
  ...payload,
  aiSuggestionId: model.suggestionId,
  editorState: {
    ...payload.editorState!,
    step: "review",
    preview: null,
    appliedDraft: model,
    undo: {
      definition: "Writing before source insertion.",
      references: [reference],
      kind: "source",
      label: "Undo source insertion",
      appliedDraft: { ...model, suggestionId: 9 }
    }
  }
}
const compactApplied = compactTermDraftPayload(applied)
assert.deepEqual(termDraftPayloadSchema.parse(compactApplied), compactApplied)
assert.equal(compactApplied.aiSuggestionId, 10)
assert.equal(compactApplied.editorState?.appliedDraft?.suggestionId, 10)
assert.equal(compactApplied.editorState?.undo?.appliedDraft?.suggestionId, 9)
assert.equal(
  compactApplied.editorState?.undo?.definition,
  applied.editorState?.undo?.definition
)
assert.equal(
  compactApplied.editorState?.undo?.appliedDraft?.sourceInputs,
  undefined
)
assert.deepEqual(compactTermDraftPayload(compactApplied), compactApplied)

// New payloads must not share mutable editor selections with hydrated UI state.
compact.sources[0].passageIds.push("temporary")
compact.editorState!.preview!.baseline.references[0].citedReferenceIds.length = 0
compact.editorState!.references[0].modelReferenceIds.length = 0
compact.files[0].publish = false
assert.equal(JSON.stringify(payload), before)

assert.deepEqual(
  compactTermDraftPayload(emptyTermDraftPayload()),
  emptyTermDraftPayload()
)
assert.equal(
  termDraftPayloadSchema.safeParse({
    ...compactApplied,
    aiSuggestionId: 99
  }).success,
  false,
  "Compaction does not bypass attribution validation"
)

async function testRestoredQueue() {
  type Record = {
    id: string
    version: number
    payload: TermDraftPayload | null
    status: string
  }
  const restored: Record = {
    id: "restored-draft",
    version: 3,
    payload: applied,
    status: "draft"
  }
  const writes: TermDraftPayload[] = []
  const queue = new TermDraftSaveQueue<TermDraftPayload, Record>(
    emptyTermDraftPayload(),
    {
      meaningful: (value) => !!value.term,
      uuid: () => "mutation-id",
      changed() {},
      async create() {
        throw new Error("Restoring an existing draft must not create one")
      },
      async update(input) {
        writes.push(input.payload)
        assert.equal(input.expectedVersion, restored.version)
        // Save responses remain hydrated for the editor and must never replace
        // the queue's compact persistence representation.
        return {
          ...restored,
          version: restored.version + 1,
          payload: { ...applied, definition: input.payload.definition }
        }
      }
    }
  )
  queue.restore(restored, compactTermDraftPayload(applied))
  assert.equal(queue.record, restored)
  assert.equal(
    queue.record?.payload?.editorState?.appliedDraft?.sourceInputs?.[0],
    source,
    "The restored editor record keeps its complete evidence"
  )
  assert.equal(queue.payload.editorState?.appliedDraft?.sourceInputs, undefined)
  assert.equal(queue.dirty, false, "Opening a saved draft is not an edit")
  queue.update(compactTermDraftPayload(applied))
  assert.equal(queue.dirty, false, "The initial editor payload stays clean")
  assert.equal(await queue.flush(), restored)
  assert.equal(writes.length, 0, "A restored draft needs no save request")

  queue.update(
    compactTermDraftPayload({ ...applied, definition: "My revised writing." })
  )
  assert.equal(queue.dirty, true)
  await queue.flush()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].definition, "My revised writing.")
  assert.equal(writes[0].editorState?.appliedDraft?.sourceInputs, undefined)
  assert.deepEqual(termDraftPayloadSchema.parse(writes[0]), writes[0])
  assert.equal(queue.payload.editorState?.appliedDraft?.sourceInputs, undefined)
  assert.equal(
    queue.record?.payload?.editorState?.appliedDraft?.sourceInputs?.[0],
    source
  )
  assert.equal(queue.dirty, false)
  await queue.flush()
  assert.equal(writes.length, 1)
  assert.equal(JSON.stringify(payload), before)
}

void testRestoredQueue()
  .then(() =>
    console.log(
      "Term draft persistence: large source preview/applied/undo receipts compact without losing writing, source choices, or suggestion identity; hydrated restores remain clean."
    )
  )
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
