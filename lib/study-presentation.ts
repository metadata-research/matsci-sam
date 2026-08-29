/*
 * Copy decisions shared by the public study page, the walkthrough and their
 * pure tests. Keeping these here makes the claims about support, windows and
 * scale endpoints one rule rather than similar strings in several components.
 */

export const DEFAULT_LIKELIHOOD_QUESTION =
  "How likely are you to use this list in your work?"

export const DEFAULT_CHANGE_QUESTION =
  "What would you add or change in this list?"

const LIKELIHOOD_SCALE_LABELS = {
  minimum: "Not likely",
  maximum: "Very likely"
} as const

const GENERIC_SCALE_LABELS = {
  minimum: "Lowest",
  maximum: "Highest"
} as const

// Only the canonical likelihood question has likelihood endpoints. A steward
// may add any scale question, for which generic endpoints remain the honest
// labels without adding endpoint columns to the stored step.
export const scaleLabelsForPrompt = (prompt: string | null) =>
  prompt === DEFAULT_LIKELIHOOD_QUESTION
    ? LIKELIHOOD_SCALE_LABELS
    : GENERIC_SCALE_LABELS

export const studyWindowExplanation = (steps: number) =>
  (steps > 0
    ? "Community members can take part only while the study is open. "
    : "These dates record the study period. ") +
  "A valid study invitation can be accepted while the study is open or before " +
  "a future opening date, but not once the study has closed or been retired."

export const positionAcceptanceExplanation = (
  vote: "up" | "down" | null | undefined
) =>
  vote === "up"
    ? "You already upvoted this candidate. Accept will use that vote as your position."
    : vote === "down"
      ? "You previously downvoted this candidate. Accept will change it to an upvote."
      : "Accepting records the candidate as your position and adds your upvote."
