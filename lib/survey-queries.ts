import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import {
  commentsTable,
  collectionsTable,
  communitiesTable,
  communityMembersTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  studiesTable,
  surveyResponsesTable,
  surveyStepCompletionsTable,
  surveyStepsTable,
  termsTable,
  usersTable,
  voteEventsTable,
  votesTable
} from "@yamz/db"
import type { ActorKind, GenerationStampInput } from "@/lib/participation"
import {
  recordCompletion,
  resumePosition,
  stepGate,
  type Question,
  type Step
} from "@/lib/surveys"

/*
 * Reads for the walkthrough, and the two multi-row writes the router and the
 * pilot driver share: replacing the steps of a study and answering a
 * question. The rules are in lib/surveys.ts; this module loads the facts
 * those rules take and writes the rows they describe. Nothing here gates on
 * the viewer: the router and the pages check membership and the study state
 * before calling in, and the driver acts under its persona accounts.
 *
 * No "server-only" marker, unlike lib/study-queries.ts, because
 * scripts/test-kos-db.ts drives these writes inside its rolled-back
 * transaction under plain tsx.
 */

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | DatabaseTransaction

const stepColumns = {
  id: surveyStepsTable.id,
  position: surveyStepsTable.position,
  kind: surveyStepsTable.kind,
  termId: surveyStepsTable.termId,
  prompt: surveyStepsTable.prompt,
  responseKind: surveyStepsTable.responseKind
}

// A step with the name of the term it is about, for the define and review
// steps. The shell shows the name; the rules take the id.
export type StepWithTerm = Step & {
  term: string | null
  termSlug: string | null
}

// The steps of a study in position order.
export const stepsOfStudy = async (
  executor: Executor,
  studyId: number
): Promise<StepWithTerm[]> =>
  executor
    .select({
      ...stepColumns,
      term: termsTable.term,
      termSlug: termsTable.slug
    })
    .from(surveyStepsTable)
    .leftJoin(termsTable, eq(termsTable.id, surveyStepsTable.termId))
    .where(eq(surveyStepsTable.studyId, studyId))
    .orderBy(asc(surveyStepsTable.position))

// One step with the study it belongs to, which is what every participation
// check needs: the community for the membership and whether it is retired,
// the window for the state.
export const stepWithStudy = async (executor: Executor, stepId: number) => {
  const [row] = await executor
    .select({
      step: stepColumns,
      study: {
        id: studiesTable.id,
        slug: studiesTable.slug,
        communityId: studiesTable.communityId,
        opensAt: studiesTable.opensAt,
        closesAt: studiesTable.closesAt,
        retiredAt: studiesTable.retiredAt,
        communityRetiredAt: communitiesTable.retiredAt,
        collectionRetiredAt: collectionsTable.retiredAt
      },
      community: {
        retiredAt: communitiesTable.retiredAt
      }
    })
    .from(surveyStepsTable)
    .innerJoin(studiesTable, eq(studiesTable.id, surveyStepsTable.studyId))
    .innerJoin(
      communitiesTable,
      eq(communitiesTable.id, studiesTable.communityId)
    )
    .innerJoin(
      collectionsTable,
      eq(collectionsTable.id, studiesTable.collectionId)
    )
    .where(eq(surveyStepsTable.id, stepId))
    .limit(1)
  return row ?? null
}

/*
 * Hold the study and both parents in one explicit order for the rest of the
 * transaction. Participant acts, lifecycle edits and step generation all
 * start with the study; community and collection retirement then either land
 * before this authoritative read or wait until the transaction commits.
 */
