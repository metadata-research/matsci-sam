import "server-only"

import { db, studiesTable, surveyStepsTable } from "@yamz/db"
import { TRPCError } from "@trpc/server"
import { asc, eq } from "drizzle-orm"
import {
  instructionEditability,
  normalizeStudyInstructions,
  studyWindowError
} from "@/lib/study-editor"
import { lockStudy, walkthroughUsageOfStudy } from "@/lib/survey-queries"
import { DEFAULT_INSTRUCTIONS, isDefaultInstructions } from "@/lib/surveys"

export type ExpectedStudyState = {
  title: string
  welcome: string | null
  opensAt: string | null
  closesAt: string | null
  retiredAt: string | null
}

export type StudyUpdate = {
  studyId: number
  title?: string
  instructions?: string | null
  opensAt?: string | null
  closesAt?: string | null
  expected?: ExpectedStudyState
}

export type StudyLifecycleUpdate = {
  studyId: number
  retired: boolean
  expectedRetiredAt?: string | null
}

const staleStudy = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "This study changed after you opened it. Reload before saving."
  })

const throwWindowError = (opensAt: string | null, closesAt: string | null) => {
  const error = studyWindowError(opensAt, closesAt)
  if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error })
}

/**
 * Update the participant-visible parts of a study under one lock.
 *
 * Callers remain responsible for authorization. The optional expected state is
 * the admin editor's optimistic-concurrency guard; legacy steward updates omit
 * it but still receive the same activity locks and instructions synchronization.
 */
export const updateStudyDetails = async (input: StudyUpdate) => {
  if (
    input.title === undefined &&
    input.instructions === undefined &&
    input.opensAt === undefined &&
    input.closesAt === undefined
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "There are no changes to save."
    })

  return db.transaction(async (tx) => {
    const study = await lockStudy(tx, input.studyId)
    if (!study)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This study does not exist."
      })

    const expected = input.expected
    if (
      expected &&
      (study.title !== expected.title ||
        study.welcome !== expected.welcome ||
        study.opensAt !== expected.opensAt ||
        study.closesAt !== expected.closesAt ||
        study.retiredAt !== expected.retiredAt)
    )
      throw staleStudy()

    if (study.retiredAt)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Restore this study before editing it."
      })
    if (study.communityRetiredAt || study.collectionRetiredAt)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Restore this study's community and collection before editing it."
      })

    const nextTitle = input.title ?? study.title
    const nextWelcome =
      input.instructions === undefined
        ? study.welcome
        : normalizeStudyInstructions(input.instructions ?? "")
    const nextOpensAt =
      input.opensAt === undefined ? study.opensAt : input.opensAt
    const nextClosesAt =
      input.closesAt === undefined ? study.closesAt : input.closesAt
    throwWindowError(nextOpensAt, nextClosesAt)

    const welcomeChanged = nextWelcome !== study.welcome
    const windowChanged =
      nextOpensAt !== study.opensAt || nextClosesAt !== study.closesAt
    let instructionStepId: number | null = null
    let instructionPromptChanged = false

    if (input.instructions !== undefined || windowChanged) {
      const steps = await tx
        .select({
          id: surveyStepsTable.id,
          position: surveyStepsTable.position,
          kind: surveyStepsTable.kind,
          prompt: surveyStepsTable.prompt
        })
        .from(surveyStepsTable)
        .where(eq(surveyStepsTable.studyId, study.id))
        .orderBy(asc(surveyStepsTable.position), asc(surveyStepsTable.id))
        .for("update")
      const usage = await walkthroughUsageOfStudy(tx, study.id)
      const editability = instructionEditability({ steps, usage })
      const instructionStep = steps.find(
        (step) => step.kind === "instructions" && step.position === 1
      )
      instructionStepId = instructionStep?.id ?? null
      instructionPromptChanged =
        input.instructions !== undefined &&
        instructionStep !== undefined &&
        (nextWelcome === null
          ? !isDefaultInstructions(instructionStep.prompt)
          : instructionStep.prompt !== nextWelcome)

      if (windowChanged && editability.activity > 0)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The schedule is locked because this study has recorded activity."
        })
      if (
        input.instructions !== undefined &&
        (welcomeChanged || instructionPromptChanged) &&
        !editability.editable
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: editability.reason ?? "These instructions are locked."
        })
    }

    const changes: {
      title?: string
      welcome?: string | null
      opensAt?: string | null
      closesAt?: string | null
    } = {}
    if (nextTitle !== study.title) changes.title = nextTitle
    if (welcomeChanged) changes.welcome = nextWelcome
    if (nextOpensAt !== study.opensAt) changes.opensAt = nextOpensAt
    if (nextClosesAt !== study.closesAt) changes.closesAt = nextClosesAt
    if (Object.keys(changes).length === 0 && !instructionPromptChanged)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "There are no changes to save."
      })

    if (Object.keys(changes).length > 0) {
      const studyRows = await tx
        .update(studiesTable)
        .set(changes)
        .where(eq(studiesTable.id, study.id))
        .returning({ id: studiesTable.id })
      if (studyRows.length !== 1) throw staleStudy()
    }

    if (instructionPromptChanged && instructionStepId !== null) {
      const stepRows = await tx
        .update(surveyStepsTable)
        .set({ prompt: nextWelcome ?? DEFAULT_INSTRUCTIONS })
        .where(eq(surveyStepsTable.id, instructionStepId))
        .returning({ id: surveyStepsTable.id })
      if (stepRows.length !== 1) throw staleStudy()
    }

    return {
      id: study.id,
      slug: study.slug,
      communityId: study.communityId,
      communitySlug: study.communitySlug
    }
  })
}

/** Retire or restore a study under the same lock used by edits and activity. */
export const setStudyRetired = async (input: StudyLifecycleUpdate) =>
  db.transaction(async (tx) => {
    const study = await lockStudy(tx, input.studyId)
    if (!study)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This study does not exist."
      })

    if (
      input.expectedRetiredAt !== undefined &&
      study.retiredAt !== input.expectedRetiredAt
    )
      throw staleStudy()

    if (input.retired === Boolean(study.retiredAt)) {
      if (input.expectedRetiredAt !== undefined)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: input.retired
            ? "This study is already retired."
            : "This study is already active."
        })
      return {
        id: study.id,
        slug: study.slug,
        communityId: study.communityId,
        communitySlug: study.communitySlug
      }
    }

    if (
      !input.retired &&
      (study.communityRetiredAt || study.collectionRetiredAt)
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Restore the study's community and collection before restoring the study."
      })

    const rows = await tx
      .update(studiesTable)
      .set({ retiredAt: input.retired ? new Date().toISOString() : null })
      .where(eq(studiesTable.id, study.id))
      .returning({ id: studiesTable.id })
    if (rows.length !== 1) throw staleStudy()

    return {
      id: study.id,
      slug: study.slug,
      communityId: study.communityId,
      communitySlug: study.communitySlug
    }
  })
