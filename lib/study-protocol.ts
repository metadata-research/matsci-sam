import type { Step } from "./surveys"

// Keep published step IDs and previous contributions. ID4 omits the repeat
// Review round while retaining the original Position actions. Other studies
// keep their own sequence and action rules.
export const ID4_ROUND_TWO = "id4_round_two"
export const isSinglePassStudy = (slug: string) => slug === ID4_ROUND_TWO
export const allowsStudySelfEnrollment = (slug: string) =>
  slug === ID4_ROUND_TWO

export const ID4_INSTRUCTIONS = `This study continues vocabulary work begun in a 2025 MatSci-YAMZ study. You will work through eight materials science terms, then give feedback.

1. For each term, read the definitions and choose the one closest to what you consider correct. Accept it as written, or use Revise this definition to request, review and publish a suggested revision.
2. If none is close enough, use Propose a new definition to write your own. If you do not know the term well enough to choose, select Skip this term.
3. You can post public comments on definitions during the Position step. Post any comments before accepting or publishing, which completes that term. Accepting ensures an upvote; publishing a revision or new definition records your position without casting a vote.
4. After the eight terms, answer the closing questions to finish.

Your saved positions and skips count toward progress when you return. Study help is available at every step.`

export const isActiveStudyStep = (
  slug: string,
  step: Pick<Step, "kind" | "responseKind">
) => !isSinglePassStudy(slug) || step.kind !== "review"

export const studyInstructions = (slug: string, stored: string | null) =>
  isSinglePassStudy(slug) ? ID4_INSTRUCTIONS : stored

export const activeStudySteps = <T extends Step>(
  slug: string,
  steps: T[]
): T[] =>
  !isSinglePassStudy(slug)
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

export const studyStepLabel = (kind: Step["kind"]) =>
  kind === "define"
    ? "Position"
    : kind === "review"
      ? "Review"
      : kind === "question"
        ? "Question"
        : "Instructions"