export const lockStudy = async (tx: DatabaseTransaction, studyId: number) => {
  const [study] = await tx
    .select({
      id: studiesTable.id,
      slug: studiesTable.slug,
      title: studiesTable.title,
      communityId: studiesTable.communityId,
      collectionId: studiesTable.collectionId,
      welcome: studiesTable.welcome,
      opensAt: studiesTable.opensAt,
      closesAt: studiesTable.closesAt,
      retiredAt: studiesTable.retiredAt
    })
    .from(studiesTable)
    .where(eq(studiesTable.id, studyId))
    .limit(1)
    .for("update")
  if (!study) return null

  const [community] = await tx
    .select({
      slug: communitiesTable.slug,
      retiredAt: communitiesTable.retiredAt
    })
    .from(communitiesTable)
    .where(eq(communitiesTable.id, study.communityId))
    .limit(1)
    .for("share")
  const [collection] = await tx
    .select({ retiredAt: collectionsTable.retiredAt })
    .from(collectionsTable)
    .where(eq(collectionsTable.id, study.collectionId))
    .limit(1)
    .for("share")
  if (!community || !collection) return null

  return {
    ...study,
    communitySlug: community.slug,
    communityRetiredAt: community.retiredAt,
    collectionRetiredAt: collection.retiredAt
  }
}

// The participant-visible protocol copy protected by the study lock. Null is
// meaningful: it says the walkthrough has no canonical instructions step.
export const instructionPromptOfStudy = async (
  executor: Executor,
  studyId: number
): Promise<string | null> => {
  const [row] = await executor
    .select({ prompt: surveyStepsTable.prompt })
    .from(surveyStepsTable)
    .where(
      and(
        eq(surveyStepsTable.studyId, studyId),
        eq(surveyStepsTable.position, 1),
        eq(surveyStepsTable.kind, "instructions")
      )
    )
    .limit(1)
  return row?.prompt ?? null
}

// The ids of the steps of a study one person has completed.
export const completedStepIdsOf = async (
  executor: Executor,
  studyId: number,
  userId: number
): Promise<Set<number>> => {
  const rows = await executor
    .select({ stepId: surveyStepCompletionsTable.stepId })
    .from(surveyStepCompletionsTable)
    .innerJoin(
      surveyStepsTable,
      eq(surveyStepsTable.id, surveyStepCompletionsTable.stepId)
    )
    .where(
      and(
        eq(surveyStepsTable.studyId, studyId),
        eq(surveyStepCompletionsTable.userId, userId)
      )
    )
  return new Set(rows.map((row) => row.stepId))
}

// How many completions the steps of a study have, by anyone. Zero is what
// lets a steward replace the steps (lib/surveys.ts mayRegenerateSteps).
export const completionCountOfStudy = async (
  executor: Executor,
  studyId: number
): Promise<number> => {
  const [row] = await executor
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(surveyStepCompletionsTable)
    .innerJoin(
      surveyStepsTable,
      eq(surveyStepsTable.id, surveyStepCompletionsTable.stepId)
    )
    .where(eq(surveyStepsTable.studyId, studyId))
  return row?.count ?? 0
}

/*
 * Every persisted act that can make a walkthrough's wording part of the
 * study record. An instructions edit must consider all five kinds: a person
 * can act inside a step before completing it, so completions alone are not a
 * safe proxy for whether the walkthrough has been used.
 */
export type WalkthroughUsage = {
  completions: number
  responses: number
  definitionRevisions: number
  voteEvents: number
  comments: number
}

