import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import { and, eq } from "drizzle-orm"
import {
  db,
  definitionsTable,
  surveyStepCompletionsTable,
  surveyStepPositionsTable,
  votesTable
} from "@yamz/db"
import { baseProcedure, createTRPCRouter } from "../init"
import { authenticatedProcedure, contributorProcedure } from "../procedures"
import { requireRunner } from "./communities"
import { studyState } from "@/lib/communities"
import { lockMembershipIn, membershipIn } from "@/lib/community-queries"
import { collectionMembers } from "@/lib/kos-queries"
import { studyById, studyBySlug } from "@/lib/study-queries"
import {
  actMatchesStep,
  DEFAULT_QUESTIONS,
  mayParticipate,
  mayRegenerateSteps,
  planSteps,
  recordCompletion,
  type Act,
  type Step
} from "@/lib/surveys"
import {
  actNamesStep,
  appendQuestionStep,
  completionCountOfStudy,
  gateOf,
  instructionPromptOfStudy,
  lockStudy,
  nextPositionFor,
  positionsOf,
  recordResponse,
  replaceSteps,
  stepWithStudy,
  studyProgress,
  walkthroughOf
} from "@/lib/survey-queries"
import {
  acceptPositionCandidate,
  recordPositionCompletion,
  SurveyPositionConflictError,
  SurveyPositionTargetError
} from "@/lib/survey-positions"
import { StaleRevisionError, VoteTargetMissingError } from "@/lib/participation"
import {
  SURVEY_PROMPT_MAX_LENGTH,
  SURVEY_RESPONSE_MAX_LENGTH
} from "@/lib/input-limits"
import { communityPath, studyPath } from "@/lib/public-identifiers"

/*
 * The survey walkthrough: the ordered steps of a study, and a participant's
 * way through them. A steward generates and extends the steps; a member of
 * the community walks them while the study is open. The acts a step asks
 * for are the ordinary writes in votes, comments and definitions, which
 * take the step as context and check it through requireStepForAct below.
 * The rules are in lib/surveys.ts, so the pages, the pilot driver and
 * scripts/test-surveys.ts answer each question the way this file does.
 */

const questionSchema = z.object({
  prompt: z.string().trim().min(1).max(SURVEY_PROMPT_MAX_LENGTH),
  responseKind: z.enum(["text", "scale"])
})
export const expectedInstructionsSchema = z
  .string()
  .max(SURVEY_PROMPT_MAX_LENGTH)
  .nullable()

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// The SQLSTATE of a database refusal, however drizzle wrapped it.
export const sqlState = (error: unknown) => {
  const cause = (error as { cause?: { code?: unknown } }).cause
  return String(cause?.code ?? (error as { code?: unknown }).code ?? "")
}

// A step a write named was deleted under it: the steward regenerated the
// walkthrough between the page loading and the press, and the foreign key
// refused the row. The same answer from every write that names a step.
export const regeneratedConflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "The walkthrough was regenerated. Reload the page."
  })

const requireStudy = async (studyId: number) => {
  const study = await studyById(studyId)
  if (!study)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This study doesn't exist"
    })
  return study
}

/*
 * A step and its study, for a caller who may act in it: a live membership of
 * a community that is not retired, and an open study. FORBIDDEN names the
 * membership and BAD_REQUEST the window, so the shell can say which.
 */
const requireParticipation = async (
  stepId: number,
  userId: number,
  executor: typeof db | DatabaseTransaction = db
) => {
  const found = await stepWithStudy(executor, stepId)
  if (!found)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This step doesn't exist"
    })
  if (found.community.retiredAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This community has been retired"
    })

  const membership = await membershipIn(
    found.study.communityId,
    userId,
    executor
  )
  if (!mayParticipate(membership, studyState(found.study))) {
    if (!membership)
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Only a member of the community running this study can take part"
      })
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This study is not open"
    })
  }
  return found
}

/*
 * Serialize every walkthrough act with study edits and step generation. The
 * caller's first read gives us the study id needed to take the lock in the
 * common study-first order; the second read is authoritative after any writer
 * that was already holding the lock has committed.
 */
