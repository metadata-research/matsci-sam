import assert from "node:assert/strict"
import {
  initialSetupDraft,
  restoreSetupDraft,
  singleTermImportText
} from "../lib/guided-setup"
import { parseImportText } from "../lib/setup-import"
import { emptyTermDraftPayload } from "../lib/term-draft-types"
import { changeSetupTerm, termDraftHasEvidence } from "../lib/setup-term-draft"

const initial = initialSetupDraft({
  vocabularySlug: "materials",
  communityId: 7
})
assert.equal(initial.step, "community")
assert.equal(initial.communityId, "7")
const imported = initialSetupDraft({
  task: "import",
  vocabularySlug: "materials"
})
assert.equal(imported.step, "vocabulary")
assert.equal(imported.mode, "import")
const review = {
  ...initial,
  step: "review",
  furthest: 4,
  term: "Fe, C",
  definition: 'A definition with "quotes"\nand two lines.',
  text: "term,definition\nIron,Element",
  collectionId: "3"
}
const restored = restoreSetupDraft(JSON.stringify(review), initial)
assert.equal(restored.step, "terms", "A restored review requires fresh preview")
assert.equal(restored.term, review.term)
assert.equal(restored.definition, review.definition)
assert.equal(restored.text, review.text)
assert.equal(restored.collectionId, "3")
assert.equal(restored.vocabularySlug, "materials")
const savedTermDraftId = "773f305a-1490-4b0f-8e13-f215a261c3fa"
const savedTerm = restoreSetupDraft(
  JSON.stringify({
    ...review,
    termDraftId: savedTermDraftId,
    termDraftDestinationChanged: true
  }),
  initial
)
assert.equal(savedTerm.termDraftId, savedTermDraftId)
assert.equal(savedTerm.termDraftDestinationChanged, true)
assert.equal(
  savedTerm.step,
  "terms",
  "A saved term still needs a fresh publication review"
)
const legacy = { ...review } as Partial<typeof review>
delete legacy.termDraftId
delete legacy.termDraftDestinationChanged
const recoveredLegacy = restoreSetupDraft(JSON.stringify(legacy), initial)
assert.equal(
  recoveredLegacy.term,
  review.term,
  "Browser drafts created before account drafts keep their writing"
)
assert.equal(recoveredLegacy.termDraftId, null)
assert.equal(recoveredLegacy.termDraftDestinationChanged, false)
for (const invalid of [
  "{bad json",
  JSON.stringify({ ...review, version: 2 }),
  JSON.stringify({ ...review, step: "admin" }),
  JSON.stringify({ ...review, termDraftId: "../../another-account" }),
  JSON.stringify({
    ...review,
    receipt: { title: "x", href: "//external.test", detail: "x" }
  })
]) {
  assert.deepEqual(restoreSetupDraft(invalid, initial), initial)
}
const parsed = parseImportText(
  singleTermImportText(review.term, review.definition),
  "csv"
)
assert.deepEqual(parsed.errors, [])
assert.equal(parsed.rows[0].term, review.term)
assert.equal(parsed.rows[0].definition, review.definition)
const receipt = {
  title: "Created",
  href: "/vocabulary/materials",
  detail: "Ready"
}
assert.deepEqual(
  restoreSetupDraft(JSON.stringify({ ...initial, receipt }), initial).receipt,
  receipt,
  "Reloading a completed creation retains its receipt instead of presenting another submit"
)
console.log("Guided setup draft recovery and review tests passed")

const plainDraft = {
  ...emptyTermDraftPayload("materials"),
  term: "grain",
  definition: "Working definition",
  editorState: {
    step: "write" as const,
    confirmed: { term: "grain", vocabularySlug: "materials" },
    references: [],
    preview: null,
    appliedDraft: null,
    undo: null,
    includeDefinition: true,
    includeExample: false
  }
}
const renamed = changeSetupTerm(plainDraft, "grain boundary")
assert.equal(renamed.term, "grain boundary")
assert.equal(renamed.definition, plainDraft.definition)
assert.equal(
  renamed.editorState?.confirmed,
  null,
  "A simple edit cannot retain the old term's confirmation"
)
assert.equal(renamed.editorState?.step, "confirm")
const fileDraft = {
  ...plainDraft,
  files: [{ fileId: savedTermDraftId, publish: false }]
}
assert.equal(termDraftHasEvidence(fileDraft), true)
assert.equal(
  changeSetupTerm(fileDraft, "different concept"),
  fileDraft,
  "Context-bound attachments require the full editor"
)
const citedDraft = {
  ...plainDraft,
  references: [
    { lookupId: savedTermDraftId, citedReferenceIds: [savedTermDraftId] }
  ]
}
assert.equal(changeSetupTerm(citedDraft, "different concept"), citedDraft)
console.log("Setup term handoff preserves writing and context-bound evidence")