export const walkthroughUsageOfStudy = async (
  executor: Executor,
  studyId: number
): Promise<WalkthroughUsage> => {
  const count = sql<number>`cast(count(*) as int)`.mapWith(Number)
  const [completions] = await executor
    .select({ count })
    .from(surveyStepCompletionsTable)
    .innerJoin(
      surveyStepsTable,
      eq(surveyStepsTable.id, surveyStepCompletionsTable.stepId)
    )
    .where(eq(surveyStepsTable.studyId, studyId))
  const [responses] = await executor
    .select({ count })
    .from(surveyResponsesTable)
    .innerJoin(
      surveyStepsTable,
      eq(surveyStepsTable.id, surveyResponsesTable.stepId)
    )
    .where(eq(surveyStepsTable.studyId, studyId))
  const [definitionRevisions] = await executor
    .select({ count })
    .from(definitionRevisionsTable)
    .innerJoin(
      surveyStepsTable,
      eq(surveyStepsTable.id, definitionRevisionsTable.surveyStepId)
    )
    .where(eq(surveyStepsTable.studyId, studyId))
  const [voteEvents] = await executor
    .select({ count })
    .from(voteEventsTable)
    .innerJoin(
      surveyStepsTable,
      eq(surveyStepsTable.id, voteEventsTable.surveyStepId)
    )
    .where(eq(surveyStepsTable.studyId, studyId))
  const [comments] = await executor
    .select({ count })
    .from(commentsTable)
    .innerJoin(
      surveyStepsTable,
      eq(surveyStepsTable.id, commentsTable.surveyStepId)
    )
    .where(eq(surveyStepsTable.studyId, studyId))

  return {
    completions: completions?.count ?? 0,
    responses: responses?.count ?? 0,
    definitionRevisions: definitionRevisions?.count ?? 0,
    voteEvents: voteEvents?.count ?? 0,
    comments: comments?.count ?? 0
  }
}

/*
 * The position a person holds on a define step as an act naming the step:
 * the candidate they accepted with an upvote event naming it, or the
 * definition they published with an initial revision naming it. The
 * earliest act is the position. Null when no act of theirs names the step,
 * which is also the case when the gate is satisfied by a standing upvote
 * (stepsWithPosition): a standing vote is not reported as held, so the
 * shell shows the candidates and Accept records the completion against it.
 */
export type Position = {
  kind: "accepted" | "proposed"
  definitionId: number
}

export const positionsOf = async (
  executor: Executor,
  stepIds: number[],
  userId: number
): Promise<Map<number, Position>> => {
  if (stepIds.length === 0) return new Map()
  const [accepted, proposed] = await Promise.all([
    executor
      .select({
        stepId: voteEventsTable.surveyStepId,
        definitionId: voteEventsTable.definitionId,
        createdAt: voteEventsTable.createdAt
      })
      .from(voteEventsTable)
      .where(
        and(
          inArray(voteEventsTable.surveyStepId, stepIds),
          eq(voteEventsTable.userId, userId),
          eq(voteEventsTable.kind, "up")
        )
      )
      .orderBy(asc(voteEventsTable.id)),
    executor
      .select({
        stepId: definitionRevisionsTable.surveyStepId,
        definitionId: definitionRevisionsTable.definitionId,
        createdAt: definitionRevisionsTable.createdAt
      })
      .from(definitionRevisionsTable)
      .where(
        and(
          inArray(definitionRevisionsTable.surveyStepId, stepIds),
          eq(definitionRevisionsTable.editorId, userId),
          eq(definitionRevisionsTable.version, 1)
        )
      )
      .orderBy(asc(definitionRevisionsTable.id))
  ])

  const positions = new Map<number, Position & { createdAt: string }>()
  const consider = (
    kind: Position["kind"],
    row: { stepId: number | null; definitionId: number; createdAt: string }
  ) => {
    if (row.stepId === null) return
    const held = positions.get(row.stepId)
    if (held && held.createdAt <= row.createdAt) return
    positions.set(row.stepId, {
      kind,
      definitionId: row.definitionId,
      createdAt: row.createdAt
    })
  }
  for (const row of accepted) consider("accepted", row)
  for (const row of proposed) consider("proposed", row)
  return new Map(
    [...positions].map(([stepId, { kind, definitionId }]) => [
      stepId,
      { kind, definitionId }
    ])
  )
}

/*
 * The define steps, among those given, on which a person holds a position:
 * the fact the define gate takes. A position is exactly one of an upvote
 * event by the person naming the step, an initial revision of theirs naming
 * it, or a standing upvote of theirs on the current revision of a
 * definition of the term. The standing vote satisfies the gate because the
 * vote path toggles, so it cannot be cast again inside the step; a vote on
 * a superseded revision is not one, because the person can neither see it
 * on the candidates nor recast it. A downvote, a withdrawal, and a vote on
 * a definition of another term are no position.
 */
