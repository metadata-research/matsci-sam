import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { drizzle } from "drizzle-orm/node-postgres"
import * as schema from "../drizzle/schema"
import {
  createImportDrafts,
  getImportDrafts,
  listImportDrafts,
  reviewImportDrafts
} from "../lib/import-drafts"
import { deleteTermDraft, updateTermDraft } from "../lib/term-drafts"
import { storeContributionFile } from "../lib/contribution-files"

class Rollback extends Error {}
const queries: string[] = []
const db = drizzle(process.env.DATABASE_URL!, {
  schema,
  logger: { logQuery: (query) => queries.push(query) }
})
async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /_(?:test|scratch|ci|qa)(?:_|$)/)
  assert.equal(process.env.GRAPH_PROJECTION_ENABLED, "false")
  let listCount = 0
  let overviewCount = 0
  try {
    await db.transaction(async (tx) => {
      const [owner] = await tx
        .insert(schema.usersTable)
        .values({ name: "Import read capacity fixture" })
        .returning()
      const stamp = randomUUID().replaceAll("-", "")
      const [vocabulary] = await tx
        .insert(schema.vocabulariesTable)
        .values({
          slug: `read_${stamp}`,
          title: "Read capacity",
          createdById: owner.id
        })
        .returning()
      type Batch = Awaited<ReturnType<typeof createImportDrafts>>
      const batches: {
        batch: Batch
        drafts: NonNullable<Batch["rows"][number]["draft"]>[]
        file: Awaited<ReturnType<typeof storeContributionFile>>
      }[] = []
      for (let index = 0; index < 10; index++) {
        const batch = await createImportDrafts(
          tx,
          {
            id: randomUUID(),
            text:
              "term,definition\n" +
              Array.from(
                { length: 100 },
                (_, row) =>
                  `Import ${index} row ${row} ${stamp},Definition ${row}.`
              ).join("\n"),
            format: "csv",
            vocabularySlug: vocabulary.slug,
            ignoredColumns: [],
            selectedRowIds: Array.from(
              { length: 5 },
              (_, row) => `record-${row + 1}`
            )
          },
          owner.id
        )
        const drafts = batch.rows.flatMap((row) =>
          row.draft ? [row.draft] : []
        )
        const first = drafts[0]
        const file = await storeContributionFile(
          {
            userId: owner.id,
            metadata: {
              draftId: first.id,
              term: first.payload!.term,
              vocabularySlug: vocabulary.slug,
              filename: "source.txt",
              role: "source",
              title: `Source ${index}`,
              caption: "Private context awaiting review."
            },
            bytes: Buffer.from(`Evidence for batch ${index}`),
            declaredType: "text/plain"
          },
          tx
        )
        drafts[0] = await updateTermDraft(
          tx,
          {
            id: first.id,
            expectedVersion: first.version,
            mutationId: randomUUID(),
            payload: {
              ...first.payload!,
              files: [{ fileId: file.id, publish: false }]
            }
          },
          owner.id
        )
        const review = await reviewImportDrafts(
          tx,
          {
            id: batch.batch.id,
            drafts: drafts.map((draft) => ({
              id: draft.id,
              expectedVersion: draft.version
            }))
          },
          owner.id
        )
        assert.ok(review.canPublish, review.errors.join(" "))
        batches.push({ batch, drafts, file })
      }
      queries.length = 0
      const listed = await listImportDrafts(tx, owner.id)
      listCount = queries.length
      assert.equal(listed.length, 10)
      assert.ok(
        listed.every(
          (batch) =>
            batch.counts.ready === 5 &&
            batch.counts.skipped === 95 &&
            batch.counts.needsReview === 0
        ),
        "Bulk fingerprints preserve readiness independently for all ten imports"
      )
      assert.ok(
        listCount <= 12,
        `At-capacity import list used ${listCount} queries`
      )
      assert.ok(
        queries.every(
          (query) => !/for (?:update|share|key share)|pg_advisory/i.test(query)
        ),
        "Reading readiness does not acquire publication locks"
      )

      queries.length = 0
      const overview = await getImportDrafts(
        tx,
        batches[0].batch.batch.id,
        owner.id
      )
      overviewCount = queries.length
      assert.equal(overview.rows.length, 100)
      assert.equal(
        overview.rows.filter((row) => row.readiness === "ready").length,
        5
      )
      assert.equal(overview.rows[0].draft!.files[0].id, batches[0].file.id)
      assert.ok(
        overview.rows
          .slice(0, 5)
          .every(
            (row) => row.draft!.importBatchId === batches[0].batch.batch.id
          )
      )
      assert.ok(
        overviewCount <= 18,
        `Import overview used ${overviewCount} queries`
      )
      assert.ok(
        queries.every(
          (query) => !/for (?:update|share|key share)|pg_advisory/i.test(query)
        )
      )

      const changed = batches[0].drafts[0]
      await updateTermDraft(
        tx,
        {
          id: changed.id,
          expectedVersion: changed.version,
          mutationId: randomUUID(),
          payload: { ...changed.payload!, definition: "Changed after review." }
        },
        owner.id
      )
      const stale = await listImportDrafts(tx, owner.id)
      assert.equal(
        stale.find((batch) => batch.id === batches[0].batch.batch.id)!.counts
          .needsReview,
        5
      )
      assert.ok(
        stale
          .filter((batch) => batch.id !== batches[0].batch.batch.id)
          .every((batch) => batch.counts.ready === 5),
        "One stale selection does not invalidate unrelated batches"
      )
      const deleted = batches[1].drafts[0]
      await deleteTermDraft(
        tx,
        { id: deleted.id, expectedVersion: deleted.version },
        owner.id
      )
      const tombstone = await getImportDrafts(
        tx,
        batches[1].batch.batch.id,
        owner.id
      )
      assert.equal(tombstone.rows[0].readiness, "deleted")
      assert.equal(tombstone.rows[0].draft, null)
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  console.log(
    `At-capacity import reads passed: 10 imports, 1,000 rows, 50 drafts; list ${listCount} queries, overview ${overviewCount} queries.`
  )
}
main()
  .then(() => db.$client.end())
  .catch(async (error) => {
    console.error(error)
    await db.$client.end()
    process.exitCode = 1
  })
