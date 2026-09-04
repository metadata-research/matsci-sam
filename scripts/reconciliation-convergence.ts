import type { StudyCopyPlan } from "../lib/study-copy-sync"

const DURABLE_CURATION_OUTCOMES = new Set([
  "created",
  "moved",
  "retracted",
  "retired",
  "updated"
])

export type CurationConvergenceItem = {
  outcome: string
  write?: unknown
  verificationOnly?: boolean
}

// A durable outcome is always a change. A callback is also assumed to change
// data unless it is one of the explicitly marked transaction-only guards. This
// keeps silent callbacks inside the convergence gate instead of depending on
// which plan items happen to be rendered for an operator.
export const plannedCurationChanges = <T extends CurationConvergenceItem>(
  items: readonly T[]
): T[] =>
  items.filter(
    (item) =>
      DURABLE_CURATION_OUTCOMES.has(item.outcome) ||
      (item.write !== undefined && !item.verificationOnly)
  )

export type StudyCopyConvergence = {
  changeCount: number
  refusalCount: number
  converged: boolean
}

export const studyCopyConvergence = (
  plans: readonly Pick<StudyCopyPlan, "changes" | "refusals">[]
): StudyCopyConvergence => {
  const changeCount = plans.reduce(
    (total, plan) => total + plan.changes.length,
    0
  )
  const refusalCount = plans.reduce(
    (total, plan) => total + plan.refusals.length,
    0
  )
  return {
    changeCount,
    refusalCount,
    converged: changeCount === 0 && refusalCount === 0
  }
}
