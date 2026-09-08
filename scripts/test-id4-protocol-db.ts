// Run only against an empty migrated scratch database. This test deliberately
// uses the published study slug to exercise its real router and SQL policy.
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external"
import { eq, sql } from "drizzle-orm"
import * as schema from "../drizzle"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import { acceptPositionCandidate } from "../lib/survey-positions"
import { castVote } from "../lib/participation"
import { planSteps, DEFAULT_QUESTIONS, recordCompletion } from "../lib/surveys"
import {
  recordResponse,
  studyProgress,
  walkthroughOf
} from "../lib/survey-queries"
import { studyBySlug, studiesOfViewer } from "../lib/study-queries"
import { ID4_ROUND_TWO, ID4_INSTRUCTIONS } from "../lib/study-protocol"
import { commentsRouter } from "../trpc/routers/comments"
import { definitionsRouter } from "../trpc/routers/definitions"
import { surveysRouter, requireStepForAct } from "../trpc/routers/surveys"
import { createCallerFactory } from "../trpc/init"
import { joinOpenStudy } from "../lib/study-enrollment"
import { hashOneTimeToken } from "../lib/auth-tokens"
import { invitationForToken, membershipIn } from "../lib/community-queries"

const {
  db,
  usersTable,
  vocabulariesTable,
  communitiesTable,
  communityMembersTable,
  collectionsTable,
  studiesTable,
  termsTable,
  surveyStepsTable
} = schema