export const lockParticipation = async (
  tx: DatabaseTransaction,
  stepId: number,
  studyId: number,
  userId: number,
  expectedInstructions: string | null
) => {
  const lockedStudy = await lockStudy(tx, studyId)
  if (!lockedStudy) throw regeneratedConflict()
  await lockMembershipIn(tx, lockedStudy.communityId, userId)
  let found
  try {
    found = await requireParticipation(stepId, userId, tx)
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND")
      throw regeneratedConflict()
    throw error
  }
  if (found.study.id !== studyId) throw regeneratedConflict()
  const currentInstructions = await instructionPromptOfStudy(tx, studyId)
  if (currentInstructions !== expectedInstructions)
    throw new TRPCError({
      code: "CONFLICT",
      message: "The study instructions changed. Reload the walkthrough."
    })
  return found
}

/*
 * For votes.vote, comments.create and definitions.create: the step an act
 * names must be one the caller may act in, and must be a step for that act
 * on that term: an upvote accepts a candidate in a define step, and a vote
 * of either kind compares in a review step. Checked before the write;
 * drizzle/invariants.sql proves afterwards that it held.
 */
const notForThisAct = () =>
  new TRPCError({
    code: "BAD_REQUEST",
    message: "That step is not for this act"
  })

export const requireStepForAct = async (
  stepId: number,
  userId: number,
  act: Act
) => {
  const found = await requireParticipation(stepId, userId)
  if (!actMatchesStep(act, found.step)) throw notForThisAct()
  return found
}

// The same check for a comment or a vote, whose term is the term of the
// definition acted on: the definition is looked up first, so the act is
// checked against the step before anything is written.
export const requireStepForDefinitionAct = async (
  stepId: number,
  userId: number,
  act: { definitionId: number } & (
    | { kind: "comment" }
    | { kind: "vote"; vote: "up" | "down" }
  )
) => {
  const target = await db.query.definitionsTable.findFirst({
    columns: { termId: true },
    where: eq(definitionsTable.id, act.definitionId)
  })
  if (!target)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Definition doesn't exist"
    })
  return requireStepForAct(
    stepId,
    userId,
    act.kind === "vote"
      ? { kind: "vote", termId: target.termId, vote: act.vote }
      : { kind: "comment", termId: target.termId }
  )
}

/*
 * For a vote or a definition inside a define step, in the transaction that
 * writes it: a participant takes one position per define step, so an act
 * of the caller already naming the step refuses a second, and so does the
 * completion of the step. For an ordinary vote, the act is the kind the vote
 * will stand at: a cast on a candidate the caller already upvoted is a
 * withdrawal, and a withdrawal names no define step. Accept is different:
 * it preserves an existing upvote instead of toggling it off. The definition
 * row is held first, as castVote holds it, so either path sees one vote state.
 */
export const requireOnePosition = async (
  tx: DatabaseTransaction,
  step: Step,
  userId: number,
  vote?: {
    definitionId: number
    revisionId: number
    vote: "up" | "down"
    preserveMatchingVote?: boolean
  }
) => {
  let voteState: {
    standingVote: "up" | "down" | null
    score: number
  } | null = null
  if (vote) {
    if (step.termId === null) throw notForThisAct()
    const [target] = await tx
      .select({
        termId: definitionsTable.termId,
        currentRevisionId: definitionsTable.currentRevisionId,
        score: definitionsTable.score
      })
      .from(definitionsTable)
      .where(eq(definitionsTable.id, vote.definitionId))
      .for("update")
    if (!target)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Definition doesn't exist"
      })
    if (target.termId !== step.termId) throw notForThisAct()
    if (target.currentRevisionId !== vote.revisionId)
      throw new TRPCError({
        code: "CONFLICT",
        message: "A newer revision is available. Review it before voting again."
      })
    const standing = await tx.query.votesTable.findFirst({
      columns: { kind: true },
      where: and(
        eq(votesTable.userId, userId),
        eq(votesTable.revisionId, vote.revisionId)
      )
    })
    const kind =
      vote.preserveMatchingVote || standing?.kind !== vote.vote
        ? vote.vote
        : null
    if (
      !actMatchesStep({ kind: "vote", termId: step.termId, vote: kind }, step)
    )
      throw notForThisAct()
    voteState = {
      standingVote: standing?.kind ?? null,
      score: target.score
    }
  }
  const [completion] = await tx
    .select({ id: surveyStepCompletionsTable.id })
    .from(surveyStepCompletionsTable)
    .where(
      and(
        eq(surveyStepCompletionsTable.stepId, step.id),
        eq(surveyStepCompletionsTable.userId, userId)
      )
    )
    .limit(1)
  if (completion || (await actNamesStep(tx, step.id, userId)))
    throw new TRPCError({
      code: "CONFLICT",
      message: "Your position on this term is recorded"
    })
  return voteState
}

