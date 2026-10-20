import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { eq, inArray, sql } from "drizzle-orm"
import {
  db,
  contributionFilesTable,
  contributionSubmissionsTable,
  importBatchesTable,
  sourceExtractionsTable,
  termDraftsTable,
  termsTable,
  usersTable
} from "../drizzle"
import {
  createImportDrafts,
  publishImportDrafts,
  reviewImportDrafts
} from "../lib/import-drafts"
import { updateTermDraft } from "../lib/term-drafts"
import { storeContributionFile } from "../lib/contribution-files"
import { correctOwnedSource } from "../lib/source-document-corrections"
import { deleteDefinitionRows } from "../lib/definition-purge"
import { DEFAULT_VOCABULARY_SLUG } from "../lib/public-identifiers"

const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const errorCodes = (error: unknown): string[] => {
  if (!error || typeof error !== "object") return []
  const value = error as { code?: string; cause?: unknown }
  return [...(value.code ? [value.code] : []), ...errorCodes(value.cause)]
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /_(?:test|scratch|ci|qa)(?:_|$)/)
  assert.equal(
    process.env.GRAPH_PROJECTION_ENABLED,
    "false",
    "Graph projection must be disabled for this disposable fixture"
  )
  const stamp = randomUUID()
  const term = `source lock ${stamp}`
  const [owner] = await db
    .insert(usersTable)
    .values({ name: "Import source lock fixture" })
    .returning()
  const releaseCorrection = deferred()
  let correction: Promise<unknown> | undefined
  let publication: Promise<unknown> | undefined
  try {
    const fixture = await db.transaction(async (tx) => {
      const batch = await createImportDrafts(
        tx,
        {
          id: randomUUID(),
          text: `term,definition\n${term},A concurrency fixture.`,
          format: "csv",
          vocabularySlug: DEFAULT_VOCABULARY_SLUG,
          ignoredColumns: [],
          selectedRowIds: ["record-1"]
        },
        owner.id
      )
      const draft = batch.rows[0].draft!
      const file = await storeContributionFile(
        {
          userId: owner.id,
          metadata: {
            draftId: draft.id,
            term,
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            filename: "source.txt",
            role: "source",
            title: "Concurrency fixture",
            caption: "A source used only by the local regression."
          },
          bytes: Buffer.from(term),
          declaredType: "text/plain"
        },
        tx
      )
      await tx
        .update(sourceExtractionsTable)
        .set({ status: "processing", startedAt: sql`now()` })
        .where(eq(sourceExtractionsTable.id, file.sourceExtractionId!))
      await tx
        .update(sourceExtractionsTable)
        .set({
          status: "ready",
          text: term,
          textHash: hash(term),
          hasOcr: false,
          method: "text",
          parserVersion: "source-lock-fixture-v1",
          pages: [
            {
              page: null,
              start: 0,
              end: term.length,
              method: "text",
              label: "Text",
              confidence: null
            }
          ],
          completedAt: sql`now()`
        })
        .where(eq(sourceExtractionsTable.id, file.sourceExtractionId!))
      const saved = await updateTermDraft(
        tx,
        {
          id: draft.id,
          expectedVersion: draft.version,
          mutationId: randomUUID(),
          payload: {
            ...draft.payload!,
            files: [{ fileId: file.id, publish: true }]
          }
        },
        owner.id
      )
      const review = await reviewImportDrafts(
        tx,
        {
          id: batch.batch.id,
          drafts: [{ id: saved.id, expectedVersion: saved.version }]
        },
        owner.id
      )
      assert.ok(review.reviewToken, review.errors.join(" "))
      return { batchId: batch.batch.id, file, reviewToken: review.reviewToken }
    })

    const ownerLocked = deferred()
    correction = db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '8s'`)
      await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, owner.id))
        .for("update")
      ownerLocked.resolve()
      await releaseCorrection.promise
      return correctOwnedSource(
        {
          fileId: fixture.file.id,
          extractionId: fixture.file.sourceExtractionId!,
          userId: owner.id,
          text: `${term}. Corrected before publication.`
        },
        tx
      )
    })
    await ownerLocked.promise
    const publishing = deferred()
    let publisherPid = 0
    publication = db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '8s'`)
      const result = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`
      )
      publisherPid = result.rows[0].pid
      publishing.resolve()
      return publishImportDrafts(
        tx,
        { id: fixture.batchId, reviewToken: fixture.reviewToken },
        owner.id
      )
    })
    // Attach rejection handlers before either transaction can fail.
    const results = Promise.allSettled([correction, publication])
    await publishing.promise
    let blocked = false
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      const activity = await db.execute<{ wait_event_type: string | null }>(
        sql`select wait_event_type from pg_stat_activity where pid=${publisherPid}`
      )
      if (activity.rows[0]?.wait_event_type === "Lock") {
        blocked = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    releaseCorrection.resolve()
    const settled = await results
    assert.ok(blocked, "The publisher must overlap the held correction lock")
    for (const result of settled)
      if (result.status === "rejected")
        assert.ok(
          !errorCodes(result.reason).includes("40P01"),
          "Correction and publication must not deadlock"
        )
    assert.equal(settled[0].status, "fulfilled", "Correction finishes first")
    assert.equal(settled[1].status, "rejected")
    if (settled[1].status === "rejected")
      assert.ok(
        errorCodes(settled[1].reason).includes("CONFLICT"),
        "A changed transcript invalidates the previous publication review"
      )
    const [current] = await db
      .select()
      .from(contributionFilesTable)
      .where(eq(contributionFilesTable.id, fixture.file.id))
    assert.equal(current.publishedRevisionId, null)
    assert.notEqual(current.sourceExtractionId, fixture.file.sourceExtractionId)
    console.log(
      "Import source concurrency passed: correction completes, publication waits without deadlock, and the changed transcript requires a new review."
    )
  } finally {
    releaseCorrection.resolve()
    await Promise.allSettled(
      [correction, publication].filter((value): value is Promise<unknown> =>
        Boolean(value)
      )
    )
    await db.transaction(async (tx) => {
      const created = await tx.query.termsTable.findMany({
        where: eq(termsTable.term, term),
        with: { definitions: true }
      })
      for (const entry of created)
        for (const definition of entry.definitions)
          await deleteDefinitionRows(tx, definition.id)
      if (created.length)
        await tx.delete(termsTable).where(
          inArray(
            termsTable.id,
            created.map((entry) => entry.id)
          )
        )
      await tx
        .delete(importBatchesTable)
        .where(eq(importBatchesTable.ownerId, owner.id))
      await tx
        .delete(termDraftsTable)
        .where(eq(termDraftsTable.ownerId, owner.id))
      await tx
        .delete(contributionFilesTable)
        .where(eq(contributionFilesTable.uploadedById, owner.id))
      await tx
        .delete(contributionSubmissionsTable)
        .where(eq(contributionSubmissionsTable.userId, owner.id))
      await tx.delete(usersTable).where(eq(usersTable.id, owner.id))
    })
  }
}
main()
  .then(() => db.$client.end())
  .catch(async (error) => {
    console.error(error)
    await db.$client.end()
    process.exitCode = 1
  })
