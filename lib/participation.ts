import { and, eq, sql } from "drizzle-orm"
import {
  commentsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  voteEventsTable,
  votesTable
} from "@yamz/db"

/*
 * The participation record: casting a vote and posting a comment as
 * service-layer writes. The tRPC routers and the pilot driver both call
 * these, so an act carries its actor kind and its context however it
 * arrives, and the append-only vote event is written in the same
 * transaction as the tally it explains. Routers translate the typed errors
 * to TRPC codes; the driver lets them stop the run.
 */

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type ActorKind = "human" | "model" | "simulated"

export type GenerationStampInput = {
  promptKey: string | null
  promptHash: string
  promptText: string
  model: string
}

export class VoteTargetMissingError extends Error {
  constructor() {
    super("Definition doesn't exist")
    this.name = "VoteTargetMissingError"
  }
}

export class StaleRevisionError extends Error {
  constructor() {
    super("A newer revision is available. Review it before voting again.")
    this.name = "StaleRevisionError"
  }
}

export class CommentRevisionMissingError extends Error {
  constructor() {
    super("The definition revision you commented on no longer exists.")
    this.name = "CommentRevisionMissingError"
  }
}

/*
 * One voting act against the current revision: a first vote, a change, or a
 * withdrawal (voting the same way again). The votes row stays the current
 * state the tallies read, and every branch appends one voteEvents row, with
 * kind null recording the withdrawal. communityId is the context the act
 * happened in, resolved by the caller inside this same transaction, and
 * surveyStepId the review step it was taken inside, when it was taken from
 * a walkthrough. The caller has checked that the step fits the act
 * (lib/surveys.ts actMatchesStep); drizzle/invariants.sql proves it held.
 */
export const castVote = async (
  tx: DatabaseTransaction,
  input: {
    definitionId: number
    revisionId: number
    userId: number
    vote: "up" | "down"
    actorKind: ActorKind
    communityId: number | null
    surveyStepId?: number | null
  }
) => {
  const { definitionId, revisionId, userId, vote, actorKind, communityId } =
    input
  const surveyStepId = input.surveyStepId ?? null

  const [definition] = await tx
    .select({
      id: definitionsTable.id,
      currentRevisionId: definitionsTable.currentRevisionId
    })
    .from(definitionsTable)
    .where(eq(definitionsTable.id, definitionId))
    .for("update")

  if (!definition) throw new VoteTargetMissingError()
  if (definition.currentRevisionId !== revisionId)
    throw new StaleRevisionError()

  const voteConstraint = and(
    eq(votesTable.userId, userId),
    eq(votesTable.revisionId, revisionId)
  )
  const existing = await tx.query.votesTable.findFirst({
    where: voteConstraint
  })
  const value = (kind: "up" | "down") => (kind === "up" ? 1 : -1)

  const recordEvent = (kind: "up" | "down" | null) =>
    tx.insert(voteEventsTable).values({
      definitionId,
      revisionId,
      userId,
      kind,
      actorKind,
      communityId,
      surveyStepId
    })

  if (existing) {
    if (existing.kind === vote) {
      await tx.delete(votesTable).where(voteConstraint)
      await recordEvent(null)
      return await tx
        .update(definitionsTable)
        .set({ score: sql`${definitionsTable.score} - ${value(vote)}` })
        .where(eq(definitionsTable.id, definitionId))
        .returning()
    }

    await tx
      .update(votesTable)
      .set({ kind: vote, communityId })
      .where(voteConstraint)
    await recordEvent(vote)

    return await tx
      .update(definitionsTable)
      .set({
        score: sql`${definitionsTable.score} + ${value(vote) - value(existing.kind)}`
      })
      .where(eq(definitionsTable.id, definitionId))
      .returning()
  }

  await tx.insert(votesTable).values({
    userId,
    definitionId,
    revisionId,
    kind: vote,
    communityId
  })
  await recordEvent(vote)

  return await tx
    .update(definitionsTable)
    .set({ score: sql`${definitionsTable.score} + ${value(vote)}` })
    .where(eq(definitionsTable.id, definitionId))
    .returning()
}

/*
 * One comment on one revision. A human comment carries no stamp and the
 * table CHECK holds it to that; a model or simulated comment arrives with
 * the same generation stamp chats and refinement rounds carry. surveyStepId
 * is the review step the comment was posted inside, when it was posted from
 * a walkthrough, checked against the act by the caller as for castVote.
 */
export const insertComment = async (
  tx: DatabaseTransaction,
  input: {
    definitionId: number
    revisionId: number
    userId: number
    message: string
    actorKind: ActorKind
    stamp?: GenerationStampInput
    surveyStepId?: number | null
  }
) => {
  const revision = await tx.query.definitionRevisionsTable.findFirst({
    columns: { id: true, version: true },
    where: and(
      eq(definitionRevisionsTable.id, input.revisionId),
      eq(definitionRevisionsTable.definitionId, input.definitionId)
    )
  })
  if (!revision) throw new CommentRevisionMissingError()

  const [inserted] = await tx
    .insert(commentsTable)
    .values({
      definitionId: input.definitionId,
      revisionId: input.revisionId,
      userId: input.userId,
      message: input.message,
      authorKind: input.actorKind,
      surveyStepId: input.surveyStepId ?? null,
      ...(input.stamp ?? {})
    })
    .returning()

  return { comment: inserted, revisionVersion: revision.version }
}
