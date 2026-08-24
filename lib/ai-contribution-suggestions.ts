import { and, eq, inArray, sql } from "drizzle-orm"

import { aiContributionSuggestionsTable, db } from "@yamz/db"

type SuggestionUpdateDatabase = Pick<typeof db, "update">

/**
 * Discard one owned preview. An already-discarded row is a successful no-op,
 * which lets the client retry safely when the first response was lost.
 */
export async function discardAiContributionSuggestion({
  suggestionId,
  requestedById,
  database = db
}: {
  suggestionId: number
  requestedById: number
  database?: SuggestionUpdateDatabase
}) {
  const [discarded] = await database
    .update(aiContributionSuggestionsTable)
    .set({
      status: "discarded",
      decidedAt: sql`coalesce(${aiContributionSuggestionsTable.decidedAt}, now())`
    })
    .where(
      and(
        eq(aiContributionSuggestionsTable.id, suggestionId),
        eq(aiContributionSuggestionsTable.requestedById, requestedById),
        inArray(aiContributionSuggestionsTable.status, [
          "generated",
          "discarded"
        ])
      )
    )
    .returning({ id: aiContributionSuggestionsTable.id })

  return discarded !== undefined
}
