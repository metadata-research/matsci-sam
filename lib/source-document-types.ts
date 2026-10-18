/** Offsets throughout this module are UTF-16 positions in the saved transcript. */
export const SOURCE_MAX_BYTES = 5 * 1024 * 1024
export const SOURCE_MAX_PAGES = 50
export const SOURCE_MAX_CHARACTERS = 200000
export const SOURCE_MAX_ALIASES = 20
export const SOURCE_MAX_SELECTED_PASSAGES = 100
export const SOURCE_PARSER_VERSION = "source-extraction-v1"
export const SOURCE_MATCHER_VERSION = "unicode-phrase-v1"

export type SourceMethod = "embedded" | "ocr" | "docx" | "text"
export type SourceLocation = {
  page: number | null
  start: number
  end: number
  method: SourceMethod
  label: string
}
export type SourcePage = SourceLocation & { confidence: number | null }
export type SourceMatch = {
  id: string
  start: number
  end: number
  text: string
  matchedTerm: string
  isAlias: boolean
  page: number | null
}
export type SourcePassage = {
  id: string
  start: number
  end: number
  text: string
  locations: SourceLocation[]
  matchIds: string[]
}
export type SourceExtractionResult = {
  text: string
  textHash: string
  pages: SourcePage[]
  hasOcr: boolean
  method: string
  parserVersion: string
}
export type SourceDocumentCheck = {
  term: string
  aliases: string[]
  matches: SourceMatch[]
  passages: SourcePassage[]
  matcherVersion: string
}
export type SourceContextSelection = {
  fileId: string
  checkId: string
  mode: "passages" | "full"
  passageIds: string[]
  ocrReviewed: boolean
}
export type SourceExtractionStep = {
  id: string
  parentExtractionId: string | null
  correctedById: number | null
  textHash: string
  parserVersion: string
  method: string
  hasOcr: boolean
  completedAt: string
}
export type SourceInputSnapshot = {
  fileId: string
  extractionId: string
  checkId: string
  title: string
  origin: "upload" | "paste"
  fileHash: string
  extractionTextHash: string
  text: string
  textHash: string
  mode: "passages" | "full"
  term: string
  aliases: string[]
  matches: SourceMatch[]
  locations: SourceLocation[]
  parserVersion: string
  method?: string
  hasOcr: boolean
  ocrReviewed: boolean
  extractedAt: string
  checkedAt: string
  matcherVersion: string
  ocrReviewRecordedAt: string | null
  reviewerId: number | null
  contextSelectedAt: string
  extractionSteps?: SourceExtractionStep[]
}

/** Shared preview/server assembly; passage order follows the source transcript. */
export function sourceSelectionText(
  text: string,
  passages: SourcePassage[],
  selection: Pick<SourceContextSelection, "mode" | "passageIds">
) {
  if (selection.mode === "full") return text
  const ids = new Set(selection.passageIds)
  const selected = passages
    .filter((passage) => ids.has(passage.id))
    .sort((a, b) => a.start - b.start)
  if (selected.length !== ids.size)
    throw new Error(
      "A selected passage is unavailable. Check the source again."
    )
  return selected
    .map((passage) => text.slice(passage.start, passage.end))
    .join("\n\n")
}
