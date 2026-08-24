/*
 * Database checks for independently contributed definition examples. All
 * fixtures and selection-history changes run in one transaction that is
 * deliberately rolled back before the script exits.
 */

import assert from "node:assert/strict"
import { and, asc, eq, isNull, sql } from "drizzle-orm"

class Rollback extends Error {}

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must point at a migrated database")
    process.exit(2)
  }

  const {
    db,
    definitionExamplesTable,
    definitionExampleSelectionsTable,
    termsTable,
    usersTable
  } = await import("../drizzle")
  const { createDefinitionWithInitialRevision } = await import(
    "../lib/definition-revisions"
  )
  const {
    createDefinitionExample,
    DefinitionExampleStaleRevisionError,
    selectDefinitionExample
  } = await import("../lib/definition-examples")

  const stamp = Date.now().toString(36)

  try {
    await db.transaction(async (tx) => {
      const [author] = await tx
        .insert(usersTable)
        .values({ name: `Definition example test ${stamp}` })
        .returning({ id: usersTable.id })
      const [term] = await tx
        .insert(termsTable)
        .values({
          term: `definition example test ${stamp}`,
          slug: `definition_example_test_${stamp}`
        })
        .returning({ id: termsTable.id })
      const { definition, revision } =
        await createDefinitionWithInitialRevision(tx, {
          termId: term.id,
          authorId: author.id,
          definition: "A fixture definition for testing multiple examples.",
          example: "",
          changeNote: "fixture",
          source: "initial"
        })

      await assert.rejects(
        createDefinitionExample(tx, {
          definitionId: definition.id,
          sourceRevisionId: revision.id + 1,
          text: "This example names a stale source revision.",
          authorId: author.id,
          actorKind: "human"
        }),
        DefinitionExampleStaleRevisionError
      )

      const first = await createDefinitionExample(tx, {
        definitionId: definition.id,
        sourceRevisionId: revision.id,
        text: "  First independent example.  ",
        authorId: author.id,
        actorKind: "human"
      })
      const second = await createDefinitionExample(tx, {
        definitionId: definition.id,
        sourceRevisionId: revision.id,
        text: "Second independent example.",
        authorId: author.id,
        actorKind: "human"
      })

      assert.equal(first.example.exampleNumber, 1)
      assert.equal(first.example.text, "First independent example.")
      assert.equal(first.isFeatured, true)
      assert.equal(second.example.exampleNumber, 2)
      assert.equal(second.isFeatured, false)

      const examples = await tx
        .select({
          id: definitionExamplesTable.id,
          number: definitionExamplesTable.exampleNumber,
          sourceRevisionId: definitionExamplesTable.sourceRevisionId
        })
        .from(definitionExamplesTable)
        .where(eq(definitionExamplesTable.definitionId, definition.id))
        .orderBy(asc(definitionExamplesTable.exampleNumber))
      assert.deepEqual(
        examples.map(({ id, number, sourceRevisionId }) => ({
          id,
          number,
          sourceRevisionId
        })),
        [
          { id: first.example.id, number: 1, sourceRevisionId: revision.id },
          { id: second.example.id, number: 2, sourceRevisionId: revision.id }
        ]
      )

      await selectDefinitionExample(tx, {
        definitionId: definition.id,
        exampleId: second.example.id,
        selectedById: author.id
      })
      await selectDefinitionExample(tx, {
        definitionId: definition.id,
        exampleId: second.example.id,
        selectedById: author.id
      })

      const selections = await tx
        .select({
          exampleId: definitionExampleSelectionsTable.exampleId,
          endedAt: definitionExampleSelectionsTable.endedAt,
          endedById: definitionExampleSelectionsTable.endedById
        })
        .from(definitionExampleSelectionsTable)
        .where(eq(definitionExampleSelectionsTable.definitionId, definition.id))
        .orderBy(asc(definitionExampleSelectionsTable.id))
      assert.equal(selections.length, 2, "idempotent selection appends no row")
      assert.equal(selections[0].exampleId, first.example.id)
      assert.ok(selections[0].endedAt)
      assert.equal(selections[0].endedById, author.id)
      assert.equal(selections[1].exampleId, second.example.id)
      assert.equal(selections[1].endedAt, null)
      assert.equal(selections[1].endedById, null)

      const [activeSelection] = await tx
        .select({ exampleId: definitionExampleSelectionsTable.exampleId })
        .from(definitionExampleSelectionsTable)
        .where(
          and(
            eq(definitionExampleSelectionsTable.definitionId, definition.id),
            isNull(definitionExampleSelectionsTable.endedAt)
          )
        )
      assert.equal(activeSelection.exampleId, second.example.id)

      const historyIndex = await tx.execute(sql`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'definition_example_selections_definition_history_idx'
      `)
      assert.equal(historyIndex.rows.length, 1)
      assert.match(
        String(historyIndex.rows[0]?.indexdef),
        /\("definitionId", "selectedAt", id\)/,
        "featured-example history has its definition/time/id index"
      )

      let immutableUpdateRejected = false
      try {
        await tx.transaction(async (savepoint) => {
          await savepoint
            .update(definitionExamplesTable)
            .set({ text: "Rewritten example." })
            .where(eq(definitionExamplesTable.id, first.example.id))
        })
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause ?? error
        immutableUpdateRejected = String(cause).includes(
          "definition example content and provenance are immutable"
        )
      }
      assert.ok(immutableUpdateRejected, "published example text is immutable")

      let immutableAttributionRejected = false
      try {
        await tx.transaction(async (savepoint) => {
          await savepoint
            .update(definitionExamplesTable)
            .set({ authorId: null, actorKind: null })
            .where(eq(definitionExamplesTable.id, first.example.id))
        })
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause ?? error
        immutableAttributionRejected = String(cause).includes(
          "definition example content and provenance are immutable"
        )
      }
      assert.ok(
        immutableAttributionRejected,
        "published example attribution is immutable after migration repair"
      )

      let immutableSelectionOriginRejected = false
      try {
        await tx.transaction(async (savepoint) => {
          await savepoint
            .update(definitionExampleSelectionsTable)
            .set({ selectedById: null })
            .where(
              eq(definitionExampleSelectionsTable.exampleId, second.example.id)
            )
        })
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause ?? error
        immutableSelectionOriginRejected = String(cause).includes(
          "definition example selection history is immutable"
        )
      }
      assert.ok(
        immutableSelectionOriginRejected,
        "featured-example selection origin is immutable after migration repair"
      )

      let endedSelectionRewriteRejected = false
      try {
        await tx.transaction(async (savepoint) => {
          await savepoint
            .update(definitionExampleSelectionsTable)
            .set({ endedAt: "2099-01-01T00:00:00.000Z" })
            .where(
              eq(definitionExampleSelectionsTable.exampleId, first.example.id)
            )
        })
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause ?? error
        endedSelectionRewriteRejected = String(cause).includes(
          "definition example selection history is immutable"
        )
      }
      assert.ok(
        endedSelectionRewriteRejected,
        "an ended featured-example interval cannot be rewritten"
      )

      let fabricatedLegacyActorRejected = false
      try {
        await tx.transaction(async (savepoint) => {
          await savepoint.insert(definitionExamplesTable).values({
            definitionId: definition.id,
            exampleNumber: 3,
            sourceRevisionId: revision.id,
            text: "A legacy row must not invent an example contributor.",
            authorId: author.id,
            actorKind: "human",
            legacyBackfill: true
          })
        })
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause ?? error
        fabricatedLegacyActorRejected = String(cause).includes(
          "definition_examples_attribution_complete_or_legacy"
        )
      }
      assert.ok(
        fabricatedLegacyActorRejected,
        "legacy examples require unknown actor attribution"
      )

      let fabricatedLegacySelectorRejected = false
      try {
        await tx.transaction(async (savepoint) => {
          await savepoint.insert(definitionExampleSelectionsTable).values({
            definitionId: definition.id,
            exampleId: first.example.id,
            selectedById: author.id,
            selectedAt: "2026-01-01T00:00:00.000Z",
            endedAt: "2026-01-01T00:00:00.000Z",
            endedById: author.id,
            legacyBackfill: true
          })
        })
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause ?? error
        fabricatedLegacySelectorRejected = String(cause).includes(
          "definition_example_selections_actor_or_legacy"
        )
      }
      assert.ok(
        fabricatedLegacySelectorRejected,
        "legacy feature intervals require an unknown selector"
      )

      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }

  console.log("Definition example database tests passed")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
