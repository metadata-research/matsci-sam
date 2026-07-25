export const SEARCH_AUTHORS = ["all", "human", "ai"] as const

export type SearchAuthor = (typeof SEARCH_AUTHORS)[number]

export function parseSearchAuthor(value: string | null): SearchAuthor {
  return SEARCH_AUTHORS.some((author) => author === value)
    ? (value as SearchAuthor)
    : "all"
}

export type SearchResultType = "terms" | "definitions"

export type SearchResultSelection = {
  showTerms: boolean
  showDefinitions: boolean
}

export function updateSearchResultSelection(
  current: SearchResultSelection,
  type: SearchResultType,
  checked: boolean
): SearchResultSelection {
  if (
    !checked &&
    ((type === "terms" && !current.showDefinitions) ||
      (type === "definitions" && !current.showTerms))
  )
    return current

  return type === "terms"
    ? { ...current, showTerms: checked }
    : { ...current, showDefinitions: checked }
}
