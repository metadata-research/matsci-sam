// Community lifecycle of a definition, derived from votes. Original YAMZ
// classed terms as vernacular or canonical by vote; this is the same idea
// with thresholds sized for a young community. Nothing is stored: status is
// computed from the score wherever it is displayed or exported.
export type DefinitionStatus = "proposed" | "community-reviewed" | "stable"

export const STABLE_SCORE = 5
export const REVIEWED_SCORE = 2

export const definitionStatus = (score: number): DefinitionStatus =>
  score >= STABLE_SCORE
    ? "stable"
    : score >= REVIEWED_SCORE
      ? "community-reviewed"
      : "proposed"