async function main() {
  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
  assert.equal(
    existing.count,
    0,
    "Refusing to run the ID4 fixture in a populated database"
  )
  const fixture = await db.transaction(async (tx) => {
    const [fresh, returning, author] = await tx
      .insert(usersTable)
      .values([
        { name: "ID4 test new participant" },
        { name: "ID4 test returning participant" },
        { name: "ID4 test author" }
      ])
      .returning({ id: usersTable.id })
    await tx
      .insert(vocabulariesTable)
      .values({ slug: "id4_test", title: "ID4 test", createdById: author.id })
    const [community] = await tx
      .insert(communitiesTable)
      .values({
        slug: "id4_test",
        vocabularySlug: "id4_test",
        title: "ID4 test",
        createdById: author.id
      })
      .returning()
    await tx.insert(communityMembersTable).values(
      [fresh, returning].map((user) => ({
        communityId: community.id,
        userId: user.id,
        role: "member" as const,
        addedById: author.id
      }))
    )
    const [collection] = await tx
      .insert(collectionsTable)
      .values({
        slug: "id4_test",
        title: "ID4 test",
        assertableBy: "curator",
        createdById: author.id
      })
      .returning()
    const terms = await tx
      .insert(termsTable)
      .values(
        Array.from({ length: 8 }, (_, i) => ({
          vocabularySlug: "id4_test",
          term: `Test term ${i + 1}`,
          slug: `term_${i + 1}`
        }))
      )
      .returning()
    const [study] = await tx
      .insert(studiesTable)
      .values({
        slug: ID4_ROUND_TWO,
        title: "ID4 round two test",
        communityId: community.id,
        collectionId: collection.id,
        welcome: "Original two-round instructions",
        createdById: author.id
      })
      .returning()
    const steps = await tx
      .insert(surveyStepsTable)
      .values(
        planSteps({
          welcome: study.welcome,
          terms,
          questions: DEFAULT_QUESTIONS
        }).map((step) => ({ ...step, studyId: study.id }))
      )
      .returning()
    const candidates = []
    for (const term of terms) {
      const candidate = await createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: author.id,
        definition: `The definition of ${term.term}.`,
        example: "",
        changeNote: "ID4 test fixture",
        source: "initial"
      })
      candidates.push({
        definitionId: candidate.definition.id,
        revisionId: candidate.definition.currentRevisionId!,
        termId: term.id
      })
    }
    // Seed authentic old-protocol records through the same lower-level writes
    // used before the amendment. They must not be rewritten or reattributed.
    await recordCompletion(tx, { stepId: steps[0].id, userId: returning.id })
    for (let i = 0; i < 8; i++)
      await acceptPositionCandidate(tx, {
        ...candidates[i],
        stepId: steps[i + 1].id,
        userId: returning.id,
        actorKind: "human",
        communityId: community.id
      })
    await recordCompletion(tx, { stepId: steps[9].id, userId: returning.id })
    await castVote(tx, {
      ...candidates[1],
      userId: returning.id,
      actorKind: "human",
      vote: "down",
      surveyStepId: steps[10].id,
      communityId: community.id
    })
    await recordResponse(tx, {
      stepId: steps[17].id,
      userId: returning.id,
      authorKind: "human",
      valueScale: 4
    })
    // A pre-existing upvote must count as a study choice without a second point.
    await castVote(tx, {
      ...candidates[0],
      userId: fresh.id,
      actorKind: "human",
      vote: "up",
      surveyStepId: null,
      communityId: null
    })
    await tx.insert(schema.communityInvitationsTable).values({
      communityId: community.id,
      studyId: study.id,
      email: "id4-test-invite@example.invalid",
      tokenHash: hashOneTimeToken("id4-test-invite"),
      invitedById: author.id,
      expiresAt: new Date(Date.now() + 86400000).toISOString()
    })
    return { fresh, returning, author, study, steps, candidates }
  })
  const before = await db.query.surveyStepsTable.findMany({
    where: eq(surveyStepsTable.studyId, fixture.study.id)
  })
  const makeCaller = createCallerFactory(surveysRouter)
  const caller = (id: number) =>
    makeCaller({ session: { id } } as unknown as Parameters<
      typeof makeCaller
    >[0])
  const fresh = caller(fixture.fresh.id)
  const returning = caller(fixture.returning.id)
  const input = { expectedInstructions: ID4_INSTRUCTIONS }

  assert.equal(
    (await invitationForToken("id4-test-invite"))?.study?.welcome,
    ID4_INSTRUCTIONS
  )
  await assert.rejects(
    makeCaller({ session: {} } as unknown as Parameters<
      typeof makeCaller
    >[0]).join({ studySlug: ID4_ROUND_TWO }),
    { code: "UNAUTHORIZED" }
  )
  assert.equal(
    await membershipIn(fixture.study.communityId, fixture.author.id),
    null
  )
  await assert.rejects(
    caller(fixture.author.id).completeStep({
      ...input,
      stepId: fixture.steps[0].id
    }),
    { code: "FORBIDDEN" }
  )
  await Promise.all([
    joinOpenStudy(ID4_ROUND_TWO, fixture.author.id),
    joinOpenStudy(ID4_ROUND_TWO, fixture.author.id)
  ])
  assert.deepEqual(
    await membershipIn(fixture.study.communityId, fixture.author.id),
    { role: "member" }
  )
  const joinedRows = await db.query.communityMembersTable.findMany({
    where: eq(communityMembersTable.userId, fixture.author.id)
  })
  assert.equal(joinedRows.length, 1, "Repeated joins create one membership")
  assert.equal(joinedRows[0].addedById, fixture.author.id)
  assert.equal(
    (await caller(fixture.author.id).get({ studySlug: ID4_ROUND_TWO }))
      .completedStepIds.length,
    0,
    "Joining creates no study response"
  )
  assert.equal(
    (
      await db.query.usersTable.findFirst({
        where: eq(usersTable.id, fixture.author.id)
      })
    )?.activeCommunityId,
    fixture.study.communityId
  )

  const [privateStudy] = await db
    .insert(studiesTable)
    .values({
      slug: "invitation_only_test",
      title: "Invitation-only test study",
      communityId: fixture.study.communityId,
      collectionId: fixture.study.collectionId,
      createdById: fixture.author.id
    })
    .returning()
  await assert.rejects(joinOpenStudy(privateStudy.slug, fixture.author.id), {
    code: "FORBIDDEN"
  })
  await db
    .update(studiesTable)
    .set({ closesAt: new Date(Date.now() - 1000).toISOString() })
    .where(eq(studiesTable.id, fixture.study.id))
  await assert.rejects(joinOpenStudy(ID4_ROUND_TWO, fixture.fresh.id), {
    code: "BAD_REQUEST"
  })
  await db
    .update(studiesTable)
    .set({ closesAt: null })
    .where(eq(studiesTable.id, fixture.study.id))

  const publicWalk = await walkthroughOf(db, fixture.study.id, null)
  assert.equal(publicWalk.steps.length, 11)
  assert.deepEqual(publicWalk.earlierSteps, [])
  assert.deepEqual(publicWalk.completedStepIds, [])
  const oldWalk = await returning.get({ studySlug: ID4_ROUND_TWO })
  assert.equal(oldWalk.resumePosition, 11)
  assert.equal(oldWalk.completedStepIds.length, 10)
  assert.equal(oldWalk.earlierSteps.length, 2)
  assert.equal(oldWalk.earlierSteps[1].completed, false)
  assert.equal(oldWalk.earlierSteps[1].reviewRecord?.votes[0].kind, "down")
  assert.equal(oldWalk.steps[9].response?.valueScale, 4)
  assert.equal((await studyBySlug(ID4_ROUND_TWO))?.steps, 11)
  assert.equal(
    (await studiesOfViewer(fixture.returning.id)).find(
      (study) => study.slug === ID4_ROUND_TWO
    )!.saved,
    10
  )
  assert.equal((await studyProgress(db, fixture.study.id))?.total, 11)

  await assert.rejects(
    fresh.completeStep({
      stepId: fixture.steps[0].id,
      expectedInstructions: "Original two-round instructions"
    }),
    { code: "CONFLICT" }
  )
  await assert.rejects(
    fresh.completeStep({ ...input, stepId: fixture.steps[9].id }),
    { code: "CONFLICT" }
  )
  await requireStepForAct(fixture.steps[1].id, fixture.fresh.id, {
    kind: "define",
    termId: fixture.candidates[0].termId
  })
  await assert.rejects(
    requireStepForAct(fixture.steps[9].id, fixture.fresh.id, {
      kind: "comment",
      termId: fixture.candidates[0].termId
    }),
    { code: "CONFLICT" }
  )

  assert.equal(
    (await fresh.completeStep({ ...input, stepId: fixture.steps[0].id }))
      .nextPosition,
    2
  )
  const comments = createCallerFactory(commentsRouter)({
    session: { id: fixture.fresh.id }
  } as never)
  const definitions = createCallerFactory(definitionsRouter)({
    session: { id: fixture.fresh.id }
  } as never)
  const commentInput = {
    ...input,
    id: fixture.candidates[0].definitionId,
    revisionId: fixture.candidates[0].revisionId,
    surveyStepId: fixture.steps[1].id,
    comment: "A public comment before accepting."
  }
  await assert.rejects(
    comments.create({
      ...commentInput,
      expectedInstructions: "Old vote-only instructions"
    }),
    { code: "CONFLICT" }
  )
  await assert.rejects(
    comments.create({
      ...commentInput,
      id: fixture.candidates[1].definitionId,
      revisionId: fixture.candidates[1].revisionId
    }),
    { code: "BAD_REQUEST" }
  )
  await comments.create(commentInput)
  await comments.create({
    ...commentInput,
    comment: "A second comment, still no position."
  })
  const withComment = await fresh.get({ studySlug: ID4_ROUND_TWO })
  assert.equal(withComment.steps[1].completed, false)
  assert.equal(withComment.steps[1].held, null)
  assert.equal(withComment.steps[1].reviewRecord?.comments.length, 2)
  assert.equal(withComment.resumePosition, 2)
  await assert.rejects(
    fresh.completeStep({ ...input, stepId: fixture.steps[1].id }),
    { code: "PRECONDITION_FAILED" }
  )
  assert.equal(
    (await returning.get({ studySlug: ID4_ROUND_TWO })).steps[1].reviewRecord
      ?.comments.length,
    0
  )
  for (let i = 0; i < 5; i++) {
    const result = await fresh.acceptPosition({
      ...input,
      ...fixture.candidates[i],
      stepId: fixture.steps[i + 1].id
    })
    assert.equal(result.nextPosition, i + 3)
  }
  await assert.rejects(comments.create(commentInput), { code: "CONFLICT" })
  await comments.create({
    ...commentInput,
    id: fixture.candidates[5].definitionId,
    revisionId: fixture.candidates[5].revisionId,
    surveyStepId: fixture.steps[6].id,
    comment: "This definition needs a narrower scope."
  })
  await definitions.create({
    ...input,
    term: "Test term 6",
    definition: "A revised definition with a narrower scope.",
    surveyStepId: fixture.steps[6].id,
    derivedFromRevisionId: fixture.candidates[5].revisionId
  })
  await definitions.create({
    ...input,
    term: "Test term 7",
    definition: "A new participant-authored definition.",
    surveyStepId: fixture.steps[7].id
  })
  const authored = await fresh.get({ studySlug: ID4_ROUND_TWO })
  assert.equal(authored.resumePosition, 9)
  assert.equal(authored.steps[6].held?.kind, "proposed")
  assert.equal(
    authored.steps[6].held?.refinedFromId,
    fixture.candidates[5].definitionId
  )
  assert.equal(authored.steps[7].held?.kind, "proposed")
  assert.equal(authored.steps[7].held?.refinedFromId, null)
  assert.equal(
    authored.steps[6].reviewRecord?.votes.length,
    0,
    "Revision publication does not cast a vote"
  )
  assert.equal(
    authored.steps[7].reviewRecord?.votes.length,
    0,
    "Proposal publication does not cast a vote"
  )
  const afterAccept = await db.query.definitionsTable.findFirst({
    where: eq(schema.definitionsTable.id, fixture.candidates[0].definitionId)
  })
  assert.equal(
    afterAccept?.score,
    2,
    "Returning vote and pre-existing fresh vote, without double counting"
  )
  const skip = await fresh.skipTerm({ ...input, stepId: fixture.steps[8].id })
  assert.equal(skip.nextPosition, 10)
  assert.equal(
    skip.skippedStepIds.length,
    2,
    "Retain the paired-skip database invariant"
  )
  const midway = await fresh.get({ studySlug: ID4_ROUND_TWO })
  assert.equal(midway.completedStepIds.length, 9)
  assert.equal(midway.steps[9].id, fixture.steps[17].id)
  assert.deepEqual(
    midway.earlierSteps,
    [],
    "A new paired skip is not an earlier review response"
  )
  assert.equal(
    (
      await fresh.answerQuestion({
        ...input,
        stepId: fixture.steps[17].id,
        valueScale: 5
      })
    ).nextPosition,
    11
  )
  assert.equal(
    (
      await fresh.answerQuestion({
        ...input,
        stepId: fixture.steps[18].id,
        valueText: "The seventh term needs a clearer example."
      })
    ).nextPosition,
    null
  )
  await returning.answerQuestion({
    ...input,
    stepId: fixture.steps[18].id,
    valueText: "Returning participant feedback."
  })
  const finished = await fresh.get({ studySlug: ID4_ROUND_TWO })
  assert.equal(finished.completedStepIds.length, 11)
  assert.equal(finished.resumePosition, null)
  assert.equal(
    (await studiesOfViewer(fixture.fresh.id)).find(
      (study) => study.slug === ID4_ROUND_TWO
    )!.saved,
    11
  )
  assert.equal((await studyProgress(db, fixture.study.id))?.finished, 2)
  assert.deepEqual(
    await db.query.surveyStepsTable.findMany({
      where: eq(surveyStepsTable.studyId, fixture.study.id)
    }),
    before
  )
  assert.equal(
    (await returning.get({ studySlug: ID4_ROUND_TWO })).steps[9].response
      ?.valueScale,
    4
  )
  console.log(
    "ID4 accepting, revising, proposing, comments, both closing questions, open joining, saved records and protocol guards passed"
  )
}

// Router publication revalidates routes. Supply Next's request work context
// so these real writes can run outside the HTTP server without mocking them.
workAsyncStorage
  .run(
    { route: "/api/trpc", incrementalCache: {} } as unknown as Parameters<
      typeof workAsyncStorage.run
    >[0],
    main
  )
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
