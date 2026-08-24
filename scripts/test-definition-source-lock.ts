/*
 * Prove that a derived definition cannot be published against a source that
 * changes underneath it. The fixture is committed so two independent
 * transactions can contend for the same stable definition row, then removed
 * explicitly in finally.
 */

import assert from "node:assert/strict"
import { eq, sql } from "drizzle-orm"

const OBSERVE_BLOCK_MS = 200
const OPERATION_TIMEOUT_MS = 8_000

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const withTimeout = async <T>(
  promise: Promise<T>,
  message: string
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), OPERATION_TIMEOUT_MS)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const observeBlocked = (operation: Promise<unknown>) =>
  Promise.race([
    operation.then(
      () => "settled" as const,
      () => "settled" as const
    ),
    new Promise<"blocked">((resolve) => {
      setTimeout(() => resolve("blocked"), OBSERVE_BLOCK_MS)
    })
  ])

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must point at a migrated database")
    process.exit(2)
  }

  const {
    db,
    definitionRevisionsTable,
    definitionsTable,
    termsTable,
    usersTable
  } = await import("../drizzle")
  const { createDefinitionWithInitialRevision, publishDefinitionRevision } =
    await import("../lib/definition-revisions")
  const { lockDefinitionRevisionSource } = await import(
    "../lib/definition-source"
  )
  const { deleteDefinitionRows } = await import("../lib/definition-purge")

  const stamp = `${Date.now().toString(36)}-${process.pid}`
  let fixture:
    | {
        userId: number
        termId: number
        definitionId: number
        revisionId: number
      }
    | undefined
  const holderReady = deferred()
  const writerReady = deferred()
  const releaseHolder = deferred()
  let holder: Promise<unknown> | undefined
  let writer:
    | Promise<Awaited<ReturnType<typeof publishDefinitionRevision>>>
    | undefined

  try {
    fixture = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(usersTable)
        .values({ name: `Definition source lock test ${stamp}` })
        .returning({ id: usersTable.id })
      const [term] = await tx
        .insert(termsTable)
        .values({
          term: `definition source lock test ${stamp}`,
          slug: `definition_source_lock_test_${stamp}`
        })
        .returning({ id: termsTable.id })
      const { definition, revision } =
        await createDefinitionWithInitialRevision(tx, {
          termId: term.id,
          authorId: user.id,
          definition: "The first revision used as a derivation source.",
          example: "",
          changeNote: "concurrency fixture",
          source: "initial"
        })

      return {
        userId: user.id,
        termId: term.id,
        definitionId: definition.id,
        revisionId: revision.id
      }
    })

    const lockedFixture = fixture
    holder = db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '8s'`)
      await tx.execute(
        sql`SET LOCAL idle_in_transaction_session_timeout = '8s'`
      )
      const source = await lockDefinitionRevisionSource(
        tx,
        lockedFixture.revisionId
      )
      assert.ok(source)
      assert.equal(source.definitionId, lockedFixture.definitionId)
      assert.equal(source.isCurrent, true)
      holderReady.resolve()
      await withTimeout(
        releaseHolder.promise,
        "timed out waiting to release the source-revision lock"
      )
    })

    await withTimeout(
      Promise.race([
        holderReady.promise,
        holder.then(() => {
          throw new Error(
            "source-lock transaction finished before reporting its lock"
          )
        })
      ]),
      "timed out waiting for the source-revision lock"
    )

    writer = db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '8s'`)
      await tx.execute(sql`SET LOCAL statement_timeout = '8s'`)
      writerReady.resolve()
      return publishDefinitionRevision(tx, {
        definitionId: lockedFixture.definitionId,
        editorId: lockedFixture.userId,
        definition: "The second revision advances the stable definition.",
        example: "",
        changeNote: "concurrent source-lock test",
        source: "author_edit",
        expectedRevisionId: lockedFixture.revisionId
      })
    })

    await withTimeout(
      Promise.race([
        writerReady.promise,
        writer.then(() => {
          throw new Error("writer finished before attempting publication")
        })
      ]),
      "timed out starting the writer"
    )
    assert.equal(
      await observeBlocked(writer),
      "blocked",
      "advancing currentRevisionId must wait for the derivation source lock"
    )

    releaseHolder.resolve()
    await withTimeout(holder, "source-lock transaction did not finish")
    const published = await withTimeout(
      writer,
      "writer did not continue after the source lock was released"
    )
    assert.equal(published.revision.version, 2)
    assert.equal(
      published.revision.previousRevisionId,
      lockedFixture.revisionId
    )
    assert.notEqual(published.revision.id, lockedFixture.revisionId)

    await db.transaction(async (tx) => {
      const oldSource = await lockDefinitionRevisionSource(
        tx,
        lockedFixture.revisionId
      )
      assert.ok(oldSource)
      assert.equal(oldSource.isCurrent, false, "R1 is stale after R2 publishes")
      assert.equal(oldSource.currentRevisionId, published.revision.id)

      const [current] = await tx
        .select({ currentRevisionId: definitionsTable.currentRevisionId })
        .from(definitionsTable)
        .where(eq(definitionsTable.id, lockedFixture.definitionId))
      assert.equal(current.currentRevisionId, published.revision.id)

      const revisions = await tx
        .select({ id: definitionRevisionsTable.id })
        .from(definitionRevisionsTable)
        .where(
          eq(definitionRevisionsTable.definitionId, lockedFixture.definitionId)
        )
      assert.equal(revisions.length, 2)
    })
  } finally {
    // Always release transaction A before awaiting either transaction. This
    // keeps an assertion failure from leaving transaction B waiting on a lock.
    releaseHolder.resolve()
    if (holder || writer)
      await withTimeout(
        Promise.allSettled([holder, writer].filter(Boolean)),
        "concurrent test transactions did not settle during cleanup"
      )

    if (fixture) {
      const cleanupFixture = fixture
      await db.transaction(async (tx) => {
        await deleteDefinitionRows(tx, cleanupFixture.definitionId)
        await tx
          .delete(termsTable)
          .where(eq(termsTable.id, cleanupFixture.termId))
        await tx
          .delete(usersTable)
          .where(eq(usersTable.id, cleanupFixture.userId))
      })
    }
  }

  console.log("Definition source lock database test passed")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
