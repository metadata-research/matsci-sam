export const SEARCH_HIGHLIGHT_START = "[[[matsci-search-hit]]]"
export const SEARCH_HIGHLIGHT_END = "[[[/matsci-search-hit]]]"

export const SEARCH_HEADLINE_OPTIONS = [
  `StartSel=${SEARCH_HIGHLIGHT_START}`,
  `StopSel=${SEARCH_HIGHLIGHT_END}`,
  "MaxWords=24",
  "MinWords=8",
  "MaxFragments=1"
].join(", ")

export const SEARCH_MATCH_SOURCES = [
  "term",
  "definition",
  "example",
  "similar"
] as const

export type SearchMatchSource = (typeof SEARCH_MATCH_SOURCES)[number]

export type SearchHighlightPart = {
  text: string
  highlighted: boolean
}

export type SearchMatchEvidence = {
  source: SearchMatchSource
  parts: SearchHighlightPart[]
}

/*
 * PostgreSQL ts_headline inserts distinctive plain-text markers. Convert those
 * markers into data before the result crosses tRPC, so React can render text
 * nodes and <mark> elements without accepting database-generated HTML.
 */
export const parseSearchHeadline = (
  headline: string
): SearchHighlightPart[] => {
  const parts: SearchHighlightPart[] = []
  let cursor = 0

  while (cursor < headline.length) {
    const start = headline.indexOf(SEARCH_HIGHLIGHT_START, cursor)
    if (start === -1) {
      parts.push({ text: headline.slice(cursor), highlighted: false })
      break
    }

    if (start > cursor)
      parts.push({ text: headline.slice(cursor, start), highlighted: false })

    const contentStart = start + SEARCH_HIGHLIGHT_START.length
    const end = headline.indexOf(SEARCH_HIGHLIGHT_END, contentStart)
    if (end === -1) {
      parts.push({ text: headline.slice(start), highlighted: false })
      break
    }

    parts.push({
      text: headline.slice(contentStart, end),
      highlighted: true
    })
    cursor = end + SEARCH_HIGHLIGHT_END.length
  }

  if (parts.length === 0 && headline)
    return [{ text: headline, highlighted: false }]

  return parts.filter((part) => part.text.length > 0)
}
