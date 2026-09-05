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
assert.match(revisionForm, /Revision draft/)
assert.doesNotMatch(revisionForm, /Proposed definition|separate candidate/)

// Shell navigation stays disabled for the full child mutation lifecycle.
const contributionActions = source(
  "components/definition/contribution-actions.tsx"
)
assert.match(contributionActions, /onBusyChange={setChildBusy}/)
assert.match(contributionActions, /disabled={childBusy}/)

const walkthrough = source("components/studies/walkthrough.tsx")
assert.match(walkthrough, /const interaction = useMutationActivity\(\)/)
assert.match(walkthrough, /You suggested this revision as your position/)
assert.match(walkthrough, /Publishing it did not cast a vote/)
assert.match(walkthrough, /Accepting it also recorded an upvote/)
assert.match(
  walkthrough,
  /const navigationLocked =[\s\S]*complete\.isPending \|\| skip\.isPending \|\| interaction\.busy/
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
assert.match(candidates, /Definitions from earlier work/)
assert.match(candidates, /Option \{index \+ 1\} of \{candidates\.length\}/)
assert.match(candidates, /showStatus={false}/)
assert.doesNotMatch(candidates, />Draft</)
assert.doesNotMatch(candidates, /Proposed so far/)
assert.match(candidates, /Accept as written/)
assert.match(candidates, /Suggest a revision/)
assert.match(candidates, /None is close enough\?/)
assert.match(candidates, /Propose a new definition/)
assert.doesNotMatch(candidates, /Propose a replacement/)
assert.doesNotMatch(candidates, /replacesDefinitionId=/)
assert.match(candidates, /activity\.start\(\)[\s\S]*accept\.mutate/)
assert.match(candidates, /onSettled: activity\.end/)

// Skipping is one term-level alternative in the unfinished Position choice
// state. It is not repeated on each definition and is hidden while a revision
// or new-definition form replaces that choice state.
const skipTermChoice = section(
  candidates,
  '<section aria-labelledby="skip-term-heading">',
  '<section className="space-y-5" aria-labelledby="earlier-definitions">'
)
assert.equal(
  skipTermChoice.match(/<DialogTrigger asChild>/g)?.length,
  1,
  "the Position choice state has one skip trigger"
)
assert.match(skipTermChoice, /Don’t know this term well enough to choose\?/)
assert.match(skipTermChoice, /record no opinion and move to the next term/)
assert.match(
  skipTermChoice,
  /<DialogTitle>Skip \{step\.term\}\?<\/DialogTitle>/
)
assert.match(
  skipTermChoice,
  /You won’t be asked to choose or review a definition for this[\s\S]*term\./
)
assert.match(skipTermChoice, /Go back/)
assert.match(skipTermChoice, /onClick=\{onSkip\}[\s\S]*Skip this term/)
const candidateList = section(
  candidates,
  '<section className="space-y-5" aria-labelledby="earlier-definitions">',
  "<Separator />"
)
assert.doesNotMatch(candidateList, /Skip this term|onSkip/)
assert.ok(
  candidates.indexOf('if (move.kind === "revise")') <
    candidates.indexOf('aria-labelledby="skip-term-heading"'),
  "the revision form returns before the skip choice is rendered"
)
assert.ok(
  candidates.indexOf('if (move.kind === "propose")') <
    candidates.indexOf('aria-labelledby="skip-term-heading"'),
  "the new-definition form returns before the skip choice is rendered"
)

const position = section(walkthrough, "const Position =", "const ReviewList =")
assert.match(
  position,
  /const settled = step\.completed \|\| step\.held !== null/
)

const completedSummary = source(
  "components/studies/completed-study-summary.tsx"
)
assert.match(completedSummary, /Suggested a revision recorded as/)
assert.match(
  position,
  /settled \? \([\s\S]*<HeldPosition step=\{step\} \/>[\s\S]*\) : \([\s\S]*<Candidates[\s\S]*onSkip=\{onSkip\}/
)

const dots = section(walkthrough, "const Dots =", "const Instructions =")
assert.match(
  dots,
  /step\.completionOutcome === "skipped"[\s\S]*\? "skipped"[\s\S]*aria-label=\{label\}/
)
assert.match(dots, /<span aria-hidden="true">−<\/span>/)
assert.match(
  walkthrough,
  /A skipped term marks both its Position and Review steps\./
)
assert.match(
  walkthrough,
  /const reachable = \(at: number\) =>[\s\S]*mayOpenStudyStep\(steps, walkthrough\.resumePosition, at\)/
)
assert.doesNotMatch(walkthrough, /steps\[at - 2\]\.completed/)
assert.match(
  walkthrough,
  /show\(nextStudyPosition\(steps, walkthrough\.resumePosition, step\.position\)\)/
)

const skipMutation = section(
  walkthrough,
  "const skip = trpc.surveys.skipTerm.useMutation",
  "// A completed step"
)
assert.match(
  skipMutation,
  /onSuccess: \(\{ nextPosition \}\) => advance\(nextPosition\)/
)
assert.match(skipMutation, /onSettled: interaction\.end/)
assert.match(
  walkthrough,
  /const navigationLocked =[\s\S]*complete\.isPending \|\| skip\.isPending \|\| interaction\.busy/
)
assert.match(
  walkthrough,
  /onSkip=\{\(\) => \{[\s\S]*interaction\.start\(\)[\s\S]*skip\.mutate\(\{ stepId: step\.id, expectedInstructions \}\)/
)

const heldPosition = section(walkthrough, "const HeldPosition =", "type Move =")
assert.match(heldPosition, /step\.completionOutcome === "skipped"/)
assert.match(heldPosition, /Skipped this term\. No position was recorded\./)

const review = section(walkthrough, "const Review =", "const SCALE =")
assert.match(review, /step\.completionOutcome === "skipped"/)
assert.match(
  review,
  /Skipped with this term\. No vote or comment was recorded\./
)
assert.doesNotMatch(review, /Skip this term|onSkip|skipTerm/)

const completedStudySummary = source(
  "components/studies/completed-study-summary.tsx"
)
assert.match(
  completedStudySummary,
  /completionOutcome === "skipped"[\s\S]*Skipped this term\. No position was recorded\./
)
assert.match(
  completedStudySummary,
  /completionOutcome === "skipped"[\s\S]*Skipped with this term\. No vote or comment was recorded\./
)
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
