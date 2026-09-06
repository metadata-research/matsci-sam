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

const studyDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "long",
  day: "numeric",
  year: "numeric"
})

// Study deadlines use the Eastern calendar date agreed for participation,
// which can be the day before the stored UTC date.
export const studyClosingNote = (steps: number, closesAt: string | null) =>
  closesAt
    ? `${steps > 0 ? "Responses close" : "The study period ends"} on ${studyDateFormatter.format(new Date(closesAt))} (Eastern time).`
    : null

export const positionAcceptanceExplanation = (
  vote: "up" | "down" | null | undefined
) =>
  vote === "up"
    ? "You already upvoted this definition. Accept will use that vote as your position."
    : vote === "down"
      ? "You previously downvoted this definition. Accept will change it to an upvote."
      : "Accepting records this definition as your position and adds your upvote."
