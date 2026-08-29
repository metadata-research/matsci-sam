import { and, eq } from "drizzle-orm"
import {
  db,
  definitionsTable,
  surveyStepCompletionsTable,
  surveyStepPositionsTable,
  votesTable
} from "@yamz/db"
import {
  castVote,
  StaleRevisionError,
  VoteTargetMissingError,
  type ActorKind
} from "@/lib/participation"
import { recordCompletion } from "@/lib/surveys"

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type SurveyPositionTarget = {
  stepId: number
  userId: number
  kind: "accepted" | "proposed"
  definitionId: number
  revisionId: number
}

export class SurveyPositionConflictError extends Error {
  constructor() {
    super("Your position on this term is already recorded")
    this.name = "SurveyPositionConflictError"
  }
}

export class SurveyPositionTargetError extends Error {
  constructor() {
    super("That candidate is not part of this Position step")
    this.name = "SurveyPositionTargetError"
  }
}

/*
 * Complete a Position step and retain the exact candidate in the same
 * transaction as the act that selected or created it. Completion is written
 * first because the position row has a composite foreign key to it. A retry
 * of the same target converges; a different target is a real conflict.
 */
export const recordPositionCompletion = async (
  tx: DatabaseTransaction,
  input: SurveyPositionTarget
) => {
  const insertedCompletion = await recordCompletion(tx, {
    stepId: input.stepId,
    userId: input.userId
  })
  const completion =
    insertedCompletion ??
    (await tx.query.surveyStepCompletionsTable.findFirst({
      columns: { id: true, completedAt: true },
      where: and(
        eq(surveyStepCompletionsTable.stepId, input.stepId),
        eq(surveyStepCompletionsTable.userId, input.userId)
      )
    }))
  if (!completion) throw new Error("Position completion was not recorded")

  // The position carries its completion's time only when the completion is
  // written here. Behind a pre-existing targetless completion — a record
  // from before this table, or one whose position an administrative purge
  // removed — the act selecting the candidate happens now, and a recordedAt
  // copied from the old completion would predate that act's event, which the
  // invariants refuse. The column default is the same transaction now() the
  // event rows carry.
  const [inserted] = await tx
    .insert(surveyStepPositionsTable)
    .values(
      insertedCompletion
        ? { ...input, recordedAt: insertedCompletion.completedAt }
        : input
    )
    .onConflictDoNothing()
    .returning()

  if (inserted) return { completion, position: inserted }

  const existing = await tx.query.surveyStepPositionsTable.findFirst({
    where: and(
      eq(surveyStepPositionsTable.stepId, input.stepId),
      eq(surveyStepPositionsTable.userId, input.userId)
    )
  })
  if (
    !existing ||
    existing.kind !== input.kind ||
    existing.definitionId !== input.definitionId ||
    existing.revisionId !== input.revisionId
  )
    throw new SurveyPositionConflictError()

  return { completion, position: existing }
}

/*
 * Accept without using the toggle semantics of the general vote control. The
 * definition lock makes the current revision and standing vote one snapshot:
 * an upvote is preserved, while no vote or a downvote is cast to up. The exact
 * candidate and completion are then retained before the transaction commits.
 */
export const acceptPositionCandidate = async (
  tx: DatabaseTransaction,
  input: {
    stepId: number
    termId: number
    userId: number
    definitionId: number
    revisionId: number
    actorKind: ActorKind
    communityId: number
  }
) => {
  const [target] = await tx
    .select({
      termId: definitionsTable.termId,
      currentRevisionId: definitionsTable.currentRevisionId,
      score: definitionsTable.score
    })
    .from(definitionsTable)
    .where(eq(definitionsTable.id, input.definitionId))
    .for("update")

  if (!target) throw new VoteTargetMissingError()
  if (target.termId !== input.termId) throw new SurveyPositionTargetError()
  if (target.currentRevisionId !== input.revisionId)
    throw new StaleRevisionError()

  const standing = await tx.query.votesTable.findFirst({
    columns: { kind: true },
    where: and(
      eq(votesTable.userId, input.userId),
      eq(votesTable.revisionId, input.revisionId)
    )
  })
  let score = target.score
  if (standing?.kind !== "up") {
    const [updated] = await castVote(tx, {
      definitionId: input.definitionId,
      revisionId: input.revisionId,
      userId: input.userId,
      vote: "up",
      actorKind: input.actorKind,
      communityId: input.communityId,
      surveyStepId: input.stepId
    })
    score = updated.score
  }

  const recorded = await recordPositionCompletion(tx, {
    stepId: input.stepId,
    userId: input.userId,
    kind: "accepted",
    definitionId: input.definitionId,
    revisionId: input.revisionId
  })
  return { ...recorded, score, standingVote: standing?.kind ?? null }
}