export const stepsWithPosition = async (
  executor: Executor,
  stepIds: number[],
  userId: number
): Promise<Set<number>> => {
  if (stepIds.length === 0) return new Set()
  const rows = await executor
    .select({ id: surveyStepsTable.id })
    .from(surveyStepsTable)
    .where(
      and(
        inArray(surveyStepsTable.id, stepIds),
        eq(surveyStepsTable.kind, "define"),
        or(
          sql`exists (
            select 1 from ${voteEventsTable} e
            where e."surveyStepId" = ${surveyStepsTable.id}
              and e."userId" = ${userId}
              and e.kind = 'up'
          )`,
          sql`exists (
            select 1 from ${definitionRevisionsTable} r
            where r."surveyStepId" = ${surveyStepsTable.id}
              and r."editorId" = ${userId}
              and r.version = 1
          )`,
          sql`exists (
            select 1 from ${votesTable} v
            join ${definitionsTable} d
              on d.id = v."definitionId"
             and d."currentRevisionId" = v."revisionId"
            where v."userId" = ${userId}
              and v.kind = 'up'
              and d."termId" = ${surveyStepsTable.termId}
          )`
        )
      )
    )
  return new Set(rows.map((row) => row.id))
}

// Whether a person holds a position on one define step.
export const hasPosition = async (
  executor: Executor,
  stepId: number,
  userId: number
): Promise<boolean> =>
  (await stepsWithPosition(executor, [stepId], userId)).has(stepId)

/*
 * Whether an act of a person already names a define step: a vote event or
 * an initial revision. A participant takes one position per define step, so
 * votes.vote and definitions.create refuse a second act on this, and
 * drizzle/invariants.sql proves afterwards that one is all there is.
 */
export const actNamesStep = async (
  executor: Executor,
  stepId: number,
  userId: number
): Promise<boolean> => {
  const [row] = await executor
    .select({ found: sql<number>`1` })
    .from(surveyStepsTable)
    .where(
      and(
        eq(surveyStepsTable.id, stepId),
        or(
          sql`exists (
            select 1 from ${voteEventsTable} e
            where e."surveyStepId" = ${surveyStepsTable.id}
              and e."userId" = ${userId}
          )`,
          sql`exists (
            select 1 from ${definitionRevisionsTable} r
            where r."surveyStepId" = ${surveyStepsTable.id}
              and r."editorId" = ${userId}
              and r.version = 1
          )`
        )
      )
    )
    .limit(1)
  return Boolean(row)
}

const responseColumns = {
  id: surveyResponsesTable.id,
  stepId: surveyResponsesTable.stepId,
  valueText: surveyResponsesTable.valueText,
  valueScale: surveyResponsesTable.valueScale,
  createdAt: surveyResponsesTable.createdAt
}

// One person's answer to a question step, or null.
export const responseOf = async (
  executor: Executor,
  stepId: number,
  userId: number
) => {
  const [row] = await executor
    .select(responseColumns)
    .from(surveyResponsesTable)
    .where(
      and(
        eq(surveyResponsesTable.stepId, stepId),
        eq(surveyResponsesTable.userId, userId)
      )
    )
    .limit(1)
  return row ?? null
}

/*
 * The gate of a step for one person, with its facts loaded: what
 * completeStep refuses on. The rule is stepGate (lib/surveys.ts); this
 * loads the position for a define step and the answer for a question, so
 * the router and scripts/test-kos-db.ts evaluate the gate the same way.
 */
export const gateOf = async (
  executor: Executor,
  step: Step,
  userId: number
): Promise<ReturnType<typeof stepGate>> =>
  stepGate(step, {
    hasPosition:
      step.kind === "define" && (await hasPosition(executor, step.id, userId)),
    hasResponse:
      step.kind === "question" &&
      (await responseOf(executor, step.id, userId)) !== null
  })

