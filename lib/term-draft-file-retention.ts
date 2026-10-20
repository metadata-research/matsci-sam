import { and, eq, isNull, lt, not, sql } from "drizzle-orm"
import {
  contributionFilesTable,
  db,
  termDraftFilesTable,
  termDraftsTable,
  usersTable
} from "@yamz/db"
import { CONTRIBUTION_FILE_PENDING_HOURS } from "./contribution-file-types"
import { cleanupUnreferencedSourceAssets } from "./contribution-source-assets"

/** The owning account can keep a private attachment with an active draft.
 * Keep correlated identifiers explicit: Drizzle strips interpolated column
 * qualifiers when this expression is selected from a single outer table. */
export const fileRetainedByDraft = () => sql<boolean>`(exists (
  select 1 from ${termDraftFilesTable}
  join ${termDraftsTable} on "termDrafts"."id" = "termDraftFiles"."draftId"
  where "termDraftFiles"."fileId" = "contributionFiles"."id"
    and "termDrafts"."ownerId" = "contributionFiles"."uploadedById"
    and "termDrafts"."payload" is not null
) OR exists (
  select 1 from "sourceLeases" l
  where l."fileId" = "contributionFiles"."id" and l."expiresAt" > now()
) OR exists (
  select 1 from "aiContributionSuggestions" a,
    jsonb_array_elements(coalesce(a."sourceInputs", '[]'::jsonb)) s
  where s->>'fileId' = "contributionFiles"."id"::text
    and a."requestedById" = "contributionFiles"."uploadedById"
    and (a.status = 'accepted' or (a.status = 'generated' and a."createdAt" > now() - interval '24 hours'))
))`

/** Serialize cleanup with new draft bindings, so a waiting DELETE cannot
 * remove a file retained by an autosave that just committed. */
export async function cleanupExpiredPendingFiles(
  ownerId: number,
  reader: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db
) {
  return reader.transaction(async (tx) => {
    await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, ownerId))
      .for("update")
    const removed = await tx
      .delete(contributionFilesTable)
      .where(
        and(
          eq(contributionFilesTable.uploadedById, ownerId),
          isNull(contributionFilesTable.publishedRevisionId),
          lt(
            contributionFilesTable.createdAt,
            new Date(
              Date.now() - CONTRIBUTION_FILE_PENDING_HOURS * 3600000
            ).toISOString()
          ),
          not(fileRetainedByDraft())
        )
      )
      .returning({ id: contributionFilesTable.id })
    await cleanupUnreferencedSourceAssets(tx, ownerId)
    return removed
  })
}
