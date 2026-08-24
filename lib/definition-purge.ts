import {
  coauthorsTable,
  commentsTable,
  aiContributionSuggestionsTable,
  db,
  definitionExamplesTable,
  definitionExampleSelectionsTable,
  definitionRevisionsTable,
  definitionsTable,
  discussionSuggestionsTable,
  editsTable,
  refinementsTable,
  statementsTable,
  tagsToDefinitions,
  voteEventsTable,
  votesTable
} from "@yamz/db"
import { eq, or } from "drizzle-orm"

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/*
 * Delete everything that references a single definition row, then the row.
 * This is the exceptional administrative purge (definitions.delete); nothing
 * else hard-deletes contributed content, and the act record of the
 * definition, its vote events included, goes with it. Foreign keys are all
 * ON DELETE no action, so the cascade is spelled out here inside the
 * caller's transaction.
 *
 * Plain module (no revalidatePath, no "server-only") so scripts/test-kos-db.ts
 * can call it directly.
 */
export const deleteDefinitionRows = async (
  tx: DatabaseTransaction,
  id: number
) => {
  await tx
    .delete(aiContributionSuggestionsTable)
    .where(
      or(
        eq(aiContributionSuggestionsTable.definitionId, id),
        eq(aiContributionSuggestionsTable.outputDefinitionId, id)
      )
    )

  await tx
    .delete(discussionSuggestionsTable)
    .where(
      or(
        eq(discussionSuggestionsTable.definitionId, id),
        eq(discussionSuggestionsTable.outputDefinitionId, id)
      )
    )

  await tx.delete(commentsTable).where(eq(commentsTable.definitionId, id))

  await tx.delete(votesTable).where(eq(votesTable.definitionId, id))

  // The vote events of the definition are the one part of the append-only
  // act record a purge deletes: they name revisions that are about to go.
  await tx.delete(voteEventsTable).where(eq(voteEventsTable.definitionId, id))

  await tx.delete(editsTable).where(eq(editsTable.definitionId, id))

  // legacy: dropped in 0030
  await tx
    .delete(tagsToDefinitions)
    .where(eq(tagsToDefinitions.definitionId, id))

  // Definition-level statements (topics) go with the definition. Retraction
  // is the rule everywhere else; a purge is the one hard delete.
  await tx
    .delete(statementsTable)
    .where(eq(statementsTable.subjectDefinitionId, id))

  await tx.delete(refinementsTable).where(eq(refinementsTable.definitionId, id))

  await tx.delete(coauthorsTable).where(eq(coauthorsTable.definitionId, id))

  // Feature intervals reference examples, and examples reference the exact
  // source revision, so both must go before the revision history.
  await tx
    .delete(definitionExampleSelectionsTable)
    .where(eq(definitionExampleSelectionsTable.definitionId, id))
  await tx
    .delete(definitionExamplesTable)
    .where(eq(definitionExamplesTable.definitionId, id))

  // Preserve separately voteable descendants when their source is
  // administratively purged; only the now-dangling lineage edge is removed.
  await tx
    .update(definitionsTable)
    .set({ refinedFromId: null })
    .where(eq(definitionsTable.refinedFromId, id))
  await tx
    .update(definitionsTable)
    .set({ replacesDefinitionId: null })
    .where(eq(definitionsTable.replacesDefinitionId, id))

  await tx
    .update(definitionsTable)
    .set({ currentRevisionId: null })
    .where(eq(definitionsTable.id, id))

  await tx
    .delete(definitionRevisionsTable)
    .where(eq(definitionRevisionsTable.definitionId, id))

  const [deleted] = await tx
    .delete(definitionsTable)
    .where(eq(definitionsTable.id, id))
    .returning()

  return deleted
}
