import "dotenv/config"
import { isNull } from "drizzle-orm"
import { cleanupExpiredPendingFiles } from "../lib/term-draft-file-retention"
import { db, contributionFilesTable } from "../drizzle"

async function main() {
  const owners = await db
    .selectDistinct({ id: contributionFilesTable.uploadedById })
    .from(contributionFilesTable)
    .where(isNull(contributionFilesTable.publishedRevisionId))
  let removed = 0
  for (const owner of owners)
    removed += (await cleanupExpiredPendingFiles(owner.id)).length
  console.log(
    `Removed ${removed} expired pending contribution files. Published files and saved-draft attachments were not changed.`
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
