/*
 * Database checks for independently contributed definition examples. All
 * fixtures and selection-history changes run in one transaction that is
 * deliberately rolled back before the script exits.
 */

import assert from "node:assert/strict"
import { and, asc, eq, isNull } from "drizzle-orm"

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
