import "dotenv/config"
import pg from "pg"
import { and, asc, eq } from "drizzle-orm"
import {
  db,
  sourceExtractionsTable,
  contributionFilesTable,
  contributionSourceAssetsTable
} from "../drizzle"
import { sourceDocumentWorkerResult } from "./source-document-worker-result"

// One session lock covers all worker invocations sharing a database, including
// overlapping deploys. OCR never executes in a Next request or per-upload worker.
async function main() {
  const lock = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await lock.connect()
  let stopping = false
  process.on("SIGTERM", () => {
    stopping = true
  })
  process.on("SIGINT", () => {
    stopping = true
  })
  try {
    const result = await lock.query(
      "SELECT pg_try_advisory_lock(hashtext('matsci:source-worker')) AS locked"
    )
    if (!result.rows[0].locked) {
      console.log("A source worker is already active.")
      return
    }
    // A predecessor no longer owns the lock, so its interrupted attempts cannot
    // finish. Preserve those attempts as failures; a retry creates a new version.
    await db
      .update(sourceExtractionsTable)
      .set({
        status: "failed",
        error: "Processing was interrupted. Retry reading this source.",
        completedAt: new Date().toISOString()
      })
      .where(eq(sourceExtractionsTable.status, "processing"))
    do {
      const job = await db.transaction(async (tx) => {
        const [next] = await tx
          .select({
            id: sourceExtractionsTable.id,
            fileId: sourceExtractionsTable.fileId,
            assetId: sourceExtractionsTable.assetId,
            forceOcr: sourceExtractionsTable.forceOcr
          })
          .from(sourceExtractionsTable)
          .where(eq(sourceExtractionsTable.status, "queued"))
          .orderBy(asc(sourceExtractionsTable.createdAt))
          .limit(1)
          .for("update", { skipLocked: true })
        if (!next) return null
        await tx
          .update(sourceExtractionsTable)
          .set({ status: "processing", startedAt: new Date().toISOString() })
          .where(eq(sourceExtractionsTable.id, next.id))
        return next
      })
      if (job) {
        const [asset] = job.assetId
          ? await db
              .select({
                bytes: contributionSourceAssetsTable.bytes,
                mediaType: contributionSourceAssetsTable.mediaType
              })
              .from(contributionSourceAssetsTable)
              .where(eq(contributionSourceAssetsTable.id, job.assetId))
          : []
        const [legacy] =
          !asset && job.fileId
            ? await db
                .select({
                  bytes: contributionFilesTable.bytes,
                  mediaType: contributionFilesTable.mediaType
                })
                .from(contributionFilesTable)
                .where(eq(contributionFilesTable.id, job.fileId))
            : []
        const outcome = await sourceDocumentWorkerResult(
          asset ?? legacy,
          job.forceOcr
        )
        const completed = await db
          .update(sourceExtractionsTable)
          .set(outcome.update)
          .where(
            and(
              eq(sourceExtractionsTable.id, job.id),
              eq(sourceExtractionsTable.status, "processing")
            )
          )
          .returning({ id: sourceExtractionsTable.id })
        // A deleted source may have removed its job while extraction ran.
        if (completed.length) {
          const log =
            outcome.update.status === "ready" ? console.log : console.warn
          log(JSON.stringify({ ...outcome.event, extractionId: job.id }))
        }
      }
      if (process.argv.includes("--once")) break
      if (!job && !stopping)
        await new Promise((resolve) => setTimeout(resolve, 2000))
    } while (!stopping)
  } finally {
    await lock.end()
    await db.$client.end()
  }
}
main().catch(() => {
  console.error(
    "Source worker failed. Check its database connection and runtime dependencies."
  )
  process.exitCode = 1
})
