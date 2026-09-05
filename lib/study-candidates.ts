import { TRPCError } from "@trpc/server"
import { and, eq, isNull, sql } from "drizzle-orm"
import {
  db,
  definitionsTable,
  studyDefinitionExclusionsTable as exclusions,
  surveyStepsTable
} from "@yamz/db"
import { lockStudy } from "@/lib/survey-queries"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const excludedFromStudy = (studyId: number) => sql<boolean>`exists (
  select 1 from ${exclusions}
  where ${exclusions.studyId} = ${studyId}
    and ${exclusions.definitionId} = ${definitionsTable.id}
    and ${exclusions.restoredAt} is null
)`

// Call after locking the study, in the transaction that records the act.
export async function requireStudyCandidate(
  tx: Transaction,
  studyId: number,
  definitionId: number
) {
  const [excluded] = await tx
    .select({ id: exclusions.id })
    .from(exclusions)
    .where(
      and(
        eq(exclusions.studyId, studyId),
        eq(exclusions.definitionId, definitionId),
        isNull(exclusions.restoredAt)
      )
    )
    .limit(1)
  if (excluded)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This definition has been excluded from this study. Reload the walkthrough."
    })
}

export async function setStudyCandidateExcluded(input: {
  studyId: number
  definitionId: number
  excluded: boolean
  expectedExclusionId: number | null
  reason: string
  userId: number
}) {
  const reason = input.reason.trim()
  if (!reason || reason.length > 1000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enter a reason of up to 1,000 characters."
    })

  return db.transaction(async (tx) => {
    const study = await lockStudy(tx, input.studyId)
    if (!study)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This study does not exist."
      })
    const [target] = await tx
      .select({ id: definitionsTable.id })
      .from(definitionsTable)
      .innerJoin(
        surveyStepsTable,
        eq(surveyStepsTable.termId, definitionsTable.termId)
      )
      .where(
        and(
          eq(definitionsTable.id, input.definitionId),
          eq(surveyStepsTable.studyId, input.studyId)
        )
      )
      .limit(1)
    if (!target)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This definition is not part of the study terms."
      })

    const [active] = await tx
      .select({ id: exclusions.id })
      .from(exclusions)
      .where(
        and(
          eq(exclusions.studyId, input.studyId),
          eq(exclusions.definitionId, input.definitionId),
          isNull(exclusions.restoredAt)
        )
      )
      .limit(1)
    if ((active?.id ?? null) !== input.expectedExclusionId)
      throw new TRPCError({
        code: "CONFLICT",
        message: "The study selection changed. Reload it before saving."
      })
    if (input.excluded === Boolean(active)) return { ok: true }

    if (input.excluded) {
      await tx
        .insert(exclusions)
        .values({
          studyId: input.studyId,
          definitionId: input.definitionId,
          reason,
          excludedById: input.userId
        })
    } else {
      await tx
        .update(exclusions)
        .set({
          restoredById: input.userId,
          restoredAt: sql`clock_timestamp()`,
          restorationReason: reason
        })
        .where(eq(exclusions.id, active!.id))
    }
    return { ok: true }
  })
}