export const surveysRouter = createTRPCRouter({
  /*
   * The walkthrough as one viewer sees it. Public study, private progress:
   * a signed-out viewer gets the steps and no completions, and a member gets
   * their completions, the facts each gate takes and where to resume.
   */
  get: baseProcedure
    .input(z.object({ studySlug: z.string().min(1) }))
    .query(async ({ ctx: { userId }, input: { studySlug } }) => {
      const study = await studyBySlug(studySlug)
      if (!study)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This study doesn't exist"
        })

      const viewerId = userId ?? null
      const [walkthrough, membership] = await Promise.all([
        walkthroughOf(db, study.id, viewerId),
        viewerId === null
          ? Promise.resolve(null)
          : membershipIn(study.communityId, viewerId)
      ])

      return {
        study: {
          id: study.id,
          slug: study.slug,
          title: study.title,
          state: studyState(study),
          communitySlug: study.communitySlug,
          collectionSlug: study.collectionSlug
        },
        membership,
        ...walkthrough
      }
    }),

  /*
   * Plan the steps from the collection of the study and write them, replacing
   * whatever was there. Only while nobody has started: after the first
   * completion a participant's position is a position in this list, and the
   * steps may only be appended to. Questions given here come before the two
   * closing questions, which are included unless the steward says otherwise.
   */
  generateSteps: authenticatedProcedure
    .input(
      z.object({
        studyId: z.number().int(),
        questions: z.array(questionSchema).max(20).optional(),
        includeDefaultQuestions: z.boolean().default(true)
      })
    )
    .mutation(async ({ ctx: { userId }, input }) => {
      const study = await requireStudy(input.studyId)
      await requireRunner(study.communityId, userId)
      if (study.retiredAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This study has been retired"
        })

      const questions = [
        ...(input.questions ?? []),
        ...(input.includeDefaultQuestions ? DEFAULT_QUESTIONS : [])
      ]

      let steps
      try {
        steps = await db.transaction(async (tx) => {
          // The study row is held first, so an append running at the same
          // time waits for the renumbering. Counted inside the transaction
          // that deletes, so a completion landing in between is refused by
          // the foreign key below rather than lost with its step.
          const currentStudy = await lockStudy(tx, study.id)
          if (!currentStudy)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "This study doesn't exist"
            })
          if (
            currentStudy.retiredAt ||
            currentStudy.communityRetiredAt ||
            currentStudy.collectionRetiredAt
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "This study or one of its parents has been retired"
            })
          const terms = await collectionMembers(currentStudy.collectionId, tx)
          if (terms.length === 0)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Add terms to the collection of this study first"
            })
          if (!mayRegenerateSteps(await completionCountOfStudy(tx, study.id)))
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Someone has started this walkthrough, so its steps can only be added to"
            })
          const plan = planSteps({
            welcome: currentStudy.welcome,
            terms,
            questions
          })
          return replaceSteps(tx, study.id, plan)
        })
      } catch (error) {
        // An act already names a step, and the delete refused by foreign key.
        if (sqlState(error) === "23503")
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "An act already refers to a step of this walkthrough, so its steps can only be added to"
          })
        // A position was taken under the plan.
        if (sqlState(error) === "23505") throw regeneratedConflict()
        throw error
      }

      revalidatePath(studyPath(study.slug))
      revalidatePath(communityPath(study.communitySlug))

      return { ok: true, steps: steps.length }
    }),

  // Append one question after the last step. Allowed whether or not anyone
  // has started: an appended step moves nobody's position.
  addQuestionStep: authenticatedProcedure
    .input(questionSchema.extend({ studyId: z.number().int() }))
    .mutation(
      async ({ ctx: { userId }, input: { studyId, prompt, responseKind } }) => {
        const study = await requireStudy(studyId)
        await requireRunner(study.communityId, userId)
        if (study.retiredAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This study has been retired"
          })

        let step
        try {
          step = await db.transaction(async (tx) => {
            const currentStudy = await lockStudy(tx, study.id)
            if (!currentStudy)
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "This study doesn't exist"
              })
            if (
              currentStudy.retiredAt ||
              currentStudy.communityRetiredAt ||
              currentStudy.collectionRetiredAt
            )
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "This study or one of its parents has been retired"
              })
            return appendQuestionStep(tx, study.id, { prompt, responseKind })
          })
        } catch (error) {
          // Two appends at once computed the same position.
          if (sqlState(error) === "23505")
            throw new TRPCError({
              code: "CONFLICT",
              message: "Another step was added at the same time. Try again."
            })
          throw error
        }

        revalidatePath(studyPath(study.slug))
        revalidatePath(communityPath(study.communitySlug))

        return step
      }
    ),

  /*
   * Accept one exact candidate as the participant's position. Unlike the
   * general vote toggle, Accept preserves an upvote already on the candidate;
   * no vote becomes up and a downvote changes to up. The vote state, explicit
   * position record and step completion commit together.
   */
  acceptPosition: contributorProcedure
    .input(
      z.object({
        stepId: z.number().int(),
        definitionId: z.number().int().positive(),
        revisionId: z.number().int().positive(),
        expectedInstructions: expectedInstructionsSchema
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: { stepId, definitionId, revisionId, expectedInstructions }
      }) => {
        const preview = await requireStepForDefinitionAct(stepId, userId, {
          kind: "vote",
          definitionId,
          vote: "up"
        })
        if (preview.step.kind !== "define") throw notForThisAct()

        try {
          return await db.transaction(async (tx) => {
            const { step, study } = await lockParticipation(
              tx,
              stepId,
              preview.study.id,
              userId,
              expectedInstructions
            )
            if (step.kind !== "define") throw notForThisAct()

            // A retry of the same target converges: an Accept whose response
            // was lost already recorded this exact position, so answer as the
            // first attempt did instead of reporting a conflict. A different
            // target, or a legacy completion with no position row to compare,
            // is a real conflict, reported by requireOnePosition below.
            const recorded = await tx.query.surveyStepPositionsTable.findFirst({
              where: and(
                eq(surveyStepPositionsTable.stepId, step.id),
                eq(surveyStepPositionsTable.userId, userId)
              )
            })
            if (
              recorded &&
              recorded.kind === "accepted" &&
              recorded.definitionId === definitionId &&
              recorded.revisionId === revisionId
            ) {
              const target = await tx.query.definitionsTable.findFirst({
                columns: { score: true },
                where: eq(definitionsTable.id, definitionId)
              })
              return {
                ok: true,
                score: target?.score ?? 0,
                nextPosition: await nextPositionFor(tx, study.id, userId)
              }
            }

            const voteState = await requireOnePosition(tx, step, userId, {
              definitionId,
              revisionId,
              vote: "up",
              preserveMatchingVote: true
            })
            if (!voteState) throw notForThisAct()

            const accepted = await acceptPositionCandidate(tx, {
              stepId: step.id,
              termId: step.termId!,
              userId,
              definitionId,
              revisionId,
              actorKind: "human",
              communityId: study.communityId
            })
            return {
              ok: true,
              score: accepted.score,
              nextPosition: await nextPositionFor(tx, study.id, userId)
            }
          })
        } catch (error) {
          if (error instanceof SurveyPositionConflictError)
            throw new TRPCError({ code: "CONFLICT", message: error.message })
          if (error instanceof SurveyPositionTargetError)
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message })
          if (error instanceof VoteTargetMissingError)
            throw new TRPCError({ code: "NOT_FOUND", message: error.message })
          if (error instanceof StaleRevisionError)
            throw new TRPCError({ code: "CONFLICT", message: error.message })
          if (sqlState(error) === "23503") throw regeneratedConflict()
          throw error
        }
      }
    ),

  /*
   * Press through a step. Instructions and review complete on the press, and
   * a question requires its existing answer. Accept and definition publication
   * own new Position completion, while this endpoint can finish a position act
   * written by the former two-request client.
   * Completing twice is not an error. Returns where the caller resumes.
   * The order of the steps is a rule of the shell, not of the router: any
   * completion whose gate passes is recorded.
   *
   * A completion reaches no graph, so the press does not mark the graphs
   * for a rebuild, unlike the acts a step asks for.
   */
  completeStep: contributorProcedure
    .meta({ marksGraphs: false })
    .input(
      z.object({
        stepId: z.number().int(),
        expectedInstructions: expectedInstructionsSchema
      })
    )
    .mutation(
      async ({ ctx: { userId }, input: { stepId, expectedInstructions } }) => {
        const preview = await requireParticipation(stepId, userId)

        try {
          const nextPosition = await db.transaction(async (tx) => {
            const { step, study } = await lockParticipation(
              tx,
              stepId,
              preview.study.id,
              userId,
              expectedInstructions
            )
            if (step.kind === "define") {
              const [existing] = await tx
                .select({ id: surveyStepCompletionsTable.id })
                .from(surveyStepCompletionsTable)
                .where(
                  and(
                    eq(surveyStepCompletionsTable.stepId, step.id),
                    eq(surveyStepCompletionsTable.userId, userId)
                  )
                )
                .limit(1)
              if (!existing) {
                // Recover the former two-request client path after its vote
                // or proposal succeeded but before it recorded completion.
                const held = (await positionsOf(tx, [step.id], userId)).get(
                  step.id
                )
                if (!held)
                  throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message:
                      "Choose Accept, Suggest a revision, or Propose a replacement to record this position."
                  })
                await recordPositionCompletion(tx, {
                  stepId: step.id,
                  userId,
                  kind: held.kind,
                  definitionId: held.definitionId,
                  revisionId: held.revisionId
                })
              }
            } else {
              const gate = await gateOf(tx, step, userId)
              if (!gate.ok)
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: gate.reason
                })
              await recordCompletion(tx, { stepId: step.id, userId })
            }
            return nextPositionFor(tx, study.id, userId)
          })
          return { ok: true, nextPosition }
        } catch (error) {
          if (sqlState(error) === "23503") throw regeneratedConflict()
          throw error
        }
      }
    ),

  /*
   * Answer a question and complete it, in one transaction. The answer
   * arrives in the form the step asked for and in no other, and a question
   * is answered once: the unique pair refuses a second answer. An answer
   * reaches no graph, as a completion does not.
   */
  answerQuestion: contributorProcedure
    .meta({ marksGraphs: false })
    .input(
      z.object({
        stepId: z.number().int(),
        expectedInstructions: expectedInstructionsSchema,
        valueText: z
          .string()
          .trim()
          .min(1)
          .max(SURVEY_RESPONSE_MAX_LENGTH)
          .optional(),
        valueScale: z.number().int().min(1).max(5).optional()
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: { stepId, expectedInstructions, valueText, valueScale }
      }) => {
        const preview = await requireParticipation(stepId, userId)
        if (preview.step.kind !== "question")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That step is not a question"
          })

        const wantsText = preview.step.responseKind === "text"
        const fits = wantsText
          ? valueText !== undefined && valueScale === undefined
          : valueScale !== undefined && valueText === undefined
        if (!fits)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: wantsText
              ? "This question takes a written answer"
              : "This question takes a number from 1 to 5"
          })

        try {
          const nextPosition = await db.transaction(async (tx) => {
            const { step, study } = await lockParticipation(
              tx,
              stepId,
              preview.study.id,
              userId,
              expectedInstructions
            )
            if (step.kind !== "question")
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "That step is not a question"
              })
            const lockedWantsText = step.responseKind === "text"
            if (lockedWantsText !== wantsText) throw regeneratedConflict()
            // A session answer is a human act, as a session comment is.
            await recordResponse(tx, {
              stepId: step.id,
              userId,
              authorKind: "human",
              valueText: valueText ?? null,
              valueScale: valueScale ?? null
            })
            return nextPositionFor(tx, study.id, userId)
          })
          return { ok: true, nextPosition }
        } catch (error) {
          if (sqlState(error) === "23505")
            throw new TRPCError({
              code: "CONFLICT",
              message: "You have already answered this question"
            })
          if (sqlState(error) === "23503") throw regeneratedConflict()
          throw error
        }
      }
    ),

  // The steward's view: per participant, steps completed out of the total,
  // and per step, how many have completed it. Names come with the public
  // flag, for the same treatment the roster gives them.
  progressOfStudy: authenticatedProcedure
    .input(z.object({ studyId: z.number().int() }))
    .query(async ({ ctx: { userId }, input: { studyId } }) => {
      const study = await requireStudy(studyId)
      await requireRunner(study.communityId, userId)

      const progress = await studyProgress(db, study.id)
      if (!progress)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This study doesn't exist"
        })
      return progress
    })
})
