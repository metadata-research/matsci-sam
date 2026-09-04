import { surveyStepCompletionsTable, type db } from "@yamz/db"
import type { StudyState } from "@/lib/communities"
import {
  DEFAULT_CHANGE_QUESTION,
  DEFAULT_LIKELIHOOD_QUESTION
} from "@/lib/study-presentation"

/*
 * The rules of the survey walkthrough. Pure functions, so the router, the
 * pages, the pilot driver and the tests answer each question the same way,
 * plus the one database write every path shares: recording that a person
 * completed a step.
 *
 * A walkthrough is the ordered steps of a study: instructions, one define
 * step per term, one review step per term, then the questions. A define
 * step is a position step: the participant accepts one of the definitions of
 * the term with an upvote, suggests a revision to one, or proposes a new
 * source-free definition when none is close enough, or explicitly skips the
 * term with no opinion. The kind stays "define" in the schema; the shell
 * labels it "Position". Progress is the set of completions and their outcome.
 * Resumption is the lowest position without one, and a gate is a rule over
 * the acts a step asked for, so there is no status column to drift from the
 * record.
 */

export type StepKind = "instructions" | "define" | "review" | "question"
export type ResponseKind = "text" | "scale"
export type CompletionOutcome = "completed" | "skipped"

export type Step = {
  id: number
  position: number
  kind: StepKind
  termId: number | null
  prompt: string | null
  responseKind: ResponseKind | null
}

export type Question = { prompt: string; responseKind: ResponseKind }

// What a participant reads first when the study has no welcome text of its
// own: the purpose of the protocol. Plain sentences, rendered as the study
// welcome is.
export const DEFAULT_INSTRUCTIONS =
  "This study is a second round on a terminology list. Each term may have " +
  "definitions, examples, and comments from earlier work.\n\n" +
  "Outside a study, MatSci-SAM uses five vocabulary contribution actions: New term, Suggest a revision, " +
  "Propose a replacement, Comment, and Add example. In this study, the whole-term alternative is " +
  "Propose a new definition. Language-model assistance, " +
  "when offered, is an optional drafting aid inside New term or Suggest a " +
  "revision; it does not publish automatically. A comment stays a comment, and an example stays " +
  "separate from the definition.\n\nFor each term in this study, take a " +
  "position by reviewing the definitions from earlier work. Choose the one closest to the definition " +
  "you would use, then accept it as written or use Suggest a revision to say " +
  "what is wrong or missing. If none is close enough, use Propose a new " +
  "definition. If you do not know a term well enough to choose, skip it. " +
  "Then compare the definitions, vote on each, and use " +
  "Comment where you disagree or can add information. Any closing questions " +
  "come last.\n\nMatSci-SAM records the upvote used to accept a definition, " +
  "revision and new-definition proposals, review votes, comments, and question " +
  "responses. Completed steps are saved between visits, and the study " +
  "activity returns to the first incomplete step."

/*
 * Earlier wordings of the default text. A study created with no welcome text
 * persists the default of its day as the step-1 prompt, so a rewording above
 * must not make an untouched study read as drifted or edited: comparisons go
 * through isDefaultInstructions, and a legacy prompt is left in place — it is
 * the text its participants were shown and locked against.
 */
