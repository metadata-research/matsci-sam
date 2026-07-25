import { TERM_MAX_LENGTH } from "@/lib/input-limits"

export function initialTermFromSearchParam(
  term: string | string[] | undefined
) {
  const firstTerm = Array.isArray(term) ? term[0] : term
  return (firstTerm ?? "").trim().slice(0, TERM_MAX_LENGTH)
}
