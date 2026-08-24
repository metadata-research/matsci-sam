import "server-only"

import {
  aiContributionSuggestionsTable,
  db,
  discussionSuggestionsTable,
  usersTable
} from "@yamz/db"
import { and, asc, eq, getTableColumns, inArray, isNotNull } from "drizzle-orm"

/**
 * Accepted canonical AI suggestions are linked to their publication by the
 * output definition foreign key. Callers must not infer that relationship
 * from a source definition or from the newest legacy refinement round.
 */
export async function acceptedAiSuggestionsForOutputs(
  outputDefinitionIds: number[]
) {
  if (outputDefinitionIds.length === 0) return []

  return db
    .select({
      ...getTableColumns(aiContributionSuggestionsTable),
      requester: {
        id: usersTable.id,
        name: usersTable.name,
        isAi: usersTable.isAi,
        isProfilePublic: usersTable.isProfilePublic
      }
    })
    .from(aiContributionSuggestionsTable)
    .innerJoin(
      usersTable,
      eq(aiContributionSuggestionsTable.requestedById, usersTable.id)
    )
    .where(
      and(
        eq(aiContributionSuggestionsTable.status, "accepted"),
        isNotNull(aiContributionSuggestionsTable.outputDefinitionId),
        inArray(
          aiContributionSuggestionsTable.outputDefinitionId,
          outputDefinitionIds
        )
      )
    )
    .orderBy(
      asc(aiContributionSuggestionsTable.createdAt),
      asc(aiContributionSuggestionsTable.id)
    )
}

/**
 * Historical discussion suggestions used a separate persisted preview table.
 * The route is retired, but its accepted rows remain exact provenance because
 * outputDefinitionId uniquely identifies the definition they produced.
 */
export async function acceptedLegacyDiscussionSuggestionsForOutputs(
  outputDefinitionIds: number[]
) {
  if (outputDefinitionIds.length === 0) return []

  return db
    .select({
      ...getTableColumns(discussionSuggestionsTable),
      requester: {
        id: usersTable.id,
        name: usersTable.name,
        isAi: usersTable.isAi,
        isProfilePublic: usersTable.isProfilePublic
      }
    })
    .from(discussionSuggestionsTable)
    .innerJoin(usersTable, eq(discussionSuggestionsTable.userId, usersTable.id))
    .where(
      and(
        isNotNull(discussionSuggestionsTable.acceptedAt),
        isNotNull(discussionSuggestionsTable.outputDefinitionId),
        inArray(
          discussionSuggestionsTable.outputDefinitionId,
          outputDefinitionIds
        )
      )
    )
    .orderBy(
      asc(discussionSuggestionsTable.createdAt),
      asc(discussionSuggestionsTable.id)
    )
}
