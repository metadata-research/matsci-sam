import type { Act, Step } from "./surveys"

// A published amendment to the existing ID4 activity. Keep the stored step
// IDs, prompts and contributions intact; only the active participant sequence
// changes. Other studies retain their original protocol. This explicit scope
// avoids turning the ID4 amendment into a new default for future studies.
export const ID4_ROUND_TWO = "id4_round_two"
export const isVotingStudy = (slug: string) => slug === ID4_ROUND_TWO

export const ID4_VOTING_INSTRUCTIONS = `This study continues vocabulary work begun in a 2025 MatSci-YAMZ study. You will vote on eight materials science terms, then give written feedback.

1. For each term, read the definitions and vote for the one closest to what you consider correct. Choose any definition, regardless of its support score.
2. Select Vote for this definition to save your choice and continue. This ensures an upvote on that revision. An existing upvote is kept without adding another point; a downvote changes to an upvote.
3. If you cannot choose a definition, select Skip this term. You can explain missing or unsuitable definitions in your closing feedback.
4. After the eight terms, answer the written feedback question and submit it to finish.

Your saved choices and skips count toward progress when you return. Study help is available at every step.`

export const isActiveStudyStep = (
  slug: string,
  step: Pick<Step, "kind" | "responseKind">
) =>
  !isVotingStudy(slug) ||
  (step.kind !== "review" &&
    (step.kind !== "question" || step.responseKind === "text"))

export const studyInstructions = (slug: string, stored: string | null) =>
  isVotingStudy(slug) ? ID4_VOTING_INSTRUCTIONS : stored

export const activeStudySteps = <T extends Step>(
  slug: string,
  steps: T[]
): T[] =>
  !isVotingStudy(slug)
    ? steps
    : steps
        .filter((step) => isActiveStudyStep(slug, step))
        .map((step, index) => ({
          ...step,
          position: index + 1,
          prompt:
            step.kind === "instructions"
              ? studyInstructions(slug, step.prompt)
              : step.prompt
        }))

export const studyAllowsAct = (slug: string, act: Act) =>
  !isVotingStudy(slug) || act.kind === "vote"

export const studyStepLabel = (kind: Step["kind"], votingOnly = false) =>
  kind === "define"
    ? votingOnly
      ? "Vote"
      : "Position"
    : kind === "review"
      ? "Review"
      : kind === "question"
        ? votingOnly
          ? "Feedback"
          : "Question"
        : "Instructions"
