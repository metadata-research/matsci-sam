import { studyState } from "@/lib/communities"

type Row = {
  steps: number
  saved?: number
  opensAt: string | null
  closesAt: string | null
  retiredAt: string | null
}

/*
 * The viewer's saved progress through a study's walkthrough, as the studies
 * index and the profile both say it, or null where there is nothing to say:
 * a row that carries no count, a study without a walkthrough, or one that
 * is not open and was never started.
 */
export const walkthroughProgress = (study: Row): string | null => {
  if (study.saved === undefined) return null
  if (study.steps === 0) return null
  if (study.saved === study.steps) return "Finished"
  if (study.saved > 0) return `${study.saved} of ${study.steps} steps saved`
  return studyState(study) === "open" ? "Not started" : null
}
