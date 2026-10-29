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
  communityReviewItemsTable as items,
  communityReviewEventsTable as events,
  communityReviewInvitationsTable as invitations,
  termsTable as terms
} from "../drizzle"
import {
  configureVocabularyWorkspace,
  installMatcoreSource,
  getMatcoreDraft,
  updateMatcoreDraft,
  submitMatcoreDraft
} from "../lib/matcore-workflow"
import {
  reviewCandidates,
  createCommunityReview,
  requestedCommunityReviews,
  getCommunityReview,
  saveCommunityReview,
  communityReviewResults,
  createReviewInvitation,
  reviewInvitation,
  acceptReviewInvitation,
  revokeReviewInvitation,
  closeCommunityReview,
  suggestFromReview
} from "../lib/community-reviews"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import { MATCORE_STANDARD_MANIFEST } from "./fixtures/matcore-source-fixture"
import { normalizeAuthReturnTo } from "../lib/auth-return"
import {
  normalizeCommunityReviewReturn,
  communityReviewHref
} from "../lib/community-review-types"
import {
  requireLocalReviewDatabase,
  reviewFingerprints
} from "./community-review-test-support"
class Rollback extends Error {}
let checks = 0
function same(a: unknown, b: unknown, label: string) {
  assert.deepEqual(a, b, label)
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
          { name: "Review organizer", role: "admin" },
          { name: "Review participant", role: "user" },
          { name: "Conference attendee", role: "user" }
        ])
        .returning()
      const [vocab] = await tx
        .insert(vocabularies)
        .values({
          slug: "review_" + stamp,
          title: "Materials review",
          createdById: admin.id
        })
        .returning()
      const [community] = await tx
        .insert(communities)
        .values({
          slug: vocab.slug,
          vocabularySlug: vocab.slug,
          title: vocab.title,
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
      const candidates = await reviewCandidates(
        tx,
        { communityId: community.id, area: "pf" },
        member.id
      )
      same(
        candidates.candidates.length,
        1,
        "Phase Field scope selects its reference field"
      )
      await denied(
        createCommunityReview(
          tx,
          { communityId: community.id, name: "Not a steward" },
          member.id
        ),
        "FORBIDDEN"
      )
      const round = await createCommunityReview(
        tx,
        { communityId: community.id, area: "pf", name: "Phase Field feedback" },
        admin.id
      )
      await denied(getCommunityReview(tx, round.id, null), "NOT_FOUND")
      await denied(getCommunityReview(tx, round.id, outsider.id), "NOT_FOUND")
      const initial = await getCommunityReview(tx, round.id, member.id),
        item = initial.items[0]
      const requests = await requestedCommunityReviews(
        tx,
        community.id,
        member.id,
        "pf"
      )
      same(
        requests.map((r) => [r.id, r.total, r.reviewed, r.remaining]),
        [[round.id, initial.items.length, 0, initial.items.length]],
        "Open review appears in an ordinary member's requested feedback"
      )
      same(
        new URL(requests[0].href, "http://local").searchParams.get("item"),
        item.id,
        "Requested feedback opens the first unanswered item"
      )
      same(
        await requestedCommunityReviews(tx, community.id, member.id, "dft"),
        [],
        "Requested feedback respects the selected area"
      )
      await denied(
        requestedCommunityReviews(tx, community.id, outsider.id),
        "NOT_FOUND"
      )
      same(
        item.preset.options.map((row) => row.label),
        ["Suitable as written", "Needs revision", "Unable to assess"],
        "Assessment labels are recorded with the item"
      )
      const input = {
        itemId: item.id,
        response: "revise" as const,
        comment: "Please specify the units.",
        expectedVersion: 0,
        mutationId: randomUUID()
      }
      const saved = await saveCommunityReview(tx, input, member.id)
      same(saved.version, 1, "First response saved")
      same(
        (await requestedCommunityReviews(tx, community.id, member.id))[0]
          .reviewed,
        1,
        "Requested feedback counts the member's own response"
      )
      same(
        (await requestedCommunityReviews(tx, community.id, admin.id))[0]
          .reviewed,
        0,
        "Another member's response does not change personal progress"
      )
      same(
        (await saveCommunityReview(tx, input, member.id)).version,
        1,
        "Lost acknowledgement retry is idempotent"
      )
      same(
        (await tx.select().from(events).where(eq(events.itemId, item.id)))
          .length,
        1,
        "Retry does not duplicate response history"
      )
      await denied(
        saveCommunityReview(
          tx,
          { ...input, mutationId: randomUUID() },
          member.id
        ),
        "CONFLICT"
      )
      await denied(
        saveCommunityReview(
          tx,
          { ...input, comment: "Changed retry" },
          member.id
        ),
        "CONFLICT"
      )
      const second = await saveCommunityReview(
        tx,
        {
          ...input,
          response: "support",
          comment: "Units now understood.",
          expectedVersion: 1,
          mutationId: randomUUID()
        },
        member.id
      )
      same(second.version, 2, "A participant can revise a response")
      same(
        (await saveCommunityReview(tx, input, member.id)).version,
        2,
        "A late retry cannot restore the older response"
      )
      const view = await getCommunityReview(tx, round.id, member.id)
      same(
        view.items[0].own?.comment,
        "Units now understood.",
        "Comment survives a fresh read"
      )
      same(view.items[0].counts.support, 1, "Counts use current responses only")
      await denied(communityReviewResults(tx, round.id, member.id), "FORBIDDEN")
      const result = await communityReviewResults(tx, round.id, admin.id)
      same(
        result[0].userId,
        member.id,
        "Organizer results identify the respondent"
      )
      await saveCommunityReview(
        tx,
        {
          ...input,
          response: null,
          comment: "",
          expectedVersion: 2,
          mutationId: randomUUID()
        },
        member.id
      )
      same(
        (await getCommunityReview(tx, round.id, member.id)).items[0].counts
          .support,
        undefined,
        "Withdrawal removes the response from totals"
      )
      same(
        (await tx.select().from(events).where(eq(events.itemId, item.id)))
          .length,
        3,
        "Withdrawal preserves response history"
      )
      const invited = await createReviewInvitation(tx, round.id, 14, admin.id),
        token = invited.href.split("/").at(-1)!
      same(
        normalizeAuthReturnTo(invited.href),
        invited.href,
        "Conference invitation survives signup and sign-in return"
      )
      same(
        (await reviewInvitation(tx, token)).name,
        round.name,
        "Invitation exposes review title without field content"
      )
      same(
        "snapshot" in (await reviewInvitation(tx, token)),
        false,
        "Invitation landing data excludes private snapshots"
      )
      const joined = await acceptReviewInvitation(tx, token, outsider.id)
      same(
        joined.href,
        communityReviewHref(community.slug, round.id, "pf"),
        "Join opens Phase Field review directly"
      )
      same(
        (await getCommunityReview(tx, round.id, outsider.id)).canRespond,
        true,
        "Explicit join grants private review access"
      )
      same(
        (
          await tx
            .select()
            .from(members)
            .where(
              and(
                eq(members.communityId, community.id),
                eq(members.userId, outsider.id)
              )
            )
        ).length,
        1,
        "First join creates one membership"
      )
      await acceptReviewInvitation(tx, token, outsider.id)
      same(
        (
          await tx
            .select()
            .from(members)
            .where(
              and(
                eq(members.communityId, community.id),
                eq(members.userId, outsider.id)
              )
            )
        ).length,
        1,
        "Repeated join is idempotent"
      )
      await tx
        .update(members)
        .set({ removedAt: new Date().toISOString(), removedById: admin.id })
        .where(
          and(
            eq(members.communityId, community.id),
            eq(members.userId, outsider.id)
          )
        )
      await denied(acceptReviewInvitation(tx, token, outsider.id), "FORBIDDEN")
      await denied(
        saveCommunityReview(
          tx,
          { ...input, expectedVersion: 0, mutationId: randomUUID() },
          outsider.id
        ),
        "NOT_FOUND"
      )
      await revokeReviewInvitation(tx, invited.id, admin.id)
      await denied(reviewInvitation(tx, token), "NOT_FOUND")
      const expired = await createReviewInvitation(tx, round.id, 1, admin.id)
      await tx
        .update(invitations)
        .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
        .where(eq(invitations.id, expired.id))
      await denied(
        acceptReviewInvitation(
          tx,
          expired.href.split("/").at(-1)!,
          outsider.id
        ),
        "NOT_FOUND"
      )
      const suggestion = await suggestFromReview(tx, item.id, member.id)
      const draftId = suggestion.href.split("/").at(-1)!.split("?")[0]
      const draft = await getMatcoreDraft(tx, draftId, member.id)
      same(
        draft.payload.definition,
        item.snapshot.definition,
        "Suggest a change starts from the reviewed reference"
      )
      const returnTo = new URLSearchParams(suggestion.href.split("?")[1]).get(
        "reviewReturn"
      )
      same(
        normalizeCommunityReviewReturn(returnTo, community.slug),
        returnTo,
        "Draft has a validated return to the review item"
      )
      same(
        normalizeAuthReturnTo(suggestion.href),
        suggestion.href,
        "Draft context survives authentication"
      )
      const payload = {
        ...draft.payload,
        definition: "The spatial domain used in a phase-field simulation.",
        rationale: "Specify what the domain represents."
      }
      const updated = await updateMatcoreDraft(
        tx,
        {
          id: draftId,
          expectedVersion: draft.version,
          mutationId: randomUUID(),
          payload
        },
        member.id
      )
      await submitMatcoreDraft(
        tx,
        { id: draftId, expectedVersion: updated.version },
        member.id
      )
      const next = await createCommunityReview(
        tx,
        {
          communityId: community.id,
          area: "pf",
          name: "Reference and proposal"
        },
        admin.id
      )
      const nextData = await getCommunityReview(tx, next.id, member.id)
      same(
        nextData.items.map((row) => row.kind),
        ["reference", "proposal"],
        "Review includes both reference and submitted proposal"
      )
      same(
        nextData.items[1].preset.options[0].label,
        "Support this change",
        "Proposal question distinguishes supporting a change"
      )
      const referenceFollowup = await suggestFromReview(tx, item.id, admin.id)
      const followupDraft = await getMatcoreDraft(
        tx,
        referenceFollowup.href.split("/metadata/workspace/")[1].split("?")[0],
        admin.id
      )
      same(
        followupDraft.baseRevisionId,
        nextData.items[1].proposalRevisionId,
        "A reference with a pending proposal opens a private revision of that proposal"
      )
      same(
        (await suggestFromReview(tx, item.id, admin.id)).href,
        referenceFollowup.href,
        "Returning through the reference resumes the same private alternative"
      )
      same(
        (await getCommunityReview(tx, round.id, member.id)).items[0].snapshot,
        item.snapshot,
        "Earlier review snapshot remains unchanged"
      )
      await closeCommunityReview(tx, round.id, admin.id)
      same(
        (await requestedCommunityReviews(tx, community.id, member.id)).some(
          (r) => r.id === round.id
        ),
        false,
        "Closed reviews leave Requested feedback"
      )
      await denied(
        saveCommunityReview(
          tx,
          { ...input, expectedVersion: 3, mutationId: randomUUID() },
          member.id
        ),
        "BAD_REQUEST"
      )
      await denied(
        createReviewInvitation(tx, round.id, 14, admin.id),
        "BAD_REQUEST"
      )
      same(
        (await getCommunityReview(tx, round.id, member.id)).canRespond,
        false,
        "Closed reviews retain responses but reject new saves"
      )
      await assert.rejects(
        tx.transaction(async (inner) => {
          await inner
            .update(items)
            .set({ snapshot: { ...item.snapshot, definition: "tampered" } })
            .where(eq(items.id, item.id))
        })
      )
      checks++
      const [regular] = await tx
        .insert(vocabularies)
        .values({
          slug: "regular_" + stamp,
          title: "Materials vocabulary",
          createdById: admin.id
        })
        .returning()
      const [ordinary] = await tx
        .insert(communities)
        .values({
          slug: regular.slug,
          vocabularySlug: regular.slug,
          title: regular.title,
          createdById: admin.id
        })
        .returning()
      const [term] = await tx
        .insert(terms)
        .values({
          term: "Solid electrolyte",
          slug: "solid_electrolyte",
          vocabularySlug: regular.slug
        })
        .returning()
      await createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: admin.id,
        definition: "A solid material that conducts ions.",
        example: "",
        source: "initial",
        changeNote: "Initial definition"
      })
      const regularRound = await createCommunityReview(
        tx,
        {
          communityId: ordinary.id,
          name: "Definition feedback",
          style: "up_down"
        },
        admin.id
      )
      const regularData = await getCommunityReview(
        tx,
        regularRound.id,
        member.id
      )
      same(
        regularData.items[0].kind,
        "definition",
        "Ordinary communities use definition revisions"
      )
      same(
        regularData.items[0].preset.options.map((row) => row.label),
        ["Upvote", "Downvote"],
        "Reusable up/down preset"
      )
      same(
        regularData.canRespond,
        false,
        "A public reader must join before responding"
      )
      await denied(
        saveCommunityReview(
          tx,
          {
            ...input,
            itemId: regularData.items[0].id,
            mutationId: randomUUID()
          },
          member.id
        ),
        "FORBIDDEN"
      )
      same(
        normalizeCommunityReviewReturn("https://example.com"),
        null,
        "External review return rejected"
      )
      same(
        normalizeCommunityReviewReturn(returnTo, "another_community"),
        null,
        "Cross-community draft return rejected"
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
  console.log(`Community review database tests passed (${checks} checks)`)
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
