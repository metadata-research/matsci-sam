import "dotenv/config"
import { and, isNull, lt } from "drizzle-orm"
import { db, contributionFilesTable } from "../drizzle"
import { CONTRIBUTION_FILE_PENDING_HOURS } from "../lib/contribution-file-types"

async function main() {
  const removed = await db
    .delete(contributionFilesTable)
    .where(
      and(
        isNull(contributionFilesTable.publishedRevisionId),
        lt(
          contributionFilesTable.createdAt,
          new Date(
            Date.now() - CONTRIBUTION_FILE_PENDING_HOURS * 3600000
          ).toISOString()
        )
      )
    )
    .returning({ id: contributionFilesTable.id })
  console.log(
    `Removed ${removed.length} expired pending contribution files. Published files were not changed.`
  )
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
