import { surveyStepCompletionsTable, type db } from "@yamz/db"
import type { StudyState } from "@/lib/communities"

/*
 * The rules of the survey walkthrough. Pure functions, so the router, the
 * pages, the pilot driver and the tests answer each question the same way,
 * plus the one database write every path shares: recording that a person
 * completed a step.
 *
 * A walkthrough is the ordered steps of a study: instructions, one define
 * step per term, one review step per term, then the questions. A define
 * step is a position step: the participant accepts one of the candidates of
 * the term with an upvote, amends one, or replaces them with a definition
 * of their own. The kind stays "define" in the schema; the shell labels it
 * "Position". Progress is the set of completions and nothing else.
 * Resumption is the lowest position without one, and a gate is a rule over
 * the acts a step asked for, so there is no status column to drift from the
 * record.
 */

export type StepKind = "instructions" | "define" | "review" | "question"
export type ResponseKind = "text" | "scale"

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
  "This study is a second round on a draft terminology list. Each term has a " +
  "draft definition and the comments the first round left on it.\n\nThe first " +
  "steps ask you to take a position on each term: accept the candidate you " +
  "would use as it stands, amend the one closest to it, or replace them with " +
  "your own. Some drafts are wrong, in wording or in kind. Amending or " +
  "replacing a draft is part of the work, and a draft nobody corrects stands. " +
  "The next steps ask you to compare the candidates of the terms where more " +
  "than one was proposed, voting on each and commenting where you disagree. " +
  "Two questions about the list close the walkthrough.\n\nThe definition with " +
  "the most support becomes the group's reference for that term. A step is " +
  "saved when you press the button at its end, and you can leave and come " +
  "back to the step you stopped at."

// The two closing questions, about the list the group has settled: whether
// the participant would use it, and what it lacks. Added after the review
// steps, and left out when the steward unchecks them.
export const DEFAULT_QUESTIONS: Question[] = [
  {
    prompt: "Would you use this list as it stands in your work?",
    responseKind: "scale"
  },
  {
    prompt: "What is missing from the list, or wrong in it?",
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
      prompt: `Accept the candidate of ${term.term} you would use as it stands, or amend the one closest to it.`,
      responseKind: null
    })),
    ...input.terms.map((term) => ({
      kind: "review" as const,
      termId: term.id,
      prompt: `Compare the candidates of ${term.term}. Vote on each, and comment where you disagree or can add something.`,
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
  input: { stepId: number; userId: number }
) => {
  const [row] = await executor
    .insert(surveyStepCompletionsTable)
    .values({ stepId: input.stepId, userId: input.userId })
    .onConflictDoNothing()
    .returning({
      id: surveyStepCompletionsTable.id,
      completedAt: surveyStepCompletionsTable.completedAt
    })
  return row ?? null
}