const LEGACY_DEFAULT_INSTRUCTIONS = [
  "This study is a second round on a terminology list. Each term may have " +
    "definitions, examples, and comments from earlier work.\n\n" +
    "Outside a study, MatSci-SAM uses five vocabulary contribution actions: New term, Suggest a revision, " +
    "Propose a replacement, Comment, and Add example. In this study, the whole-term alternative is " +
    "Propose a new definition. Language-model assistance, " +
    "when offered, is an optional drafting aid inside New term or Suggest a " +
    "revision; it does not publish automatically. A comment stays a comment, and an example stays " +
    "separate from the definition.\n\nFor each term in this study, take a " +
    "position by reviewing the definitions from earlier work. Choose the one closest to the definition " +
    "you would use, then accept it as written or use Suggest a revision to say " +
    "what is wrong or missing. If none is close enough, use Propose a new " +
    "definition. Then compare the definitions, vote on each, and use " +
    "Comment where you disagree or can add information. Any closing questions " +
    "come last.\n\nMatSci-SAM records the upvote used to accept a definition, " +
    "revision and new-definition proposals, review votes, comments, and question " +
    "responses. Completed steps are saved between visits, and the study " +
    "activity returns to the first incomplete step.",
  "This study is a second round on a terminology list. Each term may have " +
    "candidate definitions, examples, and comments from earlier work.\n\n" +
    "MatSci-SAM uses five contribution actions: New term, Suggest a revision, " +
    "Propose a replacement, Comment, and Add example. Language-model assistance, " +
    "when offered, is an optional drafting aid inside New term or Suggest a " +
    "revision; it does not publish automatically. A comment stays a comment, and an example stays " +
    "separate from the definition.\n\nFor each term in this study, take a " +
    "position by accepting a candidate as written, using Suggest a revision to " +
    "say what is wrong or missing, or using Propose a replacement to offer a " +
    "different candidate. Then compare the candidates, vote on each, and use " +
    "Comment where you disagree or can add information. Any closing questions " +
    "come last.\n\nMatSci-SAM records the upvote used to accept a candidate, " +
    "revision and replacement proposals, review votes, comments, and question " +
    "responses. Completed steps are saved between visits, and the study " +
    "activity returns to the first incomplete step.",
  "This study is a second round on a terminology list. Each term may have " +
    "candidate definitions, examples, and comments from earlier work.\n\n" +
    "MatSci-SAM uses five contribution actions: New term, Suggest a revision, " +
    "Propose a replacement, Comment, and Add example. Language-model assistance, " +
    "when offered, is an optional drafting aid inside New term or Suggest a " +
    "revision; it does not publish automatically. A comment stays a comment, and an example stays " +
    "separate from the definition.\n\nFor each term in this study, take a " +
    "position by accepting a candidate as written, using Suggest a revision to " +
    "say what is wrong or missing, or using Propose a replacement to offer a " +
    "different candidate. Then compare the candidates, vote on each, and use " +
    "Comment where you disagree or can add information. Any closing questions " +
    "come last.\n\nMatSci-SAM records the upvote used to accept a candidate, " +
    "revision and replacement proposals, review votes, comments, and question " +
    "responses. Completed steps are saved between visits, and the walkthrough " +
    "returns to the first incomplete step."
]

export const isDefaultInstructions = (prompt: string | null | undefined) =>
  prompt === DEFAULT_INSTRUCTIONS ||
  LEGACY_DEFAULT_INSTRUCTIONS.includes(prompt ?? "")

// The two default closing questions: likelihood of use and what the participant
// would change. Added after the review steps, and left out when the steward
// unchecks them.
export const DEFAULT_QUESTIONS: Question[] = [
  {
    prompt: DEFAULT_LIKELIHOOD_QUESTION,
    responseKind: "scale"
  },
  {
    prompt: DEFAULT_CHANGE_QUESTION,
    responseKind: "text"
  }
]

const nonblank = (text: string | null) =>
  text !== null && text.trim() !== "" ? text : null

/*
 * The plan of a walkthrough from the collection of a study: instructions,
 * one define step per term, one review step per term, then the questions.
 * Terms arrive in label order, as collectionMembers returns them, and keep
 * it, so the define steps and the review steps read in the same order.
 */
export const planSteps = (input: {
  welcome: string | null
  terms: { id: number; term: string }[]
  questions: Question[]
}): Omit<Step, "id">[] => {
  const steps: Omit<Step, "id" | "position">[] = [
    {
      kind: "instructions",
      termId: null,
      prompt: nonblank(input.welcome) ?? DEFAULT_INSTRUCTIONS,
      responseKind: null
    },
    ...input.terms.map((term) => ({
      kind: "define" as const,
      termId: term.id,
      prompt: `Choose the definition of ${term.term} closest to what you think is right. Accept it as written, suggest a revision, or propose a new definition if none is close enough. If you do not know the term well enough to choose, skip it.`,
      responseKind: null
    })),
    ...input.terms.map((term) => ({
      kind: "review" as const,
      termId: term.id,
      prompt: `Compare the definitions of ${term.term}. Vote on each, and comment where you disagree or can add something.`,
      responseKind: null
    })),
    ...input.questions.map((question) => ({
      kind: "question" as const,
      termId: null,
      prompt: question.prompt,
      responseKind: question.responseKind
    }))
  ]
  return steps.map((step, index) => ({ position: index + 1, ...step }))
}

