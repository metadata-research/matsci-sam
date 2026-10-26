import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import {
  db,
  usersTable,
  communitiesTable,
  communityMembersTable,
  vocabulariesTable,
  termsTable,
  communityStandardReleasesTable as releases,
  matcoreSourceOccurrencesTable
} from "../drizzle"
import {
  configureVocabularyWorkspace,
  installMatcoreSource,
  startMatcoreSourceChange,
  getMatcoreDraft,
  updateMatcoreDraft,
  submitMatcoreDraft,
  publishMatcoreDraft,
  withdrawMatcoreRevision,
  getMatcoreField,
  reviewMatcoreRevision,
  reviseMatcoreField,
  createMatcoreDraft
} from "../lib/matcore-workflow"
import {
  getCommunityStandard,
  createCommunityStandardRelease,
  commentOnStandardProposal
} from "../lib/community-standard"
import { emptyMatcoreDraftPayload } from "../lib/matcore-workflow-types"
import { MATCORE_STANDARD_MANIFEST } from "./fixtures/matcore-source-fixture"
import { testConcurrentStandardWithdrawals } from "./community-standard-concurrency-fixture"

class Rollback extends Error {}
let checks = 0
function same(a: unknown, b: unknown, label: string) {
  assert.deepEqual(a, b, label)
  checks++
}
async function denied(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (e: { code?: string }) => e.code === code)
  checks++
}
async function main() {
  try {
    await db.transaction(async (tx) => {
      const stamp = randomUUID().replaceAll("-", "")
      const [admin, steward, member, outsider] = await tx
        .insert(usersTable)
        .values([
          { name: `Standard admin ${stamp}`, role: "admin" },
          { name: `Standard steward ${stamp}`, role: "user" },
          { name: `Standard member ${stamp}`, role: "user" },
          { name: `Standard outsider ${stamp}`, role: "user" }
        ])
        .returning()
      const [vocab] = await tx
        .insert(vocabulariesTable)
        .values({
          slug: `standard_${stamp}`,
          title: "Standard fixture",
          createdById: admin.id
        })
        .returning()
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug: vocab.slug,
          vocabularySlug: vocab.slug,
          title: vocab.title,
          visibility: "members",
          createdById: admin.id
        })
        .returning()
      await tx.insert(communityMembersTable).values([
        {
          communityId: community.id,
          userId: steward.id,
          role: "steward",
          addedById: admin.id
        },
        {
          communityId: community.id,
          userId: member.id,
          role: "member",
          addedById: admin.id
        }
      ])
      await configureVocabularyWorkspace(
        tx,
        {
          vocabularySlug: vocab.slug,
          metadataEnabled: true,
          matcoreEnabled: true
        },
        admin.id
      )
      await installMatcoreSource(
        tx,
        { manifest: MATCORE_STANDARD_MANIFEST, vocabularySlug: vocab.slug },
        admin.id
      )
      const input = { vocabularySlug: vocab.slug }
      const baseline = await getCommunityStandard(tx, input, member.id)
      same(
        baseline.referenceEntries.length,
        MATCORE_STANDARD_MANIFEST.occurrences.length,
        "All reference fields available"
      )
      same(
        baseline.working.entries.length,
        baseline.referenceEntries.length,
        "Initial working version contains reference fields"
      )
      same(
        baseline.proposals.length,
        0,
        "Reference browsing creates no proposals"
      )
      same(baseline.releases.length, 0, "No fabricated community releases")
      await denied(getCommunityStandard(tx, input, null), "NOT_FOUND")
      await denied(getCommunityStandard(tx, input, outsider.id), "NOT_FOUND")
      const first = baseline.referenceEntries.find(
        (row) => row.profileKey === "minimal"
      )!
      const original = (
        await tx
          .select()
          .from(matcoreSourceOccurrencesTable)
          .where(eq(matcoreSourceOccurrencesTable.id, first.id))
      )[0]
      const started = await startMatcoreSourceChange(
        tx,
        { ...input, releaseId: baseline.reference!.id, occurrenceId: first.id },
        member.id
      )
      assert.equal(started.kind, "draft")
      if (started.kind !== "draft") throw new Error("Missing draft")
      const draft = await getMatcoreDraft(tx, started.draftId, member.id)
      same(
        draft.payload.label,
        first.payload.label,
        "New proposal starts with a short field name"
      )
      same(draft.baseline, original.baseline, "Source baseline remains exact")
      const edited = await updateMatcoreDraft(
        tx,
        {
          id: draft.id,
          expectedVersion: draft.version,
          mutationId: randomUUID(),
          payload: {
            ...draft.payload,
            definition: "Practitioner definition for the proposed field.",
            rationale: "Specify the values needed in a laboratory workflow."
          }
        },
        member.id
      )
      const submitted = await submitMatcoreDraft(
        tx,
        { id: edited.id, expectedVersion: edited.version },
        member.id
      )
      same(submitted.term, null, "New proposal has independent field identity")
      same(
        submitted.definitionRevisionId,
        null,
        "New proposal does not require a dictionary definition"
      )
      same(
        (
          await tx
            .select()
            .from(termsTable)
            .where(eq(termsTable.vocabularySlug, vocab.slug))
        ).length,
        0,
        "Submission creates no dictionary artifact"
      )
      same(
        (await getCommunityStandard(tx, input, member.id)).proposals[0].status,
        "awaiting_review",
        "Submitted proposal awaits review"
      )
      same(
        (await getCommunityStandard(tx, input, member.id)).fingerprint,
        baseline.fingerprint,
        "Pending changes do not affect the working version"
      )
      same(
        (
          await getMatcoreField(
            tx,
            submitted.fieldId,
            submitted.revisionId,
            member.id
          )
        ).canReview,
        false,
        "Member cannot review"
      )
      same(
        (
          await getMatcoreField(
            tx,
            submitted.fieldId,
            submitted.revisionId,
            steward.id
          )
        ).canReview,
        true,
        "Community steward can review without site admin"
      )
      await denied(
        reviewMatcoreRevision(
          tx,
          {
            revisionId: submitted.revisionId,
            decision: "accepted",
            reason: "Not authorized"
          },
          member.id
        ),
        "FORBIDDEN"
      )
      await commentOnStandardProposal(
        tx,
        {
          revisionId: submitted.revisionId,
          text: "Please include the units in the examples."
        },
        steward.id
      )
      same(
        (
          await getMatcoreField(
            tx,
            submitted.fieldId,
            submitted.revisionId,
            member.id
          )
        ).history.some((e) => e.action === "commented"),
        true,
        "Discussion is attributed to a revision"
      )
      await denied(
        commentOnStandardProposal(
          tx,
          { revisionId: submitted.revisionId, text: "Outside" },
          outsider.id
        ),
        "NOT_FOUND"
      )
      await reviewMatcoreRevision(
        tx,
        {
          revisionId: submitted.revisionId,
          decision: "accepted",
          reason: "Suitable for community use."
        },
        steward.id
      )
      const accepted = await getCommunityStandard(tx, input, member.id)
      same(
        accepted.working.entries.find((e) => e.id === first.id)?.payload
          .definition,
        edited.payload.definition,
        "Acceptance changes working version"
      )
      same(
        accepted.referenceEntries.find((e) => e.id === first.id)?.payload
          .definition,
        first.payload.definition,
        "Reference unchanged after acceptance"
      )
      same(
        typeof accepted.working.entries.find((e) => e.id === first.id)
          ?.reviewEventId,
        "number",
        "Snapshot pins review decision provenance"
      )
      const request = {
        ...input,
        id: randomUUID(),
        name: "Community 1.0",
        note: "First practitioner release",
        expectedFingerprint: accepted.fingerprint,
        referenceReleaseId: accepted.reference!.id
      }
      await denied(
        createCommunityStandardRelease(tx, request, member.id),
        "FORBIDDEN"
      )
      await denied(
        createCommunityStandardRelease(
          tx,
          { ...request, expectedFingerprint: baseline.fingerprint },
          steward.id
        ),
        "CONFLICT"
      )
      const release = await createCommunityStandardRelease(
        tx,
        request,
        steward.id
      )
      same(
        await createCommunityStandardRelease(tx, request, steward.id),
        release,
        "Release retries are idempotent"
      )
      const frozen = await getCommunityStandard(
        tx,
        { ...input, releaseId: release.id },
        member.id
      )
      same(
        frozen.selectedRelease!.snapshot,
        accepted.working,
        "Release freezes complete working snapshot"
      )
      await denied(
        createCommunityStandardRelease(
          tx,
          { ...request, id: randomUUID(), name: "community 1.0" },
          steward.id
        ),
        "CONFLICT"
      )
      await tx
        .transaction(async (savepoint) => {
          await assert.rejects(
            savepoint
              .update(releases)
              .set({ name: "Overwrite" })
              .where(eq(releases.id, release.id))
          )
          throw new Rollback()
        })
        .catch((e) => {
          if (!(e instanceof Rollback)) throw e
        })
      checks++
      const next = await reviseMatcoreField(
        tx,
        submitted.revisionId,
        steward.id
      )
      const nextSaved = await updateMatcoreDraft(
        tx,
        {
          id: next.id,
          expectedVersion: next.version,
          mutationId: randomUUID(),
          payload: {
            ...next.payload,
            definition: "A later proposed definition.",
            rationale: "Clarify the measurement scope."
          }
        },
        steward.id
      )
      const nextSubmitted = await submitMatcoreDraft(
        tx,
        { id: nextSaved.id, expectedVersion: nextSaved.version },
        steward.id
      )
      same(
        (await getCommunityStandard(tx, input, member.id)).working,
        accepted.working,
        "A pending revision keeps the last accepted revision in use"
      )
      await reviewMatcoreRevision(
        tx,
        {
          revisionId: nextSubmitted.revisionId,
          decision: "accepted",
          reason: "Clarification agreed."
        },
        steward.id
      )
      same(
        (
          await getCommunityStandard(
            tx,
            { ...input, releaseId: release.id },
            member.id
          )
        ).selectedRelease!.snapshot,
        accepted.working,
        "Later acceptance cannot rewrite an earlier release"
      )
      const legacyDraft = await reviseMatcoreField(
        tx,
        nextSubmitted.revisionId,
        member.id
      )
      const legacySaved = await updateMatcoreDraft(
        tx,
        {
          id: legacyDraft.id,
          expectedVersion: legacyDraft.version,
          mutationId: randomUUID(),
          payload: {
            ...legacyDraft.payload,
            rationale: "Keep the independent field history accessible."
          }
        },
        member.id
      )
      const beforeLegacy = await getCommunityStandard(tx, input, member.id)
      await denied(
        tx.transaction((savepoint) =>
          publishMatcoreDraft(
            savepoint,
            { id: legacySaved.id, expectedVersion: legacySaved.version },
            member.id
          )
        ),
        "CONFLICT"
      )
      same(
        (
          await getMatcoreField(
            tx,
            submitted.fieldId,
            submitted.revisionId,
            member.id
          )
        ).field.termId,
        null,
        "Rejected legacy publication keeps earlier independent revisions readable"
      )
      same(
        (
          await tx
            .select()
            .from(termsTable)
            .where(eq(termsTable.vocabularySlug, vocab.slug))
        ).length,
        0,
        "Rejected conversion creates no dictionary artifact"
      )
      same(
        await getMatcoreDraft(tx, legacySaved.id, member.id),
        legacySaved,
        "Rejected conversion preserves the saved draft and provenance"
      )
      same(
        (await getCommunityStandard(tx, input, member.id)).fingerprint,
        beforeLegacy.fingerprint,
        "Rejected conversion leaves the working version unchanged"
      )
      const independentRetry = await submitMatcoreDraft(
        tx,
        { id: legacySaved.id, expectedVersion: legacySaved.version },
        member.id
      )
      same(
        independentRetry.term,
        null,
        "Draft remains submittable as an independent proposal"
      )

      const [pathOwner] = await tx
        .insert(usersTable)
        .values({
          name: `Path reviewer ${stamp}`,
          role: "user"
        })
        .returning()
      await tx.insert(communityMembersTable).values({
        communityId: community.id,
        userId: pathOwner.id,
        role: "member",
        addedById: admin.id
      })
      // A reversal must not restore a path another accepted field now occupies.
      async function newPathField(label: string, path: string) {
        const payload = emptyMatcoreDraftPayload()
        payload.label = label
        payload.definition = "Synthetic path regression field."
        payload.rationale = "Exercise working-version path consistency."
        payload.specification.path = path
        return createMatcoreDraft(
          tx,
          { id: randomUUID(), ...input, payload },
          pathOwner.id
        )
      }
      async function submitPath(
        draft: Awaited<ReturnType<typeof getMatcoreDraft>>
      ) {
        return submitMatcoreDraft(
          tx,
          { id: draft.id, expectedVersion: draft.version },
          pathOwner.id
        )
      }
      async function movePath(revisionId: string, path: string) {
        const draft = await reviseMatcoreField(tx, revisionId, pathOwner.id)
        return updateMatcoreDraft(
          tx,
          {
            id: draft.id,
            expectedVersion: draft.version,
            mutationId: randomUUID(),
            payload: {
              ...draft.payload,
              rationale: "Move this field to a distinct path.",
              specification: { ...draft.payload.specification, path }
            }
          },
          pathOwner.id
        )
      }
      async function acceptPath(revisionId: string) {
        return reviewMatcoreRevision(
          tx,
          { revisionId, decision: "accepted", reason: "Path reviewed." },
          steward.id
        )
      }
      const pathA1 = await submitPath(await newPathField("Path A", "review.x"))
      await acceptPath(pathA1.revisionId)
      const pathA2 = await submitPath(
        await movePath(pathA1.revisionId, "review.y")
      )
      await acceptPath(pathA2.revisionId)
      const pathB1 = await submitPath(await newPathField("Path B", "review.x"))
      await acceptPath(pathB1.revisionId)
      const beforeReversal = await getCommunityStandard(tx, input, pathOwner.id)
      const beforeHistory = await getMatcoreField(
        tx,
        pathA2.fieldId,
        pathA2.revisionId,
        pathOwner.id
      )
      for (const decision of ["declined", "changes_requested"] as const) {
        await denied(
          tx.transaction((savepoint) =>
            reviewMatcoreRevision(
              savepoint,
              {
                revisionId: pathA2.revisionId,
                decision,
                reason: "Attempt a conflicting reversal."
              },
              steward.id
            )
          ),
          "CONFLICT"
        )
      }
      await denied(
        tx.transaction((savepoint) =>
          withdrawMatcoreRevision(
            savepoint,
            {
              revisionId: pathA2.revisionId,
              reason: "Attempt a conflicting withdrawal."
            },
            pathOwner.id
          )
        ),
        "CONFLICT"
      )
      same(
        (await getCommunityStandard(tx, input, pathOwner.id)).fingerprint,
        beforeReversal.fingerprint,
        "Rejected reversals preserve the working version"
      )
      same(
        await getMatcoreField(
          tx,
          pathA2.fieldId,
          pathA2.revisionId,
          pathOwner.id
        ),
        beforeHistory,
        "Rejected reversals leave no decision or provenance event"
      )
      const pathB2 = await submitPath(
        await movePath(pathB1.revisionId, "review.z")
      )
      await acceptPath(pathB2.revisionId)
      const validWithdrawal = {
        revisionId: pathA2.revisionId,
        reason: "The original path is available again."
      }
      const withdrawn = await withdrawMatcoreRevision(
        tx,
        validWithdrawal,
        pathOwner.id
      )
      same(
        await withdrawMatcoreRevision(tx, validWithdrawal, pathOwner.id),
        withdrawn,
        "Valid withdrawal remains idempotent"
      )
      const afterReversal = await getCommunityStandard(tx, input, pathOwner.id)
      same(
        afterReversal.working.entries.find(
          (row) => row.fieldId === pathA1.fieldId
        )?.revisionId,
        pathA1.revisionId,
        "Valid withdrawal restores the earlier accepted revision"
      )
      const pathRelease = await createCommunityStandardRelease(
        tx,
        {
          ...input,
          id: randomUUID(),
          name: "After path review",
          note: "",
          expectedFingerprint: afterReversal.fingerprint
        },
        steward.id
      )
      same(
        (
          await getCommunityStandard(
            tx,
            { ...input, releaseId: pathRelease.id },
            pathOwner.id
          )
        ).selectedRelease!.snapshot,
        afterReversal.working,
        "Working version remains releasable after a valid reversal"
      )
      same(
        (
          await getCommunityStandard(
            tx,
            { ...input, releaseId: release.id },
            pathOwner.id
          )
        ).selectedRelease!.snapshot,
        accepted.working,
        "Reversals do not alter previously frozen releases"
      )
      for (const path of ["specimen.name", "method.name"]) {
        const payload = emptyMatcoreDraftPayload()
        payload.label = "name"
        payload.definition = `Name for ${path}.`
        payload.rationale = "Add a field needed by practitioners."
        payload.specification.path = path
        const created = await createMatcoreDraft(
          tx,
          { id: randomUUID(), ...input, payload },
          member.id
        )
        const proposal = await submitMatcoreDraft(
          tx,
          { id: created.id, expectedVersion: created.version },
          member.id
        )
        await reviewMatcoreRevision(
          tx,
          {
            revisionId: proposal.revisionId,
            decision: "accepted",
            reason: "Distinct path reviewed."
          },
          steward.id
        )
      }
      same(
        (
          await getCommunityStandard(tx, input, member.id)
        ).working.entries.filter((e) => e.payload.label === "name").length,
        2,
        "Duplicate short names are distinct fields at different paths"
      )
      same(
        (
          await tx
            .select()
            .from(matcoreSourceOccurrencesTable)
            .where(eq(matcoreSourceOccurrencesTable.id, first.id))
        )[0],
        original,
        "Source content and provenance unchanged"
      )
      const newerManifest = structuredClone(MATCORE_STANDARD_MANIFEST)
      newerManifest.release.version = `next-${stamp}`
      const newerId = `matcore:${newerManifest.release.version}`
      newerManifest.occurrences = newerManifest.occurrences.map((row) => ({
        ...row,
        id: row.id.replace(baseline.reference!.id, newerId)
      }))
      await installMatcoreSource(
        tx,
        { manifest: newerManifest, vocabularySlug: vocab.slug },
        admin.id
      )
      const newerStandard = await getCommunityStandard(
        tx,
        { ...input, referenceReleaseId: newerId },
        member.id
      )
      same(
        newerStandard.proposals.filter((row) => row.sourceOccurrenceId).length,
        0,
        "Source-linked proposals do not silently cross reference versions"
      )
      same(
        newerStandard.working.entries.filter(
          (row) => row.sourceOccurrenceId && row.revisionId
        ).length,
        0,
        "New reference starts with its own preserved fields"
      )
      same(
        (
          await getCommunityStandard(
            tx,
            { ...input, releaseId: release.id },
            member.id
          )
        ).selectedRelease!.snapshot,
        accepted.working,
        "Newly installed reference does not change a frozen community release"
      )
      await denied(
        getCommunityStandard(
          tx,
          { ...input, releaseId: release.id, referenceReleaseId: newerId },
          member.id
        ),
        "NOT_FOUND"
      )
      const duplicate = emptyMatcoreDraftPayload()
      duplicate.label = "Name duplicate"
      duplicate.definition = "A second field at the same path."
      duplicate.rationale = "Test conflicting path review."
      duplicate.specification.path = "specimen.name"
      const duplicateDraft = await createMatcoreDraft(
        tx,
        { ...input, id: randomUUID(), payload: duplicate },
        member.id
      )
      const duplicateProposal = await submitMatcoreDraft(
        tx,
        { id: duplicateDraft.id, expectedVersion: duplicateDraft.version },
        member.id
      )
      await denied(
        tx.transaction((savepoint) =>
          reviewMatcoreRevision(
            savepoint,
            {
              revisionId: duplicateProposal.revisionId,
              decision: "accepted",
              reason: "Duplicate path must not be accepted."
            },
            steward.id
          )
        ),
        "CONFLICT"
      )
      same(
        (
          await getCommunityStandard(
            tx,
            { ...input, referenceReleaseId: newerId },
            member.id
          )
        ).proposals.find((row) => row.id === duplicateProposal.revisionId)
          ?.status,
        "awaiting_review",
        "Conflicting acceptance rolls back its decision event"
      )
      await tx
        .update(communityMembersTable)
        .set({ removedAt: sql`now()`, removedById: admin.id })
        .where(
          and(
            eq(communityMembersTable.communityId, community.id),
            eq(communityMembersTable.userId, steward.id)
          )
        )
      await denied(
        createCommunityStandardRelease(
          tx,
          { ...request, id: randomUUID(), name: "Removed steward" },
          steward.id
        ),
        "NOT_FOUND"
      )
      await denied(
        getCommunityStandard(
          tx,
          { ...input, releaseId: release.id },
          steward.id
        ),
        "NOT_FOUND"
      )
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  console.log(
    `Community standard database tests passed (${checks} checks, fixtures rolled back).`
  )
}
main()
  .then(testConcurrentStandardWithdrawals)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
