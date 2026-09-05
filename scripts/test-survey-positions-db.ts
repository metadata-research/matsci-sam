/*
 * Exercise survey position recording against a migrated throwaway database:
 * Accept is idempotent and retains its exact target, while Skip this term
 * records the Position and Review outcomes together without creating a
 * vocabulary act. The fixture is committed and removed in finally.
 */

import assert from "node:assert/strict"
import { and, eq, inArray, sql } from "drizzle-orm"

const STAMP = `${Date.now().toString(36)}${process.pid}`
const INSTRUCTIONS = `Survey position test instructions ${STAMP}.`

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must point at a migrated database")
    process.exit(2)
  }

  const {
    collectionsTable,
    commentsTable,
    communitiesTable,
    communityMembersTable,
    db,
    definitionRevisionsTable,
    definitionsTable,
    studiesTable,
    studyDefinitionExclusionsTable,
    surveyStepCompletionsTable,
    surveyStepPositionsTable,
    surveyStepsTable,
    termsTable,
    usersTable,
    vocabulariesTable,
    voteEventsTable
  } = await import("../drizzle")
  const { createDefinitionWithInitialRevision } = await import(
    "../lib/definition-revisions"
  )
  const { acceptPositionCandidate } = await import("../lib/survey-positions")
  const { deleteDefinitionRows } = await import("../lib/definition-purge")
  const { lockStudy } = await import("../lib/survey-queries")
  const { commentsRouter } = await import("../trpc/routers/comments")
  const { surveysRouter } = await import("../trpc/routers/surveys")
  const { votesRouter } = await import("../trpc/routers/votes")
  const { setStudyCandidateExcluded } = await import("../lib/study-candidates")
  const { definitionsRouter } = await import("../trpc/routers/definitions")
  const { adminStudiesRouter } = await import("../trpc/routers/admin-studies")
  const { createCallerFactory } = await import("../trpc/init")

  const day = 24 * 60 * 60 * 1000
  let fixture:
    | {
        participantId: number
        authorId: number
        vocabularySlug: string
        communityId: number
        collectionId: number
        termId: number
        skippedTermId: number
        studyId: number
        otherStudyId: number
        otherDefineStepId: number
        instructionsStepId: number
        defineStepId: number
        reviewStepId: number
        skippedDefineStepId: number
        skippedReviewStepId: number
        definitionIds: number[]
      }
    | undefined

  try {
    fixture = await db.transaction(async (tx) => {
      // One original definition per author and term, so the two candidates
      // need an author who is not the accepting participant.
      const [participant, author] = await tx
        .insert(usersTable)
        .values([
          { name: `Survey position test participant ${STAMP}` },
          { name: `Survey position test author ${STAMP}` }
        ])
        .returning({ id: usersTable.id })

      const vocabularySlug = `survey_position_test_${STAMP}`
      await tx.insert(vocabulariesTable).values({
        slug: vocabularySlug,
        title: `Survey position test ${STAMP}`,
        createdById: participant.id
      })
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug: vocabularySlug,
          vocabularySlug,
          title: `Survey position test community ${STAMP}`,
          createdById: participant.id
        })
        .returning({ id: communitiesTable.id })
      await tx.insert(communityMembersTable).values({
        communityId: community.id,
        userId: participant.id,
        role: "member",
        addedById: participant.id
      })

      const [collection] = await tx
        .insert(collectionsTable)
        .values({
          slug: `survey_position_test_${STAMP}`,
          title: `Survey position test collection ${STAMP}`,
          assertableBy: "curator",
          createdById: participant.id
        })
        .returning({ id: collectionsTable.id })

      const [term, skippedTerm] = await tx
        .insert(termsTable)
        .values([
          {
            vocabularySlug,
            term: `survey position test term ${STAMP}`,
            slug: `survey_position_test_term_${STAMP}`
          },
          {
            vocabularySlug,
            term: `survey skipped term ${STAMP}`,
            slug: `survey_skipped_term_${STAMP}`
          }
        ])
        .returning({ id: termsTable.id })

      const [study] = await tx
        .insert(studiesTable)
        .values({
          slug: `survey-position-test-${STAMP}`,
          communityId: community.id,
          collectionId: collection.id,
          title: `Survey position test study ${STAMP}`,
          opensAt: new Date(Date.now() - day).toISOString(),
          closesAt: new Date(Date.now() + day).toISOString(),
          createdById: participant.id
        })
        .returning({ id: studiesTable.id })

      const [
        instructionsStep,
        defineStep,
        skippedDefineStep,
        reviewStep,
        skippedReviewStep
      ] = await tx
        .insert(surveyStepsTable)
        .values([
          {
            studyId: study.id,
            position: 1,
            kind: "instructions",
            prompt: INSTRUCTIONS
          },
          {
            studyId: study.id,
            position: 2,
            kind: "define",
            termId: term.id,
            prompt: `Take a position on the test term ${STAMP}.`
          },
          {
            studyId: study.id,
            position: 3,
            kind: "define",
            termId: skippedTerm.id,
            prompt: `Take a position or skip the second test term ${STAMP}.`
          },
          {
            studyId: study.id,
            position: 4,
            kind: "review",
            termId: term.id,
            prompt: `Review the test term ${STAMP}.`
          },
          {
            studyId: study.id,
            position: 5,
            kind: "review",
            termId: skippedTerm.id,
            prompt: `Review the second test term ${STAMP}.`
          }
        ])
        .returning({ id: surveyStepsTable.id })

      const [otherStudy] = await tx
        .insert(studiesTable)
        .values({
          slug: `survey_position_other_${STAMP}`,
          title: "Another study using the same terms",
          communityId: community.id,
          collectionId: collection.id,
          createdById: participant.id
        })
        .returning({ id: studiesTable.id })
      const [otherDefineStep] = await tx
        .insert(surveyStepsTable)
        .values({
          studyId: otherStudy.id,
          position: 1,
          kind: "define",
          termId: term.id,
          prompt: "Choose a definition."
        })
        .returning({ id: surveyStepsTable.id })

      const first = await createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: author.id,
        definition: "The candidate the participant accepts first.",
        example: "",
        changeNote: "survey position fixture",
        source: "initial"
      })
      const second = await createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: participant.id,
        definition: "The candidate accepted again after the purge.",
        example: "",
        changeNote: "survey position fixture",
        source: "initial"
      })
      const skippedCandidate = await createDefinitionWithInitialRevision(tx, {
        termId: skippedTerm.id,
        authorId: author.id,
        definition: "The candidate that must remain unchanged when skipped.",
        example: "",
        changeNote: "survey skip fixture",
        source: "initial"
      })

      return {
        participantId: participant.id,
        authorId: author.id,
        vocabularySlug,
        communityId: community.id,
        collectionId: collection.id,
        termId: term.id,
        skippedTermId: skippedTerm.id,
        studyId: study.id,
        otherStudyId: otherStudy.id,
        otherDefineStepId: otherDefineStep.id,
        instructionsStepId: instructionsStep.id,
        defineStepId: defineStep.id,
        reviewStepId: reviewStep.id,
        skippedDefineStepId: skippedDefineStep.id,
        skippedReviewStepId: skippedReviewStep.id,
        definitionIds: [
          first.definition.id,
          second.definition.id,
          skippedCandidate.definition.id
        ]
      }
    })

    const committed = fixture
    const [firstDefinitionId, secondDefinitionId, skippedDefinitionId] =
      committed.definitionIds
    const currentRevisionIdOf = async (definitionId: number) => {
      const definition = await db.query.definitionsTable.findFirst({
        columns: { currentRevisionId: true },
        where: eq(definitionsTable.id, definitionId)
      })
      assert.ok(definition?.currentRevisionId)
      return definition.currentRevisionId
    }
    const firstRevisionId = await currentRevisionIdOf(firstDefinitionId)

    // The context a signed-in request carries: baseProcedure reads only the
    // session id from it.
    const callerContext = {
      session: { id: committed.participantId }
    }
    const callerFor = createCallerFactory(surveysRouter)
    const caller = callerFor(
      callerContext as unknown as Parameters<typeof callerFor>[0]
    )
    const voteCallerFor = createCallerFactory(votesRouter)
    const voteCaller = voteCallerFor(
      callerContext as unknown as Parameters<typeof voteCallerFor>[0]
    )
    const commentCallerFor = createCallerFactory(commentsRouter)
    const commentCaller = commentCallerFor(
      callerContext as unknown as Parameters<typeof commentCallerFor>[0]
    )

    // Study exclusions filter candidates, refuse stale actions and restore
    // without changing the definition or contributions.
    const definitionCallerFor = createCallerFactory(definitionsRouter)
    const definitionCaller = definitionCallerFor(
      callerContext as unknown as Parameters<typeof definitionCallerFor>[0]
    )
    const adminCallerFor = createCallerFactory(adminStudiesRouter)
    const nonAdminCaller = adminCallerFor(
      callerContext as unknown as Parameters<typeof adminCallerFor>[0]
    )
    const exclusionInput = {
      studyId: committed.studyId,
      definitionId: firstDefinitionId,
      excluded: true,
      expectedExclusionId: null,
      reason: "This candidate concerns a different term.",
      userId: committed.authorId
    }
    await assert.rejects(nonAdminCaller.setCandidateExcluded(exclusionInput), {
      code: "FORBIDDEN"
    })
    await assert.rejects(
      setStudyCandidateExcluded({ ...exclusionInput, reason: "  " }),
      { code: "BAD_REQUEST" }
    )
    await assert.rejects(
      setStudyCandidateExcluded({
        ...exclusionInput,
        definitionId: 2147483647
      }),
      { code: "BAD_REQUEST" }
    )
    const races = await Promise.allSettled([
      setStudyCandidateExcluded(exclusionInput),
      setStudyCandidateExcluded(exclusionInput)
    ])
    assert.equal(
      races.filter((result) => result.status === "fulfilled").length,
      1,
      "concurrent exclusions produce one interval"
    )
    const exclusionHistory = () =>
      db
        .select()
        .from(studyDefinitionExclusionsTable)
        .where(
          eq(studyDefinitionExclusionsTable.definitionId, firstDefinitionId)
        )
    const [exclusion] = await exclusionHistory()
    assert.ok(exclusion)
    assert.equal(exclusion.excludedById, committed.authorId)
    const active = await definitionCaller.list({
      termId: committed.termId,
      surveyStepId: committed.defineStepId
    })
    assert.deepEqual(
      active.map((candidate) => candidate.id),
      [secondDefinitionId]
    )
    const general = await definitionCaller.list({ termId: committed.termId })
    assert.equal(
      general.length,
      2,
      "the vocabulary still contains both definitions"
    )
    assert.ok(general.every((candidate) => !candidate.excludedFromStudy))
    const anotherStudy = await definitionCaller.list({
      termId: committed.termId,
      surveyStepId: committed.otherDefineStepId
    })
    assert.equal(
      anotherStudy.length,
      2,
      "the same definitions remain available in another study"
    )
    assert.ok(anotherStudy.every((candidate) => !candidate.excludedFromStudy))
    const historical = await definitionCaller.list({
      termId: committed.termId,
      surveyStepId: committed.reviewStepId,
      includeExcluded: true
    })
    assert.equal(historical.length, 2)
    assert.ok(
      historical.find((candidate) => candidate.id === firstDefinitionId)
        ?.excludedFromStudy
    )
    await assert.rejects(
      definitionCaller.list({
        termId: committed.termId,
        surveyStepId: committed.skippedDefineStepId
      }),
      { code: "BAD_REQUEST" }
    )

    const target = {
      definitionId: firstDefinitionId,
      revisionId: firstRevisionId,
      expectedInstructions: INSTRUCTIONS
    }
    await assert.rejects(
      caller.acceptPosition({ ...target, stepId: committed.defineStepId }),
      /excluded from this study/
    )
    await assert.rejects(
      voteCaller.vote({
        ...target,
        surveyStepId: committed.defineStepId,
        vote: "up"
      }),
      /excluded from this study/
    )
    await assert.rejects(
      voteCaller.vote({
        ...target,
        surveyStepId: committed.reviewStepId,
        vote: "down"
      }),
      /excluded from this study/
    )
    await assert.rejects(
      commentCaller.create({
        id: firstDefinitionId,
        revisionId: firstRevisionId,
        expectedInstructions: INSTRUCTIONS,
        surveyStepId: committed.reviewStepId,
        comment: "A stale review submission."
      }),
      /excluded from this study/
    )
    await assert.rejects(
      definitionCaller.create({
        term: `survey position test term ${STAMP}`,
        definition: "An excluded candidate cannot be revised in this study.",
        derivedFromRevisionId: firstRevisionId,
        surveyStepId: committed.defineStepId,
        expectedInstructions: INSTRUCTIONS
      }),
      /excluded from this study/
    )
    await assert.rejects(
      setStudyCandidateExcluded({ ...exclusionInput, excluded: false }),
      { code: "CONFLICT" }
    )
    await setStudyCandidateExcluded({
      ...exclusionInput,
      excluded: false,
      expectedExclusionId: exclusion.id,
      reason: "Restored for the test."
    })
    assert.equal(
      (
        await definitionCaller.list({
          termId: committed.termId,
          surveyStepId: committed.defineStepId
        })
      ).length,
      2
    )
    const [restored] = await exclusionHistory()
    assert.ok(restored.restoredAt)
    assert.equal(restored.reason, exclusionInput.reason)
    assert.equal(restored.restorationReason, "Restored for the test.")
    assert.equal(restored.restoredById, committed.authorId)

    // --- A retried identical Accept converges. ---

    const firstAccept = await caller.acceptPosition({
      stepId: committed.defineStepId,
      definitionId: firstDefinitionId,
      revisionId: firstRevisionId,
      expectedInstructions: INSTRUCTIONS
    })
    assert.equal(firstAccept.ok, true)
    assert.equal(firstAccept.score, 1)

    const positionRows = () =>
      db
        .select({
          kind: surveyStepPositionsTable.kind,
          definitionId: surveyStepPositionsTable.definitionId,
          revisionId: surveyStepPositionsTable.revisionId,
          recordedAt: surveyStepPositionsTable.recordedAt
        })
        .from(surveyStepPositionsTable)
        .where(
          and(
            eq(surveyStepPositionsTable.stepId, committed.defineStepId),
            eq(surveyStepPositionsTable.userId, committed.participantId)
          )
        )
    const upEventRows = () =>
      db
        .select({ id: voteEventsTable.id })
        .from(voteEventsTable)
        .where(
          and(
            eq(voteEventsTable.surveyStepId, committed.defineStepId),
            eq(voteEventsTable.userId, committed.participantId),
            eq(voteEventsTable.kind, "up")
          )
        )

    const [heldPosition] = await positionRows()
    assert.ok(heldPosition, "the first Accept records a position")
    const [completion] = await db
      .select({ completedAt: surveyStepCompletionsTable.completedAt })
      .from(surveyStepCompletionsTable)
      .where(
        and(
          eq(surveyStepCompletionsTable.stepId, committed.defineStepId),
          eq(surveyStepCompletionsTable.userId, committed.participantId)
        )
      )
    assert.equal(
      heldPosition.recordedAt,
      completion.completedAt,
      "a position recorded with its completion carries the completion's time"
    )

    const retainedComment = await commentCaller.create({
      id: firstDefinitionId,
      revisionId: firstRevisionId,
      expectedInstructions: INSTRUCTIONS,
      surveyStepId: committed.reviewStepId,
      comment: "A review comment retained after exclusion."
    })
    // Excluding a held candidate preserves its position, vote and revisions.
    await setStudyCandidateExcluded(exclusionInput)
    assert.deepEqual(await positionRows(), [heldPosition])
    assert.ok(
      await db.query.commentsTable.findFirst({
        where: eq(commentsTable.id, retainedComment.id)
      }),
      "exclusion retains the comment"
    )
    assert.equal((await upEventRows()).length, 1)
    assert.equal(await currentRevisionIdOf(firstDefinitionId), firstRevisionId)
    const [secondExclusion] = (await exclusionHistory()).filter(
      (entry) => entry.restoredAt === null
    )
    assert.ok(secondExclusion)
    assert.equal(
      (await exclusionHistory()).length,
      2,
      "a second exclusion retains the restored interval"
    )

    const retriedAccept = await caller.acceptPosition({
      stepId: committed.defineStepId,
      definitionId: firstDefinitionId,
      revisionId: firstRevisionId,
      expectedInstructions: INSTRUCTIONS
    })
    assert.equal(
      retriedAccept.ok,
      true,
      "a retried identical Accept converges instead of conflicting"
    )
    assert.equal(retriedAccept.score, firstAccept.score)
    assert.equal(retriedAccept.nextPosition, firstAccept.nextPosition)
    assert.equal((await positionRows()).length, 1)
    assert.equal(
      (await upEventRows()).length,
      1,
      "the converged retry casts no second vote"
    )

    // --- A different target stays a real conflict. ---

    const secondRevisionId = await currentRevisionIdOf(secondDefinitionId)
    await assert.rejects(
      caller.acceptPosition({
        stepId: committed.defineStepId,
        definitionId: secondDefinitionId,
        revisionId: secondRevisionId,
        expectedInstructions: INSTRUCTIONS
      }),
      (error: { code?: string; message?: string }) => {
        assert.equal(error.code, "CONFLICT")
        assert.match(error.message ?? "", /position on this term/)
        return true
      }
    )

    // --- An accept behind a purge-orphaned completion satisfies the
    //     invariants: the fresh vote event does not postdate recordedAt. ---

    await db.transaction(async (tx) => {
      await deleteDefinitionRows(tx, firstDefinitionId)
    })
    assert.equal(
      (await positionRows()).length,
      0,
      "the purge removes the exact-candidate link"
    )
    const [survivingCompletion] = await db
      .select({ completedAt: surveyStepCompletionsTable.completedAt })
      .from(surveyStepCompletionsTable)
      .where(
        and(
          eq(surveyStepCompletionsTable.stepId, committed.defineStepId),
          eq(surveyStepCompletionsTable.userId, committed.participantId)
        )
      )
    assert.ok(survivingCompletion, "the purge keeps the completion")

    await db.transaction(async (tx) => {
      await lockStudy(tx, committed.studyId)
      await acceptPositionCandidate(tx, {
        stepId: committed.defineStepId,
        termId: committed.termId,
        userId: committed.participantId,
        definitionId: secondDefinitionId,
        revisionId: secondRevisionId,
        actorKind: "human",
        communityId: committed.communityId
      })
    })

    const [resumedPosition] = await positionRows()
    assert.ok(resumedPosition)
    assert.equal(resumedPosition.kind, "accepted")
    assert.equal(resumedPosition.definitionId, secondDefinitionId)

    // Compared in SQL so the check does not depend on parsing the stored
    // timestamp text, and stated as the invariants state it.
    const [timing] = await db
      .select({
        votePrecedesPosition: sql<boolean>`${voteEventsTable.createdAt} <= ${surveyStepPositionsTable.recordedAt}`,
        positionAfterCompletion: sql<boolean>`${surveyStepPositionsTable.recordedAt} > ${surveyStepCompletionsTable.completedAt}`
      })
      .from(surveyStepPositionsTable)
      .innerJoin(
        voteEventsTable,
        and(
          eq(voteEventsTable.surveyStepId, surveyStepPositionsTable.stepId),
          eq(voteEventsTable.userId, surveyStepPositionsTable.userId),
          eq(voteEventsTable.definitionId, secondDefinitionId),
          eq(voteEventsTable.kind, "up")
        )
      )
      .innerJoin(
        surveyStepCompletionsTable,
        and(
          eq(
            surveyStepCompletionsTable.stepId,
            surveyStepPositionsTable.stepId
          ),
          eq(surveyStepCompletionsTable.userId, surveyStepPositionsTable.userId)
        )
      )
      .where(
        and(
          eq(surveyStepPositionsTable.stepId, committed.defineStepId),
          eq(surveyStepPositionsTable.userId, committed.participantId)
        )
      )
    assert.ok(timing, "the resumed position joins its vote and completion")
    assert.equal(
      timing.votePrecedesPosition,
      true,
      "the accepting vote event does not postdate recordedAt"
    )
    assert.equal(
      timing.positionAfterCompletion,
      true,
      "a position behind an old completion is recorded now, not backdated"
    )

    // --- Skip this term records one explicit, paired no-opinion outcome. ---

    await caller.completeStep({
      stepId: committed.instructionsStepId,
      expectedInstructions: INSTRUCTIONS
    })

    await assert.rejects(
      caller.skipTerm({
        stepId: committed.defineStepId,
        expectedInstructions: INSTRUCTIONS
      }),
      (error: { code?: string; message?: string }) => {
        assert.equal(error.code, "CONFLICT")
        assert.match(error.message ?? "", /work on this term/i)
        return true
      },
      "a recorded position cannot be changed into a skip"
    )

    const skippedRevisionId = await currentRevisionIdOf(skippedDefinitionId)
    const [scoreBeforeSkip] = await db
      .select({ score: definitionsTable.score })
      .from(definitionsTable)
      .where(eq(definitionsTable.id, skippedDefinitionId))
    assert.ok(scoreBeforeSkip)

    const firstSkip = await caller.skipTerm({
      stepId: committed.skippedDefineStepId,
      expectedInstructions: INSTRUCTIONS
    })
    assert.equal(firstSkip.ok, true)
    assert.deepEqual(firstSkip.skippedStepIds, [
      committed.skippedDefineStepId,
      committed.skippedReviewStepId
    ])
    assert.equal(
      firstSkip.nextPosition,
      4,
      "resumption passes both skipped steps and stops at the unfinished review"
    )

    const skippedStepIds = [
      committed.skippedDefineStepId,
      committed.skippedReviewStepId
    ]
    const skipCompletionRows = () =>
      db
        .select({
          stepId: surveyStepCompletionsTable.stepId,
          outcome: surveyStepCompletionsTable.outcome
        })
        .from(surveyStepCompletionsTable)
        .where(
          and(
            inArray(surveyStepCompletionsTable.stepId, skippedStepIds),
            eq(surveyStepCompletionsTable.userId, committed.participantId)
          )
        )

    assert.deepEqual(
      (await skipCompletionRows())
        .map((row) => [row.stepId, row.outcome] as const)
        .sort((a, b) => a[0] - b[0]),
      skippedStepIds.map((stepId) => [stepId, "skipped"] as const),
      "Position and Review carry explicit skipped outcomes"
    )

    const retriedSkip = await caller.skipTerm({
      stepId: committed.skippedDefineStepId,
      expectedInstructions: INSTRUCTIONS
    })
    assert.equal(retriedSkip.ok, true)
    assert.equal(retriedSkip.nextPosition, firstSkip.nextPosition)
    assert.equal(
      (await skipCompletionRows()).length,
      2,
      "an exact skip retry creates no duplicate completion"
    )

    await assert.rejects(
      caller.skipTerm({
        stepId: committed.skippedReviewStepId,
        expectedInstructions: INSTRUCTIONS
      }),
      (error: { code?: string; message?: string }) => {
        assert.equal(error.code, "BAD_REQUEST")
        assert.match(error.message ?? "", /not for this act/i)
        return true
      },
      "Skip this term starts only from a Position step"
    )

    await assert.rejects(
      caller.acceptPosition({
        stepId: committed.skippedDefineStepId,
        definitionId: skippedDefinitionId,
        revisionId: skippedRevisionId,
        expectedInstructions: INSTRUCTIONS
      }),
      (error: { code?: string; message?: string }) => {
        assert.equal(error.code, "CONFLICT")
        assert.match(error.message ?? "", /position on this term/i)
        return true
      },
      "a skipped Position cannot later be accepted"
    )

    await assert.rejects(
      voteCaller.vote({
        definitionId: skippedDefinitionId,
        revisionId: skippedRevisionId,
        vote: "up",
        surveyStepId: committed.skippedReviewStepId,
        expectedInstructions: INSTRUCTIONS
      }),
      (error: { code?: string; message?: string }) => {
        assert.equal(error.code, "CONFLICT")
        assert.match(error.message ?? "", /skipped this term/i)
        return true
      },
      "a skipped Review cannot acquire a vote through a stale request"
    )

    await assert.rejects(
      commentCaller.create({
        id: skippedDefinitionId,
        revisionId: skippedRevisionId,
        comment: "This must not be written after the term was skipped.",
        surveyStepId: committed.skippedReviewStepId,
        expectedInstructions: INSTRUCTIONS
      }),
      (error: { code?: string; message?: string }) => {
        assert.equal(error.code, "CONFLICT")
        assert.match(error.message ?? "", /skipped this term/i)
        return true
      },
      "a skipped Review cannot acquire a comment through a stale request"
    )

    const [scoreAfterSkip] = await db
      .select({ score: definitionsTable.score })
      .from(definitionsTable)
      .where(eq(definitionsTable.id, skippedDefinitionId))
    assert.equal(scoreAfterSkip?.score, scoreBeforeSkip.score)
    assert.equal(
      (
        await db
          .select({ stepId: surveyStepPositionsTable.stepId })
          .from(surveyStepPositionsTable)
          .where(
            and(
              inArray(surveyStepPositionsTable.stepId, skippedStepIds),
              eq(surveyStepPositionsTable.userId, committed.participantId)
            )
          )
      ).length,
      0,
      "skipping records no Position target"
    )
    assert.equal(
      (
        await db
          .select({ id: voteEventsTable.id })
          .from(voteEventsTable)
          .where(
            and(
              inArray(voteEventsTable.surveyStepId, skippedStepIds),
              eq(voteEventsTable.userId, committed.participantId)
            )
          )
      ).length,
      0,
      "skipping and refused stale requests record no vote event"
    )
    assert.equal(
      (
        await db
          .select({ id: definitionRevisionsTable.id })
          .from(definitionRevisionsTable)
          .where(
            and(
              inArray(definitionRevisionsTable.surveyStepId, skippedStepIds),
              eq(definitionRevisionsTable.editorId, committed.participantId)
            )
          )
      ).length,
      0,
      "skipping records no definition revision"
    )
    assert.equal(
      (
        await db
          .select({ id: commentsTable.id })
          .from(commentsTable)
          .where(
            and(
              inArray(commentsTable.surveyStepId, skippedStepIds),
              eq(commentsTable.userId, committed.participantId)
            )
          )
      ).length,
      0,
      "skipping and refused stale requests record no comment"
    )
  } finally {
    if (fixture) {
      const committed = fixture
      await db.transaction(async (tx) => {
        const stepIds = [
          committed.instructionsStepId,
          committed.defineStepId,
          committed.skippedDefineStepId,
          committed.reviewStepId,
          committed.skippedReviewStepId
        ]
        await tx
          .delete(surveyStepPositionsTable)
          .where(inArray(surveyStepPositionsTable.stepId, stepIds))
        await tx
          .delete(surveyStepCompletionsTable)
          .where(inArray(surveyStepCompletionsTable.stepId, stepIds))
        for (const definitionId of committed.definitionIds)
          await deleteDefinitionRows(tx, definitionId)
        await tx
          .delete(surveyStepsTable)
          .where(
            inArray(surveyStepsTable.studyId, [
              committed.studyId,
              committed.otherStudyId
            ])
          )
        await tx
          .delete(studiesTable)
          .where(
            inArray(studiesTable.id, [
              committed.studyId,
              committed.otherStudyId
            ])
          )
        await tx
          .delete(communityMembersTable)
          .where(eq(communityMembersTable.communityId, committed.communityId))
        await tx
          .delete(communitiesTable)
          .where(eq(communitiesTable.id, committed.communityId))
        await tx
          .delete(termsTable)
          .where(
            inArray(termsTable.id, [committed.termId, committed.skippedTermId])
          )
        await tx
          .delete(collectionsTable)
          .where(eq(collectionsTable.id, committed.collectionId))
        await tx
          .delete(vocabulariesTable)
          .where(eq(vocabulariesTable.slug, committed.vocabularySlug))
        await tx
          .delete(usersTable)
          .where(
            inArray(usersTable.id, [
              committed.participantId,
              committed.authorId
            ])
          )
      })
    }
  }

  console.log("Survey position database tests passed")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
