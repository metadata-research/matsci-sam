import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq, inArray, sql } from "drizzle-orm"
import {
  db,
  usersTable as users,
  vocabulariesTable as vocabularies,
  communitiesTable as communities,
  communityMembersTable as members,
  termsTable as terms,
  commentsTable as comments,
  votesTable as votes,
  voteEventsTable as voteEvents,
  collectionsTable as collections,
  studiesTable as studies,
  surveyStepsTable as steps,
  matcoreSpecDraftsTable as drafts,
  vocabularyMatcoreSourcesTable as grants,
  contributionFilesTable as files,
  definitionRevisionsTable as definitionRevisions
} from "../drizzle"
import {
  createDefinitionWithInitialRevision,
  publishDefinitionRevision
} from "../lib/definition-revisions"
import {
  configureVocabularyWorkspace,
  createMatcoreDraft,
  submitMatcoreDraft,
  installMatcoreSource,
  reviewMatcoreRevision,
  startMatcoreSourceChange,
  getMatcoreDraft,
  updateMatcoreDraft,
  publishMatcoreDraft
} from "../lib/matcore-workflow"
import { emptyMatcoreDraftPayload } from "../lib/matcore-workflow-types"
import {
  createCommunityReview,
  getCommunityReview,
  saveCommunityReview,
  saveCommunityReviewExercise,
  reviewCandidates
} from "../lib/community-reviews"
import { createCommunityReviewPacket } from "../lib/community-review-packet"
import { type ReviewPacketRequest } from "../lib/community-review-packet-types"
import {
  MATCORE_STANDARD_MANIFEST,
  MATCORE_FIXTURE_RELEASE_ID
} from "./fixtures/matcore-source-fixture"
import {
  requireLocalReviewDatabase,
  reviewFingerprints
} from "./community-review-test-support"

class Rollback extends Error {}
let checks = 0
function same(actual: unknown, expected: unknown, message: string) {
  assert.deepEqual(actual, expected, message)
  checks++
  console.log("PASS " + message)
}
async function rejected(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (error: { code?: string }) => error.code === code)
  checks++
}