export type WalkthroughStep = StepWithTerm & {
  // Whether the viewer completed it. False for a signed-out viewer.
  completed: boolean
  // For a define step, whether the viewer holds a position on the term, the
  // fact the gate takes (stepsWithPosition); false elsewhere and for a
  // signed-out viewer.
  hasPosition: boolean
  // The act of the viewer naming the step, when there is one. Null where the
  // position is a standing upvote, which the shell shows as the candidates
  // with Accept open. Named held because position is the place of the step
  // in the list.
  held: Position | null
  // For a question step, the viewer's answer if any.
  response: {
    valueText: string | null
    valueScale: number | null
  } | null
}

/*
 * The walkthrough of a study as one viewer sees it: the steps, with the
 * viewer's completion and the fact each gate takes, and where to resume.
 * Public study, private progress: with no viewer the steps come back bare.
 * This is what surveys.get returns and what the study page reads for its
 * resume card.
 */
export const walkthroughOf = async (
  executor: Executor,
  studyId: number,
  userId: number | null
) => {
  const steps = await stepsOfStudy(executor, studyId)
  if (userId === null)
    return {
      steps: steps.map((step) => ({
        ...step,
        completed: false,
        hasPosition: false,
        held: null,
        response: null
      })) as WalkthroughStep[],
      completedStepIds: [] as number[],
      resumePosition: resumePosition(steps, new Set())
    }

  const defineStepIds = steps
    .filter((step) => step.kind === "define")
    .map((step) => step.id)
  const [completed, positions, withPosition] = await Promise.all([
    completedStepIdsOf(executor, studyId, userId),
    positionsOf(executor, defineStepIds, userId),
    stepsWithPosition(executor, defineStepIds, userId)
  ])

  const questionStepIds = steps
    .filter((step) => step.kind === "question")
    .map((step) => step.id)
  const responses = new Map(
    questionStepIds.length
      ? (
          await executor
            .select(responseColumns)
            .from(surveyResponsesTable)
            .where(
              and(
                inArray(surveyResponsesTable.stepId, questionStepIds),
                eq(surveyResponsesTable.userId, userId)
              )
            )
        ).map((row) => [row.stepId, row])
      : []
  )

  return {
    steps: steps.map((step) => ({
      ...step,
      completed: completed.has(step.id),
      hasPosition: withPosition.has(step.id),
      held: positions.get(step.id) ?? null,
      response:
        step.kind === "question"
          ? (() => {
              const response = responses.get(step.id)
              return response
                ? {
                    valueText: response.valueText,
                    valueScale: response.valueScale
                  }
                : null
            })()
          : null
    })) as WalkthroughStep[],
    completedStepIds: [...completed],
    resumePosition: resumePosition(steps, completed)
  }
}

// Where the viewer resumes after a write, read inside the transaction that
// wrote it, so the position the client is told is the one the row implies.
export const nextPositionFor = async (
  executor: Executor,
  studyId: number,
  userId: number
): Promise<number | null> => {
  const [steps, completed] = await Promise.all([
    stepsOfStudy(executor, studyId),
    completedStepIdsOf(executor, studyId, userId)
  ])
  return resumePosition(steps, completed)
}

/*
 * Replace the steps of a study with a plan, in the transaction the caller
 * opened. The delete refuses by foreign key when any completion, response,
 * comment, vote event or revision names a step, which is the backstop
 * behind mayRegenerateSteps: the router turns that refusal into CONFLICT.
 */
export const replaceSteps = async (
  tx: DatabaseTransaction,
  studyId: number,
  plan: Omit<Step, "id">[]
): Promise<Step[]> => {
  await tx.delete(surveyStepsTable).where(eq(surveyStepsTable.studyId, studyId))
  if (plan.length === 0) return []
  return tx
    .insert(surveyStepsTable)
    .values(plan.map((step) => ({ studyId, ...step })))
    .returning(stepColumns)
}

