import { surveyStepCompletionsTable, type db } from "@yamz/db"
import type { StudyState } from "@/lib/communities"

/*
 * The rules of the survey walkthrough. Pure functions, so the router, the
 * pages, the pilot driver and the tests answer each question the same way,
 * plus the one database write every path shares: recording that a person
 * completed a step.
 *
 * A walkthrough is the ordered steps of a study: instructions, one define
 * step per term, one review step per term, then the questions. Progress is
 * the set of completions and nothing else. Resumption is the lowest position
 * without one, and a gate is a rule over the acts a step asked for, so there
 * is no status column to drift from the record.
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
// own. Plain sentences, rendered as the study welcome is.
export const DEFAULT_INSTRUCTIONS =
  "This walkthrough asks you to define each term of the study in your own words, then to read the definitions others wrote for each term, comment on them and vote. A step is saved when you press the button at its end. You can leave at any point and come back to the step you stopped at."

// The two closing questions: a confidence scale on the definitions the
// participant wrote, and an open question on the process. Added after the
// review steps, and left out when the steward unchecks them.
export const DEFAULT_QUESTIONS: Question[] = [
  {
    prompt:
      "How confident are you in the definitions you wrote? Answer from 1, not at all confident, to 5, fully confident.",
    responseKind: "scale"
  },
  {
    prompt: "What would you change about how this study asked you to work?",
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
      prompt: `Define ${term.term} in your own words, with an example of how it is used.`,
      responseKind: null
    })),
    ...input.terms.map((term) => ({
      kind: "review" as const,
      termId: term.id,
      prompt: `Read the definitions of ${term.term}. Comment where you disagree or can add something, and vote on each.`,
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
 * Instructions and review complete on the press. A define step requires the
 * participant's own definition of the term to exist, and a question requires
 * its answer, which answerQuestion writes together with the completion.
 */
export const stepGate = (
  step: Step,
  facts: { hasOriginalDefinition: boolean; hasResponse: boolean }
): { ok: true } | { ok: false; reason: string } => {
  switch (step.kind) {
    case "define":
      return facts.hasOriginalDefinition
        ? { ok: true }
        : { ok: false, reason: "Publish your definition of this term first" }
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
 * Whether an act may name a step as its context. A comment and a vote are
 * review acts on the term of a review step; a definition is the act of a
 * define step on its term. Anything else is a step for some other act, and
 * the context is refused rather than recorded wrong.
 */
export const actMatchesStep = (
  act: { kind: "comment" | "vote" | "define"; termId: number },
  step: Step
): boolean => {
  const wanted: StepKind = act.kind === "define" ? "define" : "review"
  return step.kind === wanted && step.termId === act.termId
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
