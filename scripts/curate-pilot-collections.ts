import { and, eq, isNull, sql } from "drizzle-orm"
import type { db } from "../drizzle/connection"
import { statementsTable } from "../drizzle/schema"

export type CollectionMembershipMode = "additive" | "exact"

export type CollectionMembershipDelta = {
  add: number[]
  retract: number[]
}

export const planCollectionMembership = (
  liveTermIds: Iterable<number>,
  wantedTermIds: Iterable<number>,
  mode: CollectionMembershipMode
): CollectionMembershipDelta => {
  const live = new Set(liveTermIds)
  const wanted = new Set(wantedTermIds)
  return {
    add: [...wanted]
      .filter((termId) => !live.has(termId))
      .sort((a, b) => a - b),
    retract:
      mode === "exact"
        ? [...live]
            .filter((termId) => !wanted.has(termId))
            .sort((a, b) => a - b)
        : []
  }
}

export type WalkthroughUsage = {
  completions: number
  responses: number
  definitionRevisions: number
  voteEvents: number
  comments: number
}

export type CollectionStudyState = {
  slug: string
  retiredAt: string | null
  stepCount: number
  usage: WalkthroughUsage
}

const usageEntries = (usage: WalkthroughUsage) =>
  Object.entries(usage).filter(
    (entry): entry is [keyof WalkthroughUsage, number] => entry[1] > 0
  )

export const exactMembershipChangeRefusal = (
  hasChanges: boolean,
  study: CollectionStudyState
): string | null => {
  if (!hasChanges) return null

  const activity = usageEntries(study.usage)
  if (activity.length)
    return `study ${study.slug} has walkthrough activity (${activity
      .map(([kind, count]) => `${count} ${kind}`)
      .join(", ")})`

  if (!study.retiredAt && study.stepCount > 0)
    return `non-retired study ${study.slug} has ${study.stepCount} generated walkthrough steps`

  return null
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Transaction

export const retractCollectionTerm = async (
  executor: Executor,
  input: {
    statementId: number
    collectionId: number
    termId: number
    operatorId: number
  }
): Promise<boolean> => {
  const [retracted] = await executor
    .update(statementsTable)
    .set({ retractedAt: sql`now()`, retractedById: input.operatorId })
    .where(
      and(
        eq(statementsTable.id, input.statementId),
        eq(statementsTable.predicate, "skos:member"),
        eq(statementsTable.subjectCollectionId, input.collectionId),
        eq(statementsTable.objectTermId, input.termId),
        isNull(statementsTable.retractedAt)
      )
    )
    .returning({ id: statementsTable.id })
  return Boolean(retracted)
}
