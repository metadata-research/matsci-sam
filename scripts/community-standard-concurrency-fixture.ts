import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import {
  db,
  communityMembersTable,
  vocabulariesTable,
  vocabularyWorkspaceSettingsTable,
  matcoreFieldsTable as fields,
  matcoreSpecDraftsTable as drafts,
  matcoreSpecRevisionsTable as revisions,
  matcoreWorkflowEventsTable as events
} from "../drizzle"
import {
  configureVocabularyWorkspace,
  createMatcoreDraft,
  reviseMatcoreField,
  updateMatcoreDraft,
  submitMatcoreDraft,
  reviewMatcoreRevision,
  withdrawMatcoreRevision
} from "../lib/matcore-workflow"
import {
  getCommunityStandard,
  assertStandardPaths
} from "../lib/community-standard"
import { emptyMatcoreDraftPayload } from "../lib/matcore-workflow-types"
import {
  createGuidedSetupFixture,
  removeGuidedSetupFixture
} from "./guided-setup-ui-fixture"

/** Independent connections need committed fixtures; every fixture is removed. */
export async function testConcurrentStandardWithdrawals() {
  const fixture = await createGuidedSetupFixture()
  try {
    const targets = await db.transaction(async (tx) => {
      await tx
        .update(communityMembersTable)
        .set({ role: "steward" })
        .where(
          and(
            eq(communityMembersTable.communityId, fixture.communityId),
            eq(communityMembersTable.userId, fixture.userId)
          )
        )
      await configureVocabularyWorkspace(
        tx,
        {
          vocabularySlug: fixture.vocabularySlug,
          metadataEnabled: true,
          matcoreEnabled: false
        },
        fixture.userId
      )
      async function submit(label: string, path: string, previous?: string) {
        const payload = emptyMatcoreDraftPayload()
        payload.label = label
        payload.definition = "Synthetic concurrent withdrawal field."
        payload.rationale = "Exercise concurrent restoration of a schema path."
        payload.specification.path = path
        const draft = previous
          ? await reviseMatcoreField(tx, previous, fixture.userId)
          : await createMatcoreDraft(
              tx,
              {
                id: randomUUID(),
                vocabularySlug: fixture.vocabularySlug,
                payload
              },
              fixture.userId
            )
        const saved = previous
          ? await updateMatcoreDraft(
              tx,
              {
                id: draft.id,
                expectedVersion: draft.version,
                mutationId: randomUUID(),
                payload
              },
              fixture.userId
            )
          : draft
        const published = await submitMatcoreDraft(
          tx,
          { id: saved.id, expectedVersion: saved.version },
          fixture.userId
        )
        await reviewMatcoreRevision(
          tx,
          {
            revisionId: published.revisionId,
            decision: "accepted",
            reason: "Distinct path reviewed."
          },
          fixture.userId
        )
        return published.revisionId
      }
      const a1 = await submit("Concurrent A", "shared")
      const a2 = await submit("Concurrent A", "current.a", a1)
      const b1 = await submit("Concurrent B", "shared")
      const b2 = await submit("Concurrent B", "current.b", b1)
      return [a2, b2]
    })
    const pids: number[] = []
    let pending: Promise<PromiseSettledResult<unknown>[]> | undefined
    try {
      // Hold both requests at the same gate so the test exercises contention.
      await db.transaction(async (gate) => {
        await gate.execute(sql`SET LOCAL statement_timeout = '10s'`)
        await gate
          .select()
          .from(vocabulariesTable)
          .where(eq(vocabulariesTable.slug, fixture.vocabularySlug))
          .for("update")
        pending = Promise.allSettled(
          targets.map((revisionId) =>
            db.transaction(async (tx) => {
              await tx.execute(sql`SET LOCAL statement_timeout = '10s'`)
              const result = await tx.execute<{ pid: number }>(
                sql`SELECT pg_backend_pid() AS pid`
              )
              pids.push(result.rows[0].pid)
              return withdrawMatcoreRevision(
                tx,
                { revisionId, reason: "Restore the earlier accepted path." },
                fixture.userId
              )
            })
          )
        )
        const deadline = Date.now() + 8000
        while (true) {
          if (pids.length === 2) {
            const result = await gate.execute<{ blocked: number }>(sql`
              SELECT count(*)::int AS blocked FROM pg_stat_activity
              WHERE pid IN (${pids[0]}, ${pids[1]}) AND cardinality(pg_blocking_pids(pid)) > 0`)
            if (result.rows[0].blocked === 2) break
          }
          assert.ok(
            Date.now() < deadline,
            "Both withdrawals must reach the held vocabulary lock"
          )
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
      })
      const outcomes = await pending!
      assert.equal(
        outcomes.filter((row) => row.status === "fulfilled").length,
        1
      )
      const rejected = outcomes.filter((row) => row.status === "rejected")
      assert.equal(rejected.length, 1)
      assert.equal(rejected[0].reason.code, "CONFLICT")
      const standard = await getCommunityStandard(
        db,
        { vocabularySlug: fixture.vocabularySlug },
        fixture.userId
      )
      assertStandardPaths(standard.working.entries)
      assert.equal(
        standard.working.entries.filter(
          (row) => row.payload.specification.path === "shared"
        ).length,
        1
      )
      assert.equal(
        standard.proposals.filter((row) => row.status === "withdrawn").length,
        1
      )
      const withdrawals = await db
        .select()
        .from(events)
        .where(
          and(
            inArray(events.revisionId, targets),
            eq(events.action, "withdrawn")
          )
        )
      assert.equal(
        withdrawals.length,
        1,
        "The rejected withdrawal leaves no provenance event"
      )
    } finally {
      if (pending) await pending
    }
  } finally {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: fields.id })
        .from(fields)
        .where(eq(fields.vocabularySlug, fixture.vocabularySlug))
      const ids = rows.map((row) => row.id)
      if (ids.length) {
        await tx.delete(events).where(inArray(events.fieldId, ids))
        await tx.delete(drafts).where(inArray(drafts.fieldId, ids))
        await tx.delete(revisions).where(inArray(revisions.fieldId, ids))
        await tx.delete(fields).where(inArray(fields.id, ids))
      }
      await tx
        .delete(vocabularyWorkspaceSettingsTable)
        .where(
          eq(
            vocabularyWorkspaceSettingsTable.vocabularySlug,
            fixture.vocabularySlug
          )
        )
    })
    await removeGuidedSetupFixture(fixture)
  }
  console.log(
    "Concurrent withdrawal regression passed; committed fixtures removed."
  )
}
