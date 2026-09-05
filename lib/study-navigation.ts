type NavigationStep = { position: number; completed: boolean }

// Completed records remain available for reading even when a paired Review
// was skipped beyond the first unfinished step. That later completion does
// not unlock the step after it.
export const mayOpenStudyStep = (
  steps: NavigationStep[],
  resumeAt: number | null,
  position: number
) =>
  position === (resumeAt ?? steps.length + 1) ||
  steps[position - 1]?.completed === true

// Continue reads the next completed record when there is one. If a future
// skipped Review is followed by an unfinished step, return to the first
// unfinished step instead of jumping across the gap.
export const nextStudyPosition = (
  steps: NavigationStep[],
  resumeAt: number | null,
  currentPosition: number
) => {
  const resume = resumeAt ?? steps.length + 1
  const next = currentPosition + 1
  return next <= steps.length && mayOpenStudyStep(steps, resumeAt, next)
    ? next
    : resume
}
