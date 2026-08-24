export type FeaturedActivityKind =
  | "canonical-ai"
  | "legacy-ai"
  | "human-revision"
  | "initial"

type CanonicalSuggestion = {
  intent: "new_term" | "revise_definition"
  model: string
  createdAt: string
  decidedAt: string | null
}

type LegacyDiscussionSuggestion = {
  model: string
  createdAt: string
  acceptedAt: string | null
}

type LegacyRefinement = {
  model: string | null
  suggestedAt: string | null
  decidedAt: string | null
}

/**
 * Resolve the small homepage activity summary from exact publication links.
 * New canonical records take precedence, followed by accepted rows from the
 * two retired workflows; a derived definition without one is human-authored.
 */
export function resolveFeaturedActivity({
  canonicalSuggestion,
  legacyDiscussionSuggestion,
  legacyRefinement,
  refinedFromId,
  createdAt
}: {
  canonicalSuggestion?: CanonicalSuggestion
  legacyDiscussionSuggestion?: LegacyDiscussionSuggestion
  legacyRefinement?: LegacyRefinement
  refinedFromId: number | null
  createdAt: string
}) {
  if (canonicalSuggestion)
    return {
      activityKind: "canonical-ai" as const,
      aiIntent: canonicalSuggestion.intent,
      activityModel: canonicalSuggestion.model,
      suggestedAt: canonicalSuggestion.createdAt,
      decidedAt: canonicalSuggestion.decidedAt
    }

  if (legacyDiscussionSuggestion)
    return {
      activityKind: "legacy-ai" as const,
      aiIntent: "revise_definition" as const,
      activityModel: legacyDiscussionSuggestion.model,
      suggestedAt: legacyDiscussionSuggestion.createdAt,
      decidedAt: legacyDiscussionSuggestion.acceptedAt
    }

  if (legacyRefinement)
    return {
      activityKind: "legacy-ai" as const,
      aiIntent: "revise_definition" as const,
      activityModel: legacyRefinement.model,
      suggestedAt: legacyRefinement.suggestedAt,
      decidedAt: legacyRefinement.decidedAt
    }

  return {
    activityKind: refinedFromId
      ? ("human-revision" as const)
      : ("initial" as const),
    aiIntent: null,
    activityModel: null,
    suggestedAt: null,
    decidedAt: refinedFromId ? createdAt : null
  }
}
