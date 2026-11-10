import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import {
  db,
  usersTable as users,
  vocabulariesTable as vocabularies,
  communitiesTable as communities,
  communityMembersTable as members,
  communityReviewExerciseEventsTable as exerciseEvents,
  communityReviewExercisesTable as exercises,
  communityReviewResponsesTable as responses,
  communityReviewEventsTable as feedbackEvents,
  vocabularyMatcoreSourcesTable as grants
} from "../drizzle"
import {
  configureVocabularyWorkspace,
  installMatcoreSource,
  startMatcoreSourceChange,
  getMatcoreDraft,
  updateMatcoreDraft,
  submitMatcoreDraft,
  reviewMatcoreRevision
} from "../lib/matcore-workflow"
import { getCommunityStandard } from "../lib/community-standard"
import {
  createCommunityReview,
  getCommunityReview,
  saveCommunityReview,
  requestedCommunityReviews,
  closeCommunityReview,
  communityReviewExerciseSetup,
  getCommunityReviewExercise,
  saveCommunityReviewExercise,
  communityReviewExerciseResults,
  communityReviewExerciseRevisions
} from "../lib/community-reviews"
import { MATCORE_STANDARD_MANIFEST } from "./fixtures/matcore-source-fixture"
import {
  requireLocalReviewDatabase,
  reviewFingerprints
} from "./community-review-test-support"

class Rollback extends Error {}
let checks = 0
function same(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label)
  checks++
  console.log("PASS " + label)
}
async function denied(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (error: { code?: string }) => error.code === code)
  checks++
}

