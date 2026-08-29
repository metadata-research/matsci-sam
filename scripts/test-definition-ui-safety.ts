import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = (path: string) => readFileSync(resolve(path), "utf8")

const section = (text: string, start: string, end: string) => {
  const startAt = text.indexOf(start)
  assert.notEqual(startAt, -1, `found start of ${start}`)
  const endAt = text.indexOf(end, startAt + start.length)
  assert.notEqual(endAt, -1, `found end of ${start}`)
  return text.slice(startAt, endAt)
}

// A historical page may display the definition-wide example collection, but
// it must not let a contributor attribute a new selection or example to text
// other than the exact revision on screen.
const detailPage = source("components/definition/detail-page.tsx")
const examplesCall = section(
  detailPage,
  "<DefinitionExamples",
  "/>\n                </Suspense>"
)
assert.match(examplesCall, /sourceRevisionId={definition\.revisionId}/)
assert.match(examplesCall, /readOnly={!definition\.isCurrentRevision}/)
assert.doesNotMatch(examplesCall, /currentRevisionId/)

const examples = source("components/definition/examples.tsx")
assert.match(examples, /!readOnly && canFeature/)
assert.match(examples, /!readOnly \? \(/)
assert.match(examples, /current revision/)
assert.match(examples, /example\.legacyBackfill \? \(/)
assert.match(examples, /Origin and contribution date not recorded/)

// Rollback restores only definition text; examples have independent history.
const historyControls = section(detailPage, "definition.revisions.map", "</ol>")
assert.doesNotMatch(historyControls, /revision\.exampleDiff/)
assert.match(historyControls, /revision\.restorable/)
const restoreDialog = source(
  "components/definition/restore-revision-button.tsx"
)
assert.match(restoreDialog, /copies only this\s+definition text/)
assert.match(
  restoreDialog,
  /Examples are separate contributions and remain\s+unchanged/
)

// Discard is server-confirmed: a failed request leaves the draft and its ID in
// place, so the same control can retry it.
const definitionForm = source("components/definition/definition-form.tsx")
const clearAiDraft = section(
  definitionForm,
  "const clearAiDraft =",
  "const busy ="
)
assert.doesNotMatch(clearAiDraft, /setAiDraft\(null\)/)
assert.match(
  definitionForm,
  /discardAiDraft[\s\S]*onSuccess:[\s\S]*setAiDraft\(null\)/
)
assert.match(definitionForm, /suggestAiDraft\.error \|\| discardAiDraft\.error/)
assert.match(definitionForm, /activity\.start\(\)[\s\S]*discardAiDraft\.mutate/)
assert.match(definitionForm, /onSettled: activity\.end/)
assert.match(definitionForm, /name="initialExample"/)
assert.match(definitionForm, /separate[\s\S]*contribution credited to you/)

const revisionForm = source(
  "components/definition/revision-suggestion-form.tsx"
)
assert.doesNotMatch(revisionForm, /initialExample/)
const clearRevisionDraft = section(
  revisionForm,
  "const clearDraft =",
  "return ("
)
assert.doesNotMatch(clearRevisionDraft, /setDraft\(null\)/)
assert.match(revisionForm, /discard[\s\S]*onSuccess: \(\) => setDraft\(null\)/)
assert.match(revisionForm, /activity\.start\(\)[\s\S]*discard\.mutate/)
assert.match(revisionForm, /onSettled: activity\.end/)

// Shell navigation stays disabled for the full child mutation lifecycle.
const contributionActions = source(
  "components/definition/contribution-actions.tsx"
)
assert.match(contributionActions, /onBusyChange={setChildBusy}/)
assert.match(contributionActions, /disabled={childBusy}/)

const walkthrough = source("components/studies/walkthrough.tsx")
assert.match(walkthrough, /const interaction = useMutationActivity\(\)/)
assert.match(
  walkthrough,
  /const navigationLocked = complete\.isPending \|\| interaction\.busy/
)
assert.match(walkthrough, /disabled={!open \|\| navigationLocked}/)
const candidates = section(
  walkthrough,
  "const Candidates =",
  "const Position ="
)
assert.match(candidates, /trpc\.surveys\.acceptPosition\.useMutation/)
assert.doesNotMatch(candidates, /trpc\.votes\.vote/)
assert.match(candidates, /voteDisplay="summary"/)
assert.match(candidates, /activity\.start\(\)[\s\S]*accept\.mutate/)
assert.match(candidates, /onSettled: activity\.end/)
const votes = source("components/term/votes.tsx")
const supportSummary = section(
  votes,
  "export const TermVoteSummary",
  "export const TermVotes"
)
assert.match(supportSummary, /Support/)
assert.match(supportSummary, /Your upvote/)
assert.match(supportSummary, /Your downvote/)
assert.doesNotMatch(supportSummary, /<Button/)
assert.match(
  section(walkthrough, "const ReviewList =", "const Review ="),
  /voteDisabled={pending}[\s\S]*disabled={pending}[\s\S]*onMutationStart={onMutationStart}[\s\S]*onMutationEnd={onMutationEnd}/
)
const commentBox = source("components/term/comment-box.tsx")
assert.match(commentBox, /const postingDisabled = disabled \|\| isPending/)
assert.match(commentBox, /<Textarea[\s\S]*disabled={postingDisabled}/)
const question = section(walkthrough, "const Question =", "const Finished =")
assert.match(question, /activity\.start\(\)[\s\S]*answer\.mutate/)
assert.match(question, /onSettled: activity\.end/)

console.log("Definition UI safety checks passed.")
