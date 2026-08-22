import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db, definitionsTable } from "@yamz/db"
import { baseProcedure, createTRPCRouter } from "../init"
import { authenticatedProcedure, contributorProcedure } from "../procedures"
import { requireRunner } from "./communities"
import { studyState } from "@/lib/communities"
import { membershipIn } from "@/lib/community-queries"
import { collectionMembers } from "@/lib/kos-queries"
import { studyById, studyBySlug } from "@/lib/study-queries"
import {
  actMatchesStep,
  DEFAULT_QUESTIONS,
  mayParticipate,
  mayRegenerateSteps,
  planSteps,
  recordCompletion,
  stepGate
} from "@/lib/surveys"
import {
  appendQuestionStep,
  completionCountOfStudy,
  hasOriginalDefinition,
  lockStudy,
  nextPositionFor,
  recordResponse,
  replaceSteps,
  responseOf,
  stepWithStudy,
  studyProgress,
  walkthroughOf
} from "@/lib/survey-queries"
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
const requireParticipation = async (stepId: number, userId: number) => {
  const found = await stepWithStudy(db, stepId)
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

  const membership = await membershipIn(found.study.communityId, userId)
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
 * For votes.vote, comments.create and definitions.create: the step an act
 * names must be one the caller may act in, and must be the step for that
 * act on that term. Checked before the write; drizzle/invariants.sql proves
 * afterwards that it held.
 */
export const requireStepForAct = async (
  stepId: number,
  userId: number,
  act: { kind: "comment" | "vote" | "define"; termId: number }
) => {
  const found = await requireParticipation(stepId, userId)
  if (!actMatchesStep(act, found.step))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "That step is not for this act"
    })
  return found
}

// The same check for a comment or a vote, whose term is the term of the
// definition acted on: the definition is looked up first, so the act is
// checked against the step before anything is written.
export const requireStepForDefinitionAct = async (
  stepId: number,
  userId: number,
  act: { kind: "comment" | "vote"; definitionId: number }
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
  return requireStepForAct(stepId, userId, {
    kind: act.kind,
    termId: target.termId
  })
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

      const terms = await collectionMembers(study.collectionId)
      if (terms.length === 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add terms to the collection of this study first"
        })

      const plan = planSteps({
        welcome: study.welcome,
        terms,
        questions: [
          ...(input.questions ?? []),
          ...(input.includeDefaultQuestions ? DEFAULT_QUESTIONS : [])
        ]
      })

      let steps
      try {
        steps = await db.transaction(async (tx) => {
          // The study row is held first, so an append running at the same
          // time waits for the renumbering. Counted inside the transaction
          // that deletes, so a completion landing in between is refused by
          // the foreign key below rather than lost with its step.
          await lockStudy(tx, study.id)
          if (!mayRegenerateSteps(await completionCountOfStudy(tx, study.id)))
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Someone has started this walkthrough, so its steps can only be added to"
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
            await lockStudy(tx, study.id)
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
   * Press through a step. Instructions and review complete on the press; a
   * define step requires the caller's own definition of the term, and a
   * question its answer, which answerQuestion records with the completion.
   * Completing twice is not an error. Returns where the caller resumes.
   *
   * A completion reaches no graph, so the press does not mark the graphs
   * for a rebuild, unlike the acts a step asks for.
   */
  completeStep: contributorProcedure
    .meta({ marksGraphs: false })
    .input(z.object({ stepId: z.number().int() }))
    .mutation(async ({ ctx: { userId }, input: { stepId } }) => {
      const { step, study } = await requireParticipation(stepId, userId)

      const gate = stepGate(step, {
        hasOriginalDefinition:
          step.kind === "define" &&
          step.termId !== null &&
          (await hasOriginalDefinition(db, step.termId, userId)),
        hasResponse:
          step.kind === "question" &&
          (await responseOf(db, step.id, userId)) !== null
      })
      if (!gate.ok)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: gate.reason
        })

      try {
        const nextPosition = await db.transaction(async (tx) => {
          await recordCompletion(tx, { stepId: step.id, userId })
          return nextPositionFor(tx, study.id, userId)
        })
        return { ok: true, nextPosition }
      } catch (error) {
        if (sqlState(error) === "23503") throw regeneratedConflict()
        throw error
      }
    }),

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
      async ({ ctx: { userId }, input: { stepId, valueText, valueScale } }) => {
        const { step, study } = await requireParticipation(stepId, userId)
        if (step.kind !== "question")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That step is not a question"
          })

        const wantsText = step.responseKind === "text"
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
