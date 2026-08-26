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

const FACET_KEY = /^[a-z0-9][a-z0-9_-]*:[a-z0-9][a-z0-9_-]*$/

export function parseSearchFacets(values: string[]): string[] {
  return [...new Set(values.filter((value) => FACET_KEY.test(value)))].slice(
    0,
    20
  )
}

export function updateSearchFacetSelection(
  current: string[],
  key: string,
  checked: boolean
): string[] {
  if (!FACET_KEY.test(key)) return current
  if (checked) return current.includes(key) ? current : [...current, key]
  return current.filter((value) => value !== key)
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
