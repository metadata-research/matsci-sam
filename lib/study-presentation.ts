/*
 * Copy decisions shared by the public study page, the walkthrough and their
 * pure tests. Keeping these here makes the claims about support, windows and
 * scale endpoints one rule rather than similar strings in several components.
 */

export type StudyPresentationState = "draft" | "open" | "closed" | "retired"

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

export const studyWelcomeHeading = (
  state: StudyPresentationState,
  steps: number
) => (state === "closed" && steps === 0 ? "About this study" : "What to do")

export const studyWindowExplanation = (steps: number) =>
  (steps > 0
    ? "Community members can take part only while the study is open. "
    : "These dates record the study period. ") +
  "A valid study invitation can be accepted while the study is open or before " +
  "a future opening date, but not once the study has closed or been retired."

export const MOST_SUPPORTED_DEFINITIONS_HEADING = "Most supported definitions"

export const studySupportDescription = (closedOn: string | null) =>
  closedOn
    ? "For each term, the candidate with the greatest site-wide net support is " +
      `shown. Support counts use vote events recorded at or before the study ` +
      `closed on ${closedOn}. The candidates, their text, and the collection's ` +
      "terms remain current. Votes are not limited to this study or community. " +
      "A tie goes to the earlier candidate."
    : "For each term, the candidate with the greatest site-wide net support is " +
      "shown. Support is current-revision upvotes minus downvotes from all " +
      "accounts, not only this study or community. A tie goes to the earlier " +
      "candidate."