// Append one question step after the last step of a study. Allowed at any
// time: an appended step lengthens nobody's position.
export const appendQuestionStep = async (
  tx: DatabaseTransaction,
  studyId: number,
  question: Question
): Promise<Step> => {
  const [last] = await tx
    .select({
      position: sql<number>`coalesce(max(${surveyStepsTable.position}), 0)`
    })
    .from(surveyStepsTable)
    .where(eq(surveyStepsTable.studyId, studyId))
  const [step] = await tx
    .insert(surveyStepsTable)
    .values({
      studyId,
      position: Number(last?.position ?? 0) + 1,
      kind: "question",
      termId: null,
      prompt: question.prompt,
      responseKind: question.responseKind
    })
    .returning(stepColumns)
  return step
}

/*
 * Answer a question step and complete it, in one transaction, which is the
 * pairing drizzle/invariants.sql requires of a response. A second answer by
 * the same person refuses on the unique pair; the router turns that into
 * CONFLICT. The value columns are written as given, so the CHECKs on the
 * table, and not this function, decide what a well-formed answer is. A
 * simulated text answer arrives with its generation stamp, as a simulated
 * comment does through insertComment; a human answer has none.
 */
export const recordResponse = async (
  tx: DatabaseTransaction,
  input: {
    stepId: number
    userId: number
    authorKind: ActorKind
    valueText?: string | null
    valueScale?: number | null
    stamp?: GenerationStampInput
  }
) => {
  const [response] = await tx
    .insert(surveyResponsesTable)
    .values({
      stepId: input.stepId,
      userId: input.userId,
      authorKind: input.authorKind,
      valueText: input.valueText ?? null,
      valueScale: input.valueScale ?? null,
      ...(input.stamp ?? {})
    })
    .returning(responseColumns)
  await recordCompletion(tx, { stepId: input.stepId, userId: input.userId })
  return response
}

/*
 * The steward's view of a study: per participant, how many steps they have
 * completed out of the total, and per step, how many participants have
 * completed it. Participants are the live members of the community, AI
 * identities included, with the name and the public flag the roster renders
 * through. No page renders the matrix; the community page reads the
 * "k of n participants have finished" line from the participants.
 */
export const studyProgress = async (executor: Executor, studyId: number) => {
  const [study] = await executor
    .select({ communityId: studiesTable.communityId })
    .from(studiesTable)
    .where(eq(studiesTable.id, studyId))
    .limit(1)
  if (!study) return null

  const steps = await stepsOfStudy(executor, studyId)
  const stepIds = steps.map((step) => step.id)

  const [members, completions] = await Promise.all([
    executor
      .select({
        userId: usersTable.id,
        name: usersTable.name,
        isProfilePublic: usersTable.isProfilePublic,
        isAi: usersTable.isAi,
        role: communityMembersTable.role
      })
      .from(communityMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, communityMembersTable.userId))
      .where(
        and(
          eq(communityMembersTable.communityId, study.communityId),
          isNull(communityMembersTable.removedAt)
        )
      )
      .orderBy(asc(sql`lower(btrim(coalesce(${usersTable.name}, '')))`)),
    stepIds.length
      ? executor
          .select({
            stepId: surveyStepCompletionsTable.stepId,
            userId: surveyStepCompletionsTable.userId
          })
          .from(surveyStepCompletionsTable)
          .where(inArray(surveyStepCompletionsTable.stepId, stepIds))
      : Promise.resolve([] as { stepId: number; userId: number }[])
  ])

  const byUser = new Map<number, number>()
  const byStep = new Map<number, number>()
  for (const completion of completions) {
    byUser.set(completion.userId, (byUser.get(completion.userId) ?? 0) + 1)
    byStep.set(completion.stepId, (byStep.get(completion.stepId) ?? 0) + 1)
  }

  const total = steps.length
  const participants = members.map((member) => ({
    ...member,
    completed: byUser.get(member.userId) ?? 0,
    total
  }))

  return {
    total,
    participants,
    finished: participants.filter(
      (participant) => total > 0 && participant.completed >= total
    ).length,
    steps: steps.map((step) => ({
      ...step,
      completions: byStep.get(step.id) ?? 0
    }))
  }
}
