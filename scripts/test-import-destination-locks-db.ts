import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq, inArray, sql, type SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import {
  db,
  collectionsTable,
  importBatchesTable,
  termDraftsTable,
  usersTable,
  vocabulariesTable
} from "../drizzle"
import {
  createImportDrafts,
  publishImportDrafts,
  reviewImportDrafts
} from "../lib/import-drafts"
import { updateTermDraft } from "../lib/term-drafts"
import { publishNewTerm } from "../lib/new-term-publication"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
class Rollback extends Error {
  constructor(readonly result: unknown) {
    super("Roll back the successful concurrency fixture")
  }
}
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function rolledBack(action: (tx: Transaction) => Promise<unknown>) {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '8s'`)
      throw new Rollback(await action(tx))
    })
  } catch (error) {
    if (error instanceof Rollback) return error.result
    throw error
  }
}
const dialect = new PgDialect()
async function overlap(
  first: (tx: Transaction) => Promise<unknown>,
  second: (tx: Transaction) => Promise<unknown>
) {
  const firstReserved = deferred()
  const releaseFirst = deferred()
  let paused = false
  const one = rolledBack((tx) =>
    first(
      new Proxy(tx, {
        get(target, property, receiver) {
          if (property === "execute")
            return async (query: SQL) => {
              const result = await target.execute(query)
              if (
                !paused &&
                dialect
                  .sqlToQuery(query)
                  .sql.includes("hashtext('matsci-sam:setup-import')")
              ) {
                paused = true
                firstReserved.resolve()
                await releaseFirst.promise
              }
              return result
            }
          const value = Reflect.get(target, property, receiver)
          return typeof value === "function" ? value.bind(target) : value
        }
      })
    )
  )
  // Attach handlers immediately, including when setup itself fails.
  const firstResult = Promise.allSettled([one])
  let two: Promise<unknown> | undefined
  try {
    await Promise.race([
      firstReserved.promise,
      one.then(() => {
        throw new Error("The group must reserve a publication destination")
      })
    ])
    const secondStarted = deferred()
    let secondPid = 0
    two = rolledBack(async (tx) => {
      const process = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`
      )
      secondPid = process.rows[0].pid
      secondStarted.resolve()
      return second(tx)
    })
    const results = Promise.allSettled([one, two])
    await secondStarted.promise
    let blocked = false
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      const activity = await db.execute<{ wait_event_type: string | null }>(
        sql`select wait_event_type from pg_stat_activity where pid=${secondPid}`
      )
      if (activity.rows[0]?.wait_event_type === "Lock") {
        blocked = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    releaseFirst.resolve()
    const settled = await results
    assert.ok(blocked, "The publications must overlap a destination lock")
    for (const result of settled)
      if (result.status === "rejected") throw result.reason
    assert.equal(settled.length, 2)
  } finally {
    releaseFirst.resolve()
    await firstResult
    if (two) await Promise.allSettled([two])
  }
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /_(?:test|scratch|ci|qa)(?:_|$)/)
  assert.equal(process.env.GRAPH_PROJECTION_ENABLED, "false")
  const stamp = randomUUID().replaceAll("-", "")
  const owners = await db
    .insert(usersTable)
    .values([
      { name: `Destination lock one ${stamp}`, role: "admin" },
      { name: `Destination lock two ${stamp}`, role: "admin" }
    ])
    .returning()
  const vocabularies = await db
    .insert(vocabulariesTable)
    .values(
      ["a", "b"].map((name) => ({
        slug: `destination_${name}_${stamp}`,
        title: `Destination ${name}`,
        createdById: owners[0].id
      }))
    )
    .returning()
  const collections = await db
    .insert(collectionsTable)
    .values(
      ["a", "b"].map((name) => ({
        slug: `destination_${name}_${stamp}`,
        title: `Destination ${name}`,
        createdById: owners[0].id
      }))
    )
    .returning()
  try {
    async function group(
      ownerId: number,
      label: string,
      destinations: { vocabularySlug: string; collectionId?: number }[]
    ) {
      return db.transaction(async (tx) => {
        const batch = await createImportDrafts(
          tx,
          {
            id: randomUUID(),
            text: `term,definition\n${label} first ${stamp},First fixture.\n${label} second ${stamp},Second fixture.`,
            format: "csv",
            vocabularySlug: destinations[0].vocabularySlug,
            ignoredColumns: [],
            selectedRowIds: ["record-1", "record-2"]
          },
          ownerId
        )
        const drafts = batch.rows
          .map((row) => row.draft!)
          .sort((a, b) => a.id.localeCompare(b.id))
        const selected = []
        for (const [index, draft] of drafts.entries()) {
          const saved = await updateTermDraft(
            tx,
            {
              id: draft.id,
              expectedVersion: draft.version,
              mutationId: randomUUID(),
              payload: {
                ...draft.payload!,
                ...destinations[index],
                collectionId: destinations[index].collectionId ?? null
              }
            },
            ownerId
          )
          selected.push({ id: saved.id, expectedVersion: saved.version })
        }
        const review = await reviewImportDrafts(
          tx,
          { id: batch.batch.id, drafts: selected },
          ownerId
        )
        assert.ok(review.reviewToken, review.errors.join(" "))
        return { id: batch.batch.id, reviewToken: review.reviewToken }
      })
    }
    const collectionGroup = await group(owners[0].id, "collection", [
      { vocabularySlug: vocabularies[0].slug, collectionId: collections[0].id },
      { vocabularySlug: vocabularies[0].slug, collectionId: collections[1].id }
    ])
    await overlap(
      (tx) => publishImportDrafts(tx, collectionGroup, owners[0].id),
      (tx) =>
        publishNewTerm(
          tx,
          {
            term: `ordinary destination ${stamp}`,
            definition:
              "An ordinary contribution sharing the second collection.",
            vocabularySlug: vocabularies[0].slug,
            collectionId: collections[1].id
          },
          owners[1].id
        )
    )
    const firstGroup = await group(owners[0].id, "forward", [
      { vocabularySlug: vocabularies[0].slug },
      { vocabularySlug: vocabularies[1].slug }
    ])
    const secondGroup = await group(owners[1].id, "reverse", [
      { vocabularySlug: vocabularies[1].slug },
      { vocabularySlug: vocabularies[0].slug }
    ])
    await overlap(
      (tx) => publishImportDrafts(tx, firstGroup, owners[0].id),
      (tx) => publishImportDrafts(tx, secondGroup, owners[1].id)
    )
    console.log(
      "Import destination concurrency passed: group/ordinary collection overlap and opposite vocabulary order complete without deadlock."
    )
  } finally {
    await db.transaction(async (tx) => {
      const ownerIds = owners.map((owner) => owner.id)
      await tx
        .delete(importBatchesTable)
        .where(inArray(importBatchesTable.ownerId, ownerIds))
      await tx
        .delete(termDraftsTable)
        .where(inArray(termDraftsTable.ownerId, ownerIds))
      await tx.delete(collectionsTable).where(
        inArray(
          collectionsTable.id,
          collections.map((collection) => collection.id)
        )
      )
      await tx
        .delete(vocabulariesTable)
        .where(eq(vocabulariesTable.createdById, owners[0].id))
      await tx.delete(usersTable).where(inArray(usersTable.id, ownerIds))
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
