import "dotenv/config"
import pg from "pg"
import { and, asc, eq } from "drizzle-orm"
import { db, sourceExtractionsTable, contributionFilesTable } from "../drizzle"
import {
  extractSourceDocument,
  SourceDocumentError
} from "../lib/source-document-extraction"

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
        const [file] = await db
          .select({
            bytes: contributionFilesTable.bytes,
            mediaType: contributionFilesTable.mediaType
          })
          .from(contributionFilesTable)
          .where(eq(contributionFilesTable.id, job.fileId))
        if (file) {
          try {
            const result = await extractSourceDocument({
              ...file,
              forceOcr: job.forceOcr
            })
            await db
              .update(sourceExtractionsTable)
              .set({
                ...result,
                status: "ready",
                completedAt: new Date().toISOString()
              })
              .where(
                and(
                  eq(sourceExtractionsTable.id, job.id),
                  eq(sourceExtractionsTable.status, "processing")
                )
              )
            console.log(
              JSON.stringify({
                event: "source_ready",
                extractionId: job.id,
                pages: result.pages.length,
                ocr: result.hasOcr
              })
            )
          } catch (error) {
            await db
              .update(sourceExtractionsTable)
              .set({
                status: "failed",
                completedAt: new Date().toISOString(),
                error:
                  error instanceof SourceDocumentError
                    ? error.message
                    : "This document could not be read. Try a readable PDF, DOCX or plain text."
              })
              .where(
                and(
                  eq(sourceExtractionsTable.id, job.id),
                  eq(sourceExtractionsTable.status, "processing")
                )
              )
            console.warn(
              JSON.stringify({
                event: "source_failed",
                extractionId: job.id,
                category:
                  error instanceof SourceDocumentError
                    ? error.code
                    : "processing"
              })
            )
          }
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
