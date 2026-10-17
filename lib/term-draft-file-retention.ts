import { and, eq, isNull, lt, not, sql } from "drizzle-orm"
import {
  contributionFilesTable,
  db,
  termDraftFilesTable,
  termDraftsTable,
  usersTable
} from "@yamz/db"
import { CONTRIBUTION_FILE_PENDING_HOURS } from "./contribution-file-types"

/** The owning account can keep a private attachment with an active draft.
 * Keep correlated identifiers explicit: Drizzle strips interpolated column
 * qualifiers when this expression is selected from a single outer table. */
export const fileRetainedByDraft = () => sql<boolean>`exists (
  select 1 from ${termDraftFilesTable}
  join ${termDraftsTable} on "termDrafts"."id" = "termDraftFiles"."draftId"
  where "termDraftFiles"."fileId" = "contributionFiles"."id"
    and "termDrafts"."ownerId" = "contributionFiles"."uploadedById"
    and "termDrafts"."payload" is not null
)`

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
    return tx
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
  })
}