// The lowest position without a completion, or null when every step is
// done. A walkthrough with no steps has nothing to resume.
export const resumePosition = (
  steps: Step[],
  completedStepIds: Set<number>
): number | null => {
  const pending = steps.filter((step) => !completedStepIds.has(step.id))
  if (pending.length === 0) return null
  return Math.min(...pending.map((step) => step.position))
}

/*
 * Whether a step may be pressed through, given the facts the caller loaded.
 * Instructions and review complete on the press. A define step requires a
 * position on its term, which is exactly one of: an upvote event by the
 * participant naming the step, an initial revision of theirs naming the
 * step, or a standing upvote of theirs on the current revision of a
 * definition of the term, which satisfies the gate without being an act of
 * the step (lib/survey-queries.ts hasPosition loads the fact, gateOf the
 * whole gate). A question requires its answer, which answerQuestion writes
 * together with the completion.
 */
export const stepGate = (
  step: Step,
  facts: { hasPosition: boolean; hasResponse: boolean }
): { ok: true } | { ok: false; reason: string } => {
  switch (step.kind) {
    case "define":
      return facts.hasPosition
        ? { ok: true }
        : { ok: false, reason: "Take a position on this term first" }
    case "question":
      return facts.hasResponse
        ? { ok: true }
        : { ok: false, reason: "Answer the question first" }
    default:
      return { ok: true }
  }
}

// Steps are replaced wholesale only while nobody has started. After the
// first completion they are append-only, because a participant's position
// is a position in this list.
export const mayRegenerateSteps = (completionCount: number) =>
  completionCount === 0

/*
 * Whether an act may name a step as its context. A comment is a review act
 * on the term of a review step. A vote is a review act there too, whatever
 * its kind, and in the define step of its term the accepting act, which is
 * an upvote: a downvote or a withdrawal takes no position, so neither may
 * name a define step. A definition is the act of a define step on its term.
 * Anything else is a step for some other act, and the context is refused
 * rather than recorded wrong.
 */
const STEPS_OF_ACT: Record<Act["kind"], StepKind[]> = {
  comment: ["review"],
  vote: ["review", "define"],
  define: ["define"]
}

// A vote act carries the kind the vote stands at after it, as the event
// records it: null is a withdrawal.
export type Act =
  | { kind: "comment"; termId: number }
  | { kind: "define"; termId: number }
  | { kind: "vote"; termId: number; vote: "up" | "down" | null }

export const actMatchesStep = (act: Act, step: Step): boolean => {
  if (!STEPS_OF_ACT[act.kind].includes(step.kind)) return false
  if (step.termId !== act.termId) return false
  return act.kind !== "vote" || step.kind !== "define" || act.vote === "up"
}

// Whether a person may act in a study right now: a live membership of its
// community and an open study. A steward or an administrator who is not a
// member is not a participant.
export const mayParticipate = (
  membership: { role: string } | null,
  state: StudyState
): boolean => membership !== null && state === "open"

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/*
 * The one database write here: record that a person completed a step. It
 * takes an executor, as activeCommunityFor does, so the router, the
 * definitions path and the pilot driver can record the completion in the
 * transaction that writes the act it stands for. Recording twice is not an
 * error: the first completion stands, and null comes back.
 */
export const recordCompletion = async (
  executor: typeof db | DatabaseTransaction,
  input: {
    stepId: number
    userId: number
    outcome?: CompletionOutcome
  }
) => {
  const [row] = await executor
    .insert(surveyStepCompletionsTable)
    .values({
      stepId: input.stepId,
      userId: input.userId,
      outcome: input.outcome ?? "completed"
    })
    .onConflictDoNothing()
    .returning({
      id: surveyStepCompletionsTable.id,
      outcome: surveyStepCompletionsTable.outcome,
      completedAt: surveyStepCompletionsTable.completedAt
    })
  return row ?? null
}
