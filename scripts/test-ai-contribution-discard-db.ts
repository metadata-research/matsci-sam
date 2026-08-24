/*
 * Exercise discard retries against a migrated throwaway database. The first
 * discard is committed before its retry, and fixtures are removed in finally.
 */

import assert from "node:assert/strict"
import { eq, inArray } from "drizzle-orm"

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must point at a migrated database")
    process.exit(2)
  }

  const { aiContributionSuggestionsTable, db, usersTable } = await import(
    "../drizzle"
  )
  const { discardAiContributionSuggestion } = await import(
    "../lib/ai-contribution-suggestions"
  )
  const stamp = `${Date.now().toString(36)}-${process.pid}`
  let fixture:
    | {
        ownerId: number
        strangerId: number
        retrySuggestionId: number
        protectedSuggestionId: number
      }
    | undefined

  try {
    fixture = await db.transaction(async (tx) => {
      const [owner, stranger] = await tx
        .insert(usersTable)
        .values([
          { name: `AI discard owner ${stamp}` },
          { name: `AI discard stranger ${stamp}` }
        ])
        .returning({ id: usersTable.id })
      const [retrySuggestion, protectedSuggestion] = await tx
        .insert(aiContributionSuggestionsTable)
        .values([
          {
            intent: "new_term",
            requestedById: owner.id,
            termText: `discard retry test ${stamp}`,
            suggestedDefinition:
              "A generated preview whose discard response is retried.",
            promptKey: "discard-test",
            promptHash: `discard-retry-${stamp}`,
            promptText: "Generate a test definition.",
            model: "test-model"
          },
          {
            intent: "new_term",
            requestedById: owner.id,
            termText: `discard ownership test ${stamp}`,
            suggestedDefinition:
              "A live preview that another contributor cannot discard.",
            promptKey: "discard-test",
            promptHash: `discard-ownership-${stamp}`,
            promptText: "Generate a test definition.",
            model: "test-model"
          }
        ])
        .returning({ id: aiContributionSuggestionsTable.id })

      return {
        ownerId: owner.id,
        strangerId: stranger.id,
        retrySuggestionId: retrySuggestion.id,
        protectedSuggestionId: protectedSuggestion.id
      }
    })

    const committedFixture = fixture
    const firstDecision = await db.transaction(async (tx) => {
      assert.equal(
        await discardAiContributionSuggestion({
          suggestionId: committedFixture.retrySuggestionId,
          requestedById: committedFixture.ownerId,
          database: tx
        }),
        true
      )
      return tx.query.aiContributionSuggestionsTable.findFirst({
        columns: { status: true, decidedAt: true },
        where: eq(
          aiContributionSuggestionsTable.id,
          committedFixture.retrySuggestionId
        )
      })
    })
    assert.equal(firstDecision?.status, "discarded")
    assert.ok(firstDecision?.decidedAt)

    // This is a new transaction: simulate retrying after the first committed
    // response was lost before the client received it.
    const retriedDecision = await db.transaction(async (tx) => {
      assert.equal(
        await discardAiContributionSuggestion({
          suggestionId: committedFixture.retrySuggestionId,
          requestedById: committedFixture.ownerId,
          database: tx
        }),
        true
      )
      return tx.query.aiContributionSuggestionsTable.findFirst({
        columns: { status: true, decidedAt: true },
        where: eq(
          aiContributionSuggestionsTable.id,
          committedFixture.retrySuggestionId
        )
      })
    })
    assert.equal(retriedDecision?.status, "discarded")
    assert.equal(
      retriedDecision?.decidedAt,
      firstDecision?.decidedAt,
      "retry preserves the first decision time"
    )

    await db.transaction(async (tx) => {
      assert.equal(
        await discardAiContributionSuggestion({
          suggestionId: committedFixture.protectedSuggestionId,
          requestedById: committedFixture.strangerId,
          database: tx
        }),
        false,
        "another contributor cannot observe or discard the preview"
      )
      const protectedSuggestion =
        await tx.query.aiContributionSuggestionsTable.findFirst({
          columns: { status: true, decidedAt: true },
          where: eq(
            aiContributionSuggestionsTable.id,
            committedFixture.protectedSuggestionId
          )
        })
      assert.deepEqual(protectedSuggestion, {
        status: "generated",
        decidedAt: null
      })
    })
  } finally {
    if (fixture) {
      const cleanupFixture = fixture
      await db.transaction(async (tx) => {
        await tx
          .delete(aiContributionSuggestionsTable)
          .where(
            inArray(aiContributionSuggestionsTable.id, [
              cleanupFixture.retrySuggestionId,
              cleanupFixture.protectedSuggestionId
            ])
          )
        await tx
          .delete(usersTable)
          .where(
            inArray(usersTable.id, [
              cleanupFixture.ownerId,
              cleanupFixture.strangerId
            ])
          )
      })
    }
  }

  console.log("AI contribution discard database checks passed.")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