async function main() {
  requireLocalReviewDatabase()
  const before = await reviewFingerprints()
  try {
    await db.transaction(async (tx) => {
      const stamp = randomUUID().replaceAll("-", "")
      const [admin, member, outsider] = await tx
        .insert(users)
        .values([
          { name: "Organizer", role: "admin" },
          {
            name: "Current profile name",
            affiliation: "Current profile institute",
            role: "user"
          },
          { name: "Outside reader", role: "user" }
        ])
        .returning()
      const [vocabulary] = await tx
        .insert(vocabularies)
        .values({
          slug: "exercise_" + stamp,
          title: "Materials review",
          createdById: admin.id
        })
        .returning()
      const [community] = await tx
        .insert(communities)
        .values({
          slug: vocabulary.slug,
          vocabularySlug: vocabulary.slug,
          title: vocabulary.title,
          visibility: "members",
          createdById: admin.id
        })
        .returning()
      await tx.insert(members).values({
        communityId: community.id,
        userId: member.id,
        addedById: admin.id
      })
      await configureVocabularyWorkspace(
        tx,
        {
          vocabularySlug: vocabulary.slug,
          metadataEnabled: true,
          matcoreEnabled: true
        },
        admin.id
      )
      const source = await installMatcoreSource(
        tx,
        {
          manifest: MATCORE_STANDARD_MANIFEST,
          vocabularySlug: vocabulary.slug
        },
        admin.id
      )
      const setup = await communityReviewExerciseSetup(
        tx,
        community.id,
        admin.id
      )
      same(
        setup.releases.map((row) => row.id),
        [source.releaseId],
        "Setup exposes only entitled reference versions"
      )
      await denied(
        communityReviewExerciseSetup(tx, community.id, member.id),
        "FORBIDDEN"
      )
      const base = {
        communityId: community.id,
        name: "Dataset examples",
        area: "pf",
        referenceReleaseId: source.releaseId
      }
      const ordinary = await createCommunityReview(tx, base, admin.id)
      same(
        ordinary.datasetExercise,
        null,
        "Existing review behavior keeps the optional exercise off"
      )
      await closeCommunityReview(tx, ordinary.id, admin.id)
      await denied(
        createCommunityReview(
          tx,
          { ...base, area: undefined, datasetExercise: {} },
          admin.id
        ),
        "BAD_REQUEST"
      )
      await denied(
        createCommunityReview(
          tx,
          { ...base, referenceReleaseId: "missing", datasetExercise: {} },
          admin.id
        ),
        "NOT_FOUND"
      )
      const round = await createCommunityReview(
        tx,
        {
          ...base,
          datasetExercise: { sourceDocumentUrl: "https://example.test/review" }
        },
        admin.id
      )
      const [item] = (await getCommunityReview(tx, round.id, member.id)).items
      const initial = await getCommunityReviewExercise(tx, round.id, member.id)
      same(
        initial.config?.referenceReleaseId,
        source.releaseId,
        "Dataset example pins the selected reference version"
      )
      same(
        initial.config?.profile,
        "pf",
        "Dataset example pins the selected section"
      )
      same(initial.own, null, "Reading does not create a dataset example")
      same(
        initial.defaults,
        { reviewerName: member.name, reviewerAffiliation: member.affiliation },
        "Profile provides editable identity defaults"
      )
      await denied(
        getCommunityReviewExercise(tx, round.id, outsider.id),
        "NOT_FOUND"
      )
      const feedback = {
        itemId: item.id,
        response: null,
        comment: "Please specify the units.",
        datasetExerciseRevisionId: null,
        expectedVersion: 0,
        mutationId: randomUUID()
      }
      await denied(
        saveCommunityReview(
          tx,
          { ...feedback, datasetExerciseRevisionId: undefined },
          member.id
        ),
        "BAD_REQUEST"
      )
      const comment = await saveCommunityReview(tx, feedback, member.id)
      same(
        comment.comment,
        feedback.comment,
        "Comment-only feedback persists without an assessment"
      )
      same(
        comment.datasetExerciseRevisionId,
        null,
        "Feedback before an example has no implied dataset evidence"
      )
      same(
        (await requestedCommunityReviews(tx, community.id, member.id))[0]
          .reviewed,
        1,
        "Comment-only feedback counts as reviewed"
      )
      same(
        (await getCommunityReview(tx, round.id, member.id)).items[0].counts,
        { commentOnly: 1 },
        "Comment-only feedback has a separate tally without inventing an assessment"
      )
      const payload = {
        datasetTitle: "Dendritic solidification",
        datasetSource: "Published simulation dataset, specimen A",
        completedXml: "<dataset><mesh>uniform</mesh></dataset>",
        notes: "Units unclear",
        reviewerName: "Submitted name",
        reviewerAffiliation: "Submitted institute"
      }
      const input = {
        roundId: round.id,
        payload,
        expectedVersion: 0,
        mutationId: randomUUID()
      }
      const saved = await saveCommunityReviewExercise(tx, input, member.id)
      same(saved.version, 1, "First dataset example saved")
      const rejectsBinding = async (work: () => Promise<unknown>) => {
        await assert.rejects(work, (error: unknown) => {
          const failure = error as { code?: string; cause?: { code?: string } }
          return (failure.cause?.code ?? failure.code) === "23514"
        })
        checks++
      }
      await rejectsBinding(() =>
        tx.transaction((nested) =>
          nested.insert(responses).values({
            itemId: item.id,
            userId: outsider.id,
            response: "support",
            comment: "",
            version: 1,
            datasetExerciseRevisionId: saved.revisionId
          })
        )
      )
      const [otherItem] = (await getCommunityReview(tx, ordinary.id, member.id))
        .items
      await rejectsBinding(() =>
        tx.transaction((nested) =>
          nested.insert(responses).values({
            itemId: otherItem.id,
            userId: member.id,
            response: "support",
            comment: "",
            version: 1,
            datasetExerciseRevisionId: saved.revisionId
          })
        )
      )
      await rejectsBinding(() =>
        tx.transaction((nested) =>
          nested
            .update(exerciseEvents)
            .set({ payload: { ...payload, notes: "Overwrite old evidence" } })
            .where(eq(exerciseEvents.id, saved.revisionId))
        )
      )
      same(saved.xmlStatus, "well_formed", "XML receives syntax status only")
      same(
        (await getCommunityReviewExercise(tx, round.id, member.id)).own
          ?.payload,
        payload,
        "Dataset XML, source, notes and identity survive reload"
      )
      same(
        (await saveCommunityReviewExercise(tx, input, member.id)).revisionId,
        saved.revisionId,
        "Lost acknowledgement retry returns the same dataset revision"
      )
      same(
        (
          await tx
            .select()
            .from(exerciseEvents)
            .where(eq(exerciseEvents.roundId, round.id))
        ).length,
        1,
        "Retry does not duplicate dataset provenance"
      )
      await denied(
        saveCommunityReviewExercise(
          tx,
          { ...input, mutationId: randomUUID() },
          member.id
        ),
        "CONFLICT"
      )
      await denied(
        saveCommunityReviewExercise(
          tx,
          { ...input, payload: { ...payload, notes: "Changed retry" } },
          member.id
        ),
        "CONFLICT"
      )
      await denied(
        saveCommunityReviewExercise(
          tx,
          { ...input, roundId: ordinary.id },
          member.id
        ),
        "NOT_FOUND"
      )
      await denied(
        saveCommunityReviewExercise(tx, input, outsider.id),
        "NOT_FOUND"
      )
      await denied(
        communityReviewExerciseResults(tx, round.id, member.id),
        "FORBIDDEN"
      )
      await denied(
        communityReviewExerciseRevisions(tx, [item.id], member.id),
        "FORBIDDEN"
      )
      const linked = await saveCommunityReview(
        tx,
        {
          ...feedback,
          datasetExerciseRevisionId: saved.revisionId,
          expectedVersion: 1,
          mutationId: randomUUID()
        },
        member.id
      )
      same(
        linked.datasetExerciseRevisionId,
        saved.revisionId,
        "Field feedback pins the saved dataset revision"
      )
      const revised = await saveCommunityReviewExercise(
        tx,
        {
          ...input,
          payload: {
            ...payload,
            datasetSource: "New dataset source",
            reviewerName: "Revised identity"
          },
          expectedVersion: 1,
          mutationId: randomUUID()
        },
        member.id
      )
      same(revised.version, 2, "Dataset editing creates a new revision")
      await denied(
        saveCommunityReview(
          tx,
          {
            ...feedback,
            datasetExerciseRevisionId: saved.revisionId,
            expectedVersion: 2,
            mutationId: randomUUID()
          },
          member.id
        ),
        "CONFLICT"
      )
      same(
        (await getCommunityReview(tx, round.id, member.id)).items[0].own
          ?.version,
        2,
        "A stale dataset from another tab cannot silently retarget feedback"
      )
      same(
        (await saveCommunityReviewExercise(tx, input, member.id)).version,
        2,
        "Late retry cannot restore an old dataset revision"
      )
      const evidence = await communityReviewExerciseRevisions(
        tx,
        [item.id],
        admin.id
      )
      same(
        evidence[0].revisionId,
        saved.revisionId,
        "Export keeps the dataset revision reviewed with the field"
      )
      same(
        evidence[0].payload.reviewerName,
        payload.reviewerName,
        "Export identity is the contributor's explicit snapshot"
      )
      same(
        "email" in evidence[0] || "email" in evidence[0].payload,
        false,
        "Dataset evidence contains no account email"
      )
      same(
        (await communityReviewExerciseResults(tx, round.id, admin.id))[0]
          .revisionId,
        revised.revisionId,
        "Steward results distinguish the current dataset from pinned feedback evidence"
      )
      await denied(
        saveCommunityReviewExercise(
          tx,
          {
            ...input,
            expectedVersion: 2,
            mutationId: randomUUID(),
            payload: { ...payload, completedXml: "<dataset>" }
          },
          member.id
        ),
        "BAD_REQUEST"
      )
      same(
        (await getCommunityReviewExercise(tx, round.id, member.id)).own
          ?.version,
        2,
        "Malformed XML does not change saved work"
      )
      const withdrawal = await saveCommunityReview(
        tx,
        {
          ...feedback,
          comment: "",
          datasetExerciseRevisionId: saved.revisionId,
          expectedVersion: 2,
          mutationId: randomUUID()
        },
        member.id
      )
      same(
        withdrawal.datasetExerciseRevisionId,
        null,
        "Withdrawal clears current evidence without deleting its history"
      )
      same(
        (await requestedCommunityReviews(tx, community.id, member.id))[0]
          .reviewed,
        0,
        "Withdrawal returns the field to the review queue"
      )
      same(
        await communityReviewExerciseRevisions(tx, [item.id], admin.id),
        [],
        "Packet omits withdrawn current evidence"
      )
      same(
        (
          await tx
            .select()
            .from(feedbackEvents)
            .where(eq(feedbackEvents.itemId, item.id))
        ).length,
        3,
        "Feedback provenance retains every response and withdrawal"
      )
      const [grant] = await tx
        .delete(grants)
        .where(
          and(
            eq(grants.vocabularySlug, vocabulary.slug),
            eq(grants.releaseId, source.releaseId)
          )
        )
        .returning()
      await denied(
        getCommunityReviewExercise(tx, round.id, member.id),
        "NOT_FOUND"
      )
      await denied(
        saveCommunityReviewExercise(
          tx,
          { ...input, expectedVersion: 2, mutationId: randomUUID() },
          member.id
        ),
        "NOT_FOUND"
      )
      await tx.insert(grants).values(grant)
      const started = await startMatcoreSourceChange(
        tx,
        {
          vocabularySlug: vocabulary.slug,
          releaseId: source.releaseId,
          occurrenceId: item.sourceOccurrenceId!
        },
        member.id
      )
      if (started.kind !== "draft")
        throw new Error("Expected a new source proposal draft")
      const sourceDraft = await getMatcoreDraft(tx, started.draftId, member.id)
      const editedDraft = await updateMatcoreDraft(
        tx,
        {
          id: sourceDraft.id,
          expectedVersion: sourceDraft.version,
          mutationId: randomUUID(),
          payload: {
            ...sourceDraft.payload,
            definition: "Clarified synthetic Phase Field definition.",
            rationale: "Clarify this reference version for practitioners."
          }
        },
        member.id
      )
      const proposal = await submitMatcoreDraft(
        tx,
        { id: editedDraft.id, expectedVersion: editedDraft.version },
        member.id
      )
      await reviewMatcoreRevision(
        tx,
        {
          revisionId: proposal.revisionId,
          decision: "accepted",
          reason: "Suitable for this community version."
        },
        admin.id
      )
      const frozenReview = await getCommunityReview(tx, round.id, member.id)
      const frozenExercise = await getCommunityReviewExercise(
        tx,
        round.id,
        member.id
      )
      const frozenDraft = await getMatcoreDraft(tx, sourceDraft.id, member.id)
      const newerManifest = structuredClone(MATCORE_STANDARD_MANIFEST)
      newerManifest.release.version = `v05-synthetic-${stamp}`
      const newerId = `matcore:${newerManifest.release.version}`
      newerManifest.occurrences = newerManifest.occurrences.map((entry) => ({
        ...entry,
        id: entry.id.replace(source.releaseId, newerId)
      }))
      const pfField = newerManifest.fields.find(
        (entry) => entry.source.profileId === "pf"
      )!
      pfField.definition = "A new synthetic reference version definition."
      await installMatcoreSource(
        tx,
        { manifest: newerManifest, vocabularySlug: vocabulary.slug },
        admin.id
      )
      const newerStandard = await getCommunityStandard(
        tx,
        { vocabularySlug: vocabulary.slug, referenceReleaseId: newerId },
        member.id
      )
      const earlierStandard = await getCommunityStandard(
        tx,
        {
          vocabularySlug: vocabulary.slug,
          referenceReleaseId: source.releaseId
        },
        member.id
      )
      same(
        earlierStandard.working.entries.some(
          (entry) => entry.revisionId === proposal.revisionId
        ),
        true,
        "Accepted change stays in the earlier reference working version"
      )
      same(
        newerStandard.working.entries.some(
          (entry) => entry.revisionId === proposal.revisionId
        ),
        false,
        "Earlier accepted change does not silently move into the new reference"
      )
      same(
        newerStandard.proposals.some(
          (entry) => entry.id === proposal.revisionId
        ),
        false,
        "New reference does not claim earlier source proposals"
      )
      same(
        await getCommunityReview(tx, round.id, member.id),
        frozenReview,
        "Installing another reference preserves the old review snapshots and feedback"
      )
      same(
        await getCommunityReviewExercise(tx, round.id, member.id),
        frozenExercise,
        "Dataset XML and source-version binding remain unchanged after a new reference"
      )
      same(
        await getMatcoreDraft(tx, sourceDraft.id, member.id),
        frozenDraft,
        "Existing proposal draft and its provenance stay unchanged"
      )
      await closeCommunityReview(tx, round.id, admin.id)
      await denied(
        saveCommunityReviewExercise(
          tx,
          { ...input, expectedVersion: 2, mutationId: randomUUID() },
          member.id
        ),
        "BAD_REQUEST"
      )
      same(
        (await getCommunityReviewExercise(tx, round.id, member.id)).canSave,
        false,
        "Closed review remains readable without allowing exercise edits"
      )
      const largeAuthors = await tx
        .insert(users)
        .values(
          Array.from({ length: 28 }, (_, index) => ({
            name: `Dataset author ${index}`
          }))
        )
        .returning()
      const largeEvents = await tx
        .insert(exerciseEvents)
        .values(
          largeAuthors.map((author) => ({
            id: randomUUID(),
            roundId: round.id,
            userId: author.id,
            mutationId: randomUUID(),
            inputHash: "test-fixture",
            version: 1,
            xmlStatus: "well_formed" as const,
            payload: {
              ...payload,
              completedXml: "<dataset>" + "a".repeat(195000) + "</dataset>"
            }
          }))
        )
        .returning({ id: exerciseEvents.id, userId: exerciseEvents.userId })
      await tx.insert(exercises).values(
        largeEvents.map((entry) => ({
          roundId: round.id,
          userId: entry.userId,
          revisionId: entry.id,
          version: 1
        }))
      )
      await tx.insert(responses).values(
        largeEvents.map((entry) => ({
          itemId: item.id,
          userId: entry.userId,
          datasetExerciseRevisionId: entry.id,
          response: "support" as const,
          comment: "",
          version: 1
        }))
      )
      await denied(
        communityReviewExerciseResults(tx, round.id, admin.id),
        "BAD_REQUEST"
      )
      await denied(
        communityReviewExerciseRevisions(tx, [item.id], admin.id),
        "BAD_REQUEST"
      )
      console.log(
        "PASS Large dataset results and packet evidence stop before materializing oversized XML"
      )
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  same(
    await reviewFingerprints(),
    before,
    "All pre-existing records preserved after rollback"
  )
  console.log(
    `Community review exercise database tests passed (${checks} checks)`
  )
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      error instanceof Error
        ? error.message.split("\nparams:")[0].slice(0, 1500)
        : error
    )
    process.exit(1)
  })