async function main() {
  requireLocalReviewDatabase()
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /_(?:test|scratch|ci|qa)(?:_|$)/,
    "Use a disposable test database"
  )
  const before = await reviewFingerprints()
  try {
    await db.transaction(async (tx) => {
      const stamp = randomUUID().replaceAll("-", "")
      const [admin, steward, member, outsider] = await tx
        .insert(users)
        .values([
          { name: "Packet administrator", role: "admin" },
          { name: "Packet steward", role: "user" },
          {
            name: "Feedback respondent",
            role: "user",
            email: `private-${stamp}@example.invalid`
          },
          { name: "Outside member", role: "user" }
        ])
        .returning()
      const [vocab, privateVocab] = await tx
        .insert(vocabularies)
        .values([
          {
            slug: `packet_${stamp}`,
            title: "Materials community",
            createdById: admin.id
          },
          {
            slug: `packet_private_${stamp}`,
            title: "Restricted survey",
            createdById: admin.id
          }
        ])
        .returning()
      const [community, privateCommunity] = await tx
        .insert(communities)
        .values([
          {
            slug: vocab.slug,
            vocabularySlug: vocab.slug,
            title: vocab.title,
            visibility: "members",
            createdById: admin.id
          },
          {
            slug: privateVocab.slug,
            vocabularySlug: privateVocab.slug,
            title: privateVocab.title,
            visibility: "members",
            createdById: admin.id
          }
        ])
        .returning()
      await tx.insert(members).values([
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
      const [term] = await tx
        .insert(terms)
        .values({
          term: "Interface width",
          slug: `interface_width_${stamp}`,
          vocabularySlug: vocab.slug
        })
        .returning()
      const initial = await createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: member.id,
        definition: "A narrow interface region.",
        example: "",
        changeNote: "Initial description",
        source: "initial",
        prompt: "PRIVATE_PROMPT_NOT_EXPORTED"
      })
      const input: ReviewPacketRequest = {
        targets: [`definition:${initial.revision.id}`],
        includeRespondentNames: false,
        includeDatasetExamples: false,
        format: "preview"
      }
      const original = await createCommunityReviewPacket(
        tx,
        community.slug,
        input,
        steward.id
      )
      same(
        original.items[0].after.definition,
        "A narrow interface region.",
        "Ordinary vocabulary packet uses exact stored revision"
      )
      same(
        original.items[0].author,
        member.name,
        "Contribution attribution remains included"
      )
      same(
        JSON.stringify(original).includes(member.email!),
        false,
        "Email excluded"
      )
      same(
        JSON.stringify(original).includes("PRIVATE_PROMPT_NOT_EXPORTED"),
        false,
        "Private model prompt excluded"
      )
      await rejected(
        createCommunityReviewPacket(tx, community.slug, input, member.id),
        "FORBIDDEN"
      )
      await rejected(
        createCommunityReviewPacket(tx, community.slug, input, outsider.id),
        "NOT_FOUND"
      )
      await rejected(
        createCommunityReviewPacket(tx, privateCommunity.slug, input, admin.id),
        "NOT_FOUND"
      )
      const again = await createCommunityReviewPacket(
        tx,
        community.slug,
        input,
        steward.id
      )
      same(
        again.fingerprint,
        original.fingerprint,
        "Fingerprint excludes generation clock"
      )
      const unchanged = await createCommunityReviewPacket(
        tx,
        community.slug,
        { ...input, format: "json", fingerprint: original.fingerprint },
        steward.id
      )
      same(
        unchanged.items,
        original.items,
        "Download uses same sanitized content as preview"
      )
      const bytes = Buffer.from("SOURCE_BYTES_NOT_EXPORTED")
      const uploaded = await tx
        .insert(files)
        .values(
          ["upload", "paste"].map((origin) => ({
            uploadedById: member.id,
            termText: term.term.toLowerCase(),
            vocabularySlug: vocab.slug,
            filename: "source.txt",
            mediaType: "text/plain",
            byteSize: bytes.length,
            contentHash: "a".repeat(64),
            bytes,
            role: "source" as const,
            title: `${origin} reference`,
            caption: "Supports the definition",
            origin: origin as "upload" | "paste"
          }))
        )
        .returning({ id: files.id })
      await tx
        .update(files)
        .set({
          publishedRevisionId: initial.revision.id,
          publishedAt: sql`now()`
        })
        .where(
          inArray(
            files.id,
            uploaded.map((file) => file.id)
          )
        )
      const withSources = await createCommunityReviewPacket(
        tx,
        community.slug,
        input,
        steward.id
      )
      same(
        withSources.items[0].sources.map((source) => source.kind).sort(),
        ["Pasted source, cited", "Uploaded source, cited"],
        "Uploaded and pasted source attribution is retained"
      )
      same(
        JSON.stringify(withSources).includes("SOURCE_BYTES_NOT_EXPORTED"),
        false,
        "Uploaded bytes and pasted text bodies are excluded"
      )

      const round1 = await createCommunityReview(
        tx,
        {
          communityId: community.id,
          name: "First definition review",
          targetIds: input.targets
        },
        steward.id
      )
      const item1 = (await getCommunityReview(tx, round1.id, member.id))
        .items[0]
      await saveCommunityReview(
        tx,
        {
          itemId: item1.id,
          response: "support",
          comment: "The scope is useful.",
          expectedVersion: 0,
          mutationId: randomUUID()
        },
        member.id
      )
      const round2 = await createCommunityReview(
        tx,
        {
          communityId: community.id,
          name: "Second definition review",
          targetIds: input.targets
        },
        steward.id
      )
      const item2 = (await getCommunityReview(tx, round2.id, member.id))
        .items[0]
      await saveCommunityReview(
        tx,
        {
          itemId: item2.id,
          response: "revise",
          comment: "Specify the interface criterion.",
          expectedVersion: 0,
          mutationId: randomUUID()
        },
        member.id
      )
      const reviewed = await createCommunityReviewPacket(
        tx,
        community.slug,
        input,
        steward.id
      )
      same(
        reviewed.items[0].feedback.length,
        2,
        "Separate review rounds remain separate"
      )
      same(
        reviewed.items[0].feedback.map((round) => round.responseCount),
        [1, 1],
        "No cross-round response aggregation"
      )
      same(
        reviewed.items[0].feedback.map((round) => round.revisionId),
        [String(initial.revision.id), String(initial.revision.id)],
        "Responses identify exact revision"
      )
      same(
        reviewed.items[0].feedback[0].comments[0].name,
        undefined,
        "Respondent names omitted by default"
      )
      same(
        reviewed.items[0].feedback[0].respondents,
        undefined,
        "No default named-response appendix"
      )
      const identified = await createCommunityReviewPacket(
        tx,
        community.slug,
        { ...input, includeRespondentNames: true },
        steward.id
      )
      same(
        identified.items[0].feedback[0].respondents?.[0].name,
        member.name,
        "Named responses require explicit option"
      )
      assert.notEqual(identified.fingerprint, reviewed.fingerprint)
      checks++
      await rejected(
        createCommunityReviewPacket(
          tx,
          community.slug,
          { ...input, format: "html", fingerprint: original.fingerprint },
          steward.id
        ),
        "CONFLICT"
      )
      await saveCommunityReview(
        tx,
        {
          itemId: item1.id,
          response: "revise",
          comment: "Use a measurable criterion.",
          expectedVersion: 1,
          mutationId: randomUUID()
        },
        member.id
      )
      await rejected(
        createCommunityReviewPacket(
          tx,
          community.slug,
          { ...input, format: "json", fingerprint: reviewed.fingerprint },
          steward.id
        ),
        "CONFLICT"
      )
      const changedFeedback = await createCommunityReviewPacket(
        tx,
        community.slug,
        input,
        steward.id
      )
      same(
        changedFeedback.items[0].feedback[0].counts.find(
          (count) => count.value === "support"
        )?.count,
        0,
        "Preview reflects changed response instead of adding another vote"
      )
      same(
        changedFeedback.items[0].feedback[0].counts.find(
          (count) => count.value === "revise"
        )?.count,
        1,
        "Updated response counted once"
      )
      await tx
        .update(users)
        .set({ name: "Renamed contributor" })
        .where(eq(users.id, member.id))
      await rejected(
        createCommunityReviewPacket(
          tx,
          community.slug,
          {
            ...input,
            includeRespondentNames: true,
            format: "json",
            fingerprint: identified.fingerprint
          },
          steward.id
        ),
        "CONFLICT"
      )
      const changedName = await createCommunityReviewPacket(
        tx,
        community.slug,
        { ...input, includeRespondentNames: true },
        steward.id
      )
      same(
        changedName.items[0].feedback[0].respondents?.[0].name,
        "Renamed contributor",
        "Named appendix reflects current display name"
      )
      const next = await publishDefinitionRevision(tx, {
        definitionId: initial.definition.id,
        editorId: member.id,
        definition: "A diffuse interface region.",
        example: "",
        changeNote: "Clarify the interface.",
        source: "author_edit",
        expectedRevisionId: initial.revision.id
      })
      const nextPacket = await createCommunityReviewPacket(
        tx,
        community.slug,
        { ...input, targets: [`definition:${next.revision.id}`] },
        steward.id
      )
      same(
        nextPacket.items[0].before?.definition,
        "A narrow interface region.",
        "Comparison uses recorded predecessor"
      )
      same(
        nextPacket.items[0].feedback,
        [],
        "New revision never inherits responses from an earlier one"
      )
      const historical = await createCommunityReviewPacket(
        tx,
        community.slug,
        input,
        steward.id
      )
      same(
        historical.items[0].after.definition,
        "A narrow interface region.",
        "Historical export does not use the current definition mirror"
      )

      const [collection] = await tx
        .insert(collections)
        .values({
          slug: `packet_collection_${stamp}`,
          title: "Survey collection",
          createdById: admin.id
        })
        .returning()
      const [study] = await tx
        .insert(studies)
        .values({
          slug: `packet_study_${stamp}`,
          title: "Restricted survey",
          communityId: privateCommunity.id,
          collectionId: collection.id,
          createdById: admin.id
        })
        .returning()
      // Historical participation can point at survey steps without a term.
      const [step] = await tx
        .insert(steps)
        .values({
          studyId: study.id,
          position: 1,
          kind: "instructions",
          prompt: "Private survey instructions"
        })
        .returning()
      await tx.insert(comments).values([
        {
          definitionId: initial.definition.id,
          revisionId: initial.revision.id,
          userId: member.id,
          authorKind: "human",
          message: "VISIBLE_DISCUSSION"
        },
        {
          definitionId: initial.definition.id,
          revisionId: initial.revision.id,
          userId: member.id,
          authorKind: "human",
          message: "PRIVATE_SURVEY_COMMENT",
          surveyStepId: step.id
        }
      ])
      await tx.insert(votes).values({
        definitionId: initial.definition.id,
        revisionId: initial.revision.id,
        userId: member.id,
        kind: "up"
      })
      await tx.insert(voteEvents).values([
        {
          definitionId: initial.definition.id,
          revisionId: initial.revision.id,
          userId: member.id,
          kind: "up",
          actorKind: "human"
        },
        {
          definitionId: initial.definition.id,
          revisionId: initial.revision.id,
          userId: member.id,
          kind: "up",
          actorKind: "human",
          surveyStepId: step.id
        }
      ])
      const privateFiltered = await createCommunityReviewPacket(
        tx,
        community.slug,
        input,
        steward.id
      )
      same(
        privateFiltered.items[0].discussion.map((comment) => comment.text),
        ["VISIBLE_DISCUSSION"],
        "Community stewardship does not expose private survey comments"
      )
      same(
        privateFiltered.items[0].votes?.up,
        0,
        "Private latest vote does not revive its older public event"
      )
      const adminView = await createCommunityReviewPacket(
        tx,
        community.slug,
        input,
        admin.id
      )
      same(
        adminView.items[0].votes?.up,
        1,
        "Authorized survey viewer sees current exact-revision vote"
      )
      same(
        adminView.items[0].discussion.length,
        2,
        "Authorized survey viewer sees survey discussion"
      )

      await configureVocabularyWorkspace(
        tx,
        {
          vocabularySlug: vocab.slug,
          metadataEnabled: true,
          matcoreEnabled: true
        },
        admin.id
      )
      const payload = emptyMatcoreDraftPayload()
      payload.label = "Interface width"
      payload.definition =
        "Distance over which the order parameter varies between bulk values."
      payload.rationale = "Make the measurement criterion explicit."
      payload.specification.path = "model.interface-width"
      payload.specification.repeatability = "no"
      payload.citations = [
        {
          title: "A source",
          url: "https://example.invalid/reference",
          note: "Relevant section"
        }
      ]
      const draft = await createMatcoreDraft(
        tx,
        { vocabularySlug: vocab.slug, id: randomUUID(), payload },
        member.id
      )
      const proposal = await submitMatcoreDraft(
        tx,
        { id: draft.id, expectedVersion: draft.version },
        member.id
      )
      const mixedInput = {
        ...input,
        targets: [...input.targets, `proposal:${proposal.revisionId}`]
      }
      const mixed = await createCommunityReviewPacket(
        tx,
        community.slug,
        mixedInput,
        steward.id
      )
      same(
        mixed.items.map((item) => item.kind),
        ["definition", "proposal"],
        "One packet includes ordinary definitions and metadata proposals"
      )
      same(
        mixed.items[1].after.rules.find((rule) => rule.label === "Repeatable")
          ?.value,
        "No",
        "Field rules preserved"
      )
      same(
        mixed.items[1].status,
        "awaiting_review",
        "Pending proposals can be exported"
      )
      same(
        mixed.items[1].sources[0].title,
        "A source",
        "Proposal citations preserved"
      )
      await reviewMatcoreRevision(
        tx,
        {
          revisionId: proposal.revisionId,
          decision: "accepted",
          reason: "Accepted after review."
        },
        steward.id
      )
      await rejected(
        createCommunityReviewPacket(
          tx,
          community.slug,
          { ...mixedInput, format: "json", fingerprint: mixed.fingerprint },
          steward.id
        ),
        "CONFLICT"
      )
      const decided = await createCommunityReviewPacket(
        tx,
        community.slug,
        mixedInput,
        steward.id
      )
      same(
        decided.items[1].status,
        "accepted",
        "Decision appears in regenerated packet"
      )
      same(
        decided.items[1].history.at(-1)?.note,
        "Accepted after review.",
        "Steward decision rationale preserved"
      )
      const [draftStillThere] = await tx
        .select({ id: drafts.id })
        .from(drafts)
        .where(eq(drafts.id, draft.id))
      same(draftStillThere.id, draft.id, "Export does not remove source draft")
      await installMatcoreSource(
        tx,
        { manifest: MATCORE_STANDARD_MANIFEST, vocabularySlug: vocab.slug },
        admin.id
      )
      const candidates = await reviewCandidates(
        tx,
        { communityId: community.id, area: "pf" },
        steward.id
      )
      const reference = candidates.candidates.find(
        (item) => item.kind === "reference"
      )!
      const referenceInput = { ...input, targets: [reference.key] }
      const baseline = await createCommunityReviewPacket(
        tx,
        community.slug,
        referenceInput,
        steward.id
      )
      same(
        baseline.items[0].kind,
        "reference",
        "Granted reference entries can be included"
      )
      same(
        baseline.items[0].href.startsWith(`/communities/${community.slug}?`),
        true,
        "Reference links use community identity, not vocabulary identity"
      )
      const exerciseRound = await createCommunityReview(
        tx,
        {
          communityId: community.id,
          name: "Phase Field dataset feedback",
          area: "pf",
          referenceReleaseId: MATCORE_FIXTURE_RELEASE_ID,
          targetIds: [reference.key],
          datasetExercise: {
            sourceDocumentUrl: "https://example.invalid/review"
          }
        },
        steward.id
      )
      const exerciseItem = (
        await getCommunityReview(tx, exerciseRound.id, member.id)
      ).items[0]
      const exercisePayload = {
        datasetTitle: "Interface mobility simulation",
        datasetSource: "Dataset description and repository reference",
        completedXml: "<dataset><mobility>0.2</mobility></dataset>",
        notes: "The units need clarification.",
        reviewerName: "Frozen reviewer identity",
        reviewerAffiliation: "Example laboratory"
      }
      const exercise1 = await saveCommunityReviewExercise(
        tx,
        {
          roundId: exerciseRound.id,
          payload: exercisePayload,
          expectedVersion: 0,
          mutationId: randomUUID()
        },
        member.id
      )
      await saveCommunityReview(
        tx,
        {
          itemId: exerciseItem.id,
          datasetExerciseRevisionId: exercise1.revisionId,
          response: null,
          comment: "Please state the units.",
          expectedVersion: 0,
          mutationId: randomUUID()
        },
        member.id
      )
      const omittedExercise = await createCommunityReviewPacket(
        tx,
        community.slug,
        referenceInput,
        steward.id
      )
      same(
        omittedExercise.datasetExamples,
        [],
        "Dataset examples are excluded by default"
      )
      same(
        omittedExercise.items[0].feedback[0].responseCount,
        1,
        "Comment-only feedback counts as a response in packets"
      )
      same(
        omittedExercise.items[0].feedback[0].counts.every(
          (entry) => entry.count === 0
        ),
        true,
        "Comment-only feedback does not imply a vote"
      )
      const withExerciseInput = {
        ...referenceInput,
        includeDatasetExamples: true
      }
      const withExercise = await createCommunityReviewPacket(
        tx,
        community.slug,
        withExerciseInput,
        steward.id
      )
      same(
        withExercise.datasetExamples.length,
        1,
        "Opt-in includes the example attached to selected feedback"
      )
      same(
        withExercise.datasetExamples[0].revisionId,
        exercise1.revisionId,
        "Packet records the exact example revision"
      )
      same(
        withExercise.datasetExamples[0].reviewerName,
        undefined,
        "Dataset reviewer identity requires independent names opt-in"
      )
      same(
        withExercise.datasetExamples[0].reviewerAffiliation,
        undefined,
        "Dataset affiliation omitted with names"
      )
      same(
        withExercise.items[0].feedback[0].datasetExerciseRevisionIds,
        [exercise1.revisionId],
        "Feedback links to its example appendix"
      )
      const withIdentity = await createCommunityReviewPacket(
        tx,
        community.slug,
        { ...withExerciseInput, includeRespondentNames: true },
        steward.id
      )
      same(
        withIdentity.datasetExamples[0].reviewerName,
        "Frozen reviewer identity",
        "Named dataset appendix uses submitted identity"
      )
      same(
        JSON.stringify(withIdentity).includes(member.email!),
        false,
        "Export never adds account email"
      )
      await saveCommunityReviewExercise(
        tx,
        {
          roundId: exerciseRound.id,
          payload: {
            ...exercisePayload,
            completedXml: "<dataset><mobility>0.4</mobility></dataset>"
          },
          expectedVersion: 1,
          mutationId: randomUUID()
        },
        member.id
      )
      const afterExampleEdit = await createCommunityReviewPacket(
        tx,
        community.slug,
        withExerciseInput,
        steward.id
      )
      same(
        afterExampleEdit.datasetExamples[0].completedXml,
        exercisePayload.completedXml,
        "Later dataset edits do not rewrite feedback evidence"
      )
      same(
        afterExampleEdit.fingerprint,
        withExercise.fingerprint,
        "Unlinked example edits do not invalidate packet snapshot"
      )
      await rejected(
        createCommunityReviewPacket(
          tx,
          community.slug,
          {
            ...withExerciseInput,
            format: "json",
            fingerprint: omittedExercise.fingerprint
          },
          steward.id
        ),
        "CONFLICT"
      )
      await rejected(
        createCommunityReviewPacket(
          tx,
          community.slug,
          withExerciseInput,
          member.id
        ),
        "FORBIDDEN"
      )

      await saveCommunityReview(
        tx,
        {
          itemId: exerciseItem.id,
          response: null,
          comment: "",
          expectedVersion: 1,
          mutationId: randomUUID()
        },
        member.id
      )
      const withdrawnPacket = await createCommunityReviewPacket(
        tx,
        community.slug,
        { ...withExerciseInput, includeRespondentNames: true },
        steward.id
      )
      same(
        withdrawnPacket.items[0].feedback[0].responseCount,
        0,
        "Withdrawn feedback is not counted"
      )
      same(
        withdrawnPacket.items[0].feedback[0].respondents,
        [],
        "Withdrawn feedback has no comment-only named entry"
      )
      same(
        withdrawnPacket.datasetExamples,
        [],
        "Withdrawn feedback no longer exports its dataset example"
      )
      const started = await startMatcoreSourceChange(
        tx,
        {
          vocabularySlug: vocab.slug,
          releaseId: MATCORE_FIXTURE_RELEASE_ID,
          occurrenceId: reference.sourceOccurrenceId!
        },
        member.id
      )
      assert.equal(started.kind, "draft")
      if (started.kind !== "draft") throw new Error("Expected source draft")
      const sourceDraft = await getMatcoreDraft(tx, started.draftId, member.id)
      const sourceEdited = await updateMatcoreDraft(
        tx,
        {
          id: sourceDraft.id,
          expectedVersion: sourceDraft.version,
          mutationId: randomUUID(),
          payload: {
            ...sourceDraft.payload,
            label: "Interface mobility",
            definition: "RESTRICTED_METADATA_PROJECTION_TEXT",
            rationale: "Keep this source-bound proposal separate."
          }
        },
        member.id
      )
      const sourcePublication = await publishMatcoreDraft(
        tx,
        { id: sourceEdited.id, expectedVersion: sourceEdited.version },
        member.id
      )
      const [sourceRevision] = await tx
        .select()
        .from(definitionRevisions)
        .where(
          eq(definitionRevisions.id, sourcePublication.definitionRevisionId!)
        )
      const ordinarySuccessor = await publishDefinitionRevision(tx, {
        definitionId: sourceRevision.definitionId,
        editorId: member.id,
        definition:
          "The coefficient relating interface velocity to its driving force.",
        example: "",
        changeNote: "An independent ordinary revision.",
        source: "author_edit",
        expectedRevisionId: sourceRevision.id
      })
      const ordinaryDerived = await createDefinitionWithInitialRevision(tx, {
        termId: sourcePublication.term!.id,
        authorId: steward.id,
        definition: "An alternative account of interface mobility.",
        example: "",
        changeNote: "An independently worded alternative.",
        source: "initial",
        derivedFromRevisionId: sourceRevision.id
      })
      const sourcePacketInput = {
        ...input,
        targets: [`proposal:${sourcePublication.revisionId}`]
      }
      same(
        (
          await createCommunityReviewPacket(
            tx,
            community.slug,
            sourcePacketInput,
            steward.id
          )
        ).items[0].after.definition,
        "RESTRICTED_METADATA_PROJECTION_TEXT",
        "Granted metadata proposal retains its authorized text"
      )
      await rejected(
        createCommunityReviewPacket(
          tx,
          community.slug,
          { ...input, targets: [`definition:${sourceRevision.id}`] },
          steward.id
        ),
        "BAD_REQUEST"
      )
      await tx.delete(grants).where(eq(grants.vocabularySlug, vocab.slug))
      await rejected(
        createCommunityReviewPacket(
          tx,
          community.slug,
          sourcePacketInput,
          steward.id
        ),
        "NOT_FOUND"
      )
      const protectedHistory = await createCommunityReviewPacket(
        tx,
        community.slug,
        {
          ...input,
          targets: [
            `definition:${ordinarySuccessor.revision.id}`,
            `definition:${ordinaryDerived.revision.id}`
          ]
        },
        steward.id
      )
      same(
        protectedHistory.items.map((item) => item.before),
        [null, null],
        "Ordinary successors and derived candidates cannot export metadata-linked comparison text"
      )
      same(
        protectedHistory.items.map((item) => item.comparisonBasis),
        ["Comparison source unavailable", "Comparison source unavailable"],
        "Omitted metadata comparisons are explicit"
      )
      same(
        protectedHistory.items
          .flatMap((item) => item.history)
          .some((event) => event.revisionId === String(sourceRevision.id)),
        false,
        "Metadata-linked revision notes and actors are excluded from ordinary history"
      )
      same(
        JSON.stringify(protectedHistory).includes(
          "RESTRICTED_METADATA_PROJECTION_TEXT"
        ),
        false,
        "Revoked source text is absent from the entire ordinary packet"
      )
      same(
        protectedHistory.items
          .find(
            (item) => item.revisionId === String(ordinarySuccessor.revision.id)
          )
          ?.limitations.some((note) =>
            note.includes("Metadata-linked revisions are omitted")
          ),
        true,
        "History explains separation from metadata proposals"
      )
      await rejected(
        createCommunityReviewPacket(
          tx,
          community.slug,
          referenceInput,
          steward.id
        ),
        "NOT_FOUND"
      )
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  same(
    await reviewFingerprints(),
    before,
    "All fixture changes rolled back, including existing drafts and provenance"
  )
  await db.transaction(
    async (tx) => {
      const result = await tx.execute<{ isolation: string; readonly: string }>(
        sql`select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as readonly`
      )
      same(
        result.rows[0],
        { isolation: "repeatable read", readonly: "on" },
        "Runtime accepts read-only repeatable-read export transaction"
      )
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  )
  console.log(
    `Community review packet DB tests passed (${checks} checks, fixtures rolled back).`
  )
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
