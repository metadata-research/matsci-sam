import { DEFINITION_MAX_LENGTH, TERM_MAX_LENGTH } from "./input-limits"
import { termLabelKey } from "./term-label-key"

export const IMPORT_MAX_ROWS = 100
export const IMPORT_MAX_TEXT_LENGTH = 1_100_000
export type ImportFormat = "csv" | "tsv"
export type ImportRow = { line: number; term: string; definition: string }
export type ImportPreviewRow = ImportRow & {
  action: "create" | "reuse" | "duplicate" | "error"
  message: string
  termId?: number
  termSlug?: string
}
export type ExistingImportTerm = {
  id: number
  slug: string
  term: string
  hiddenAt: string | null
}

/** CSV quoting also works for TSV pasted from a spreadsheet. Never split on
 * newlines before parsing: a quoted definition can span several lines. */
export function parseImportText(text: string, format: ImportFormat) {
  const errors: string[] = []
  if (text.length > IMPORT_MAX_TEXT_LENGTH)
    return {
      rows: [] as ImportRow[],
      errors: ["The import file is too large."]
    }
  const delimiter = format === "csv" ? "," : "\t"
  const records: { line: number; values: string[] }[] = []
  let values: string[] = []
  let field = ""
  let quoted = false
  let closedQuote = false
  let line = 1
  let recordLine = 1
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  const endField = () => {
    values.push(field.trim())
    field = ""
    closedQuote = false
  }
  const endRecord = () => {
    endField()
    if (values.some(Boolean)) records.push({ line: recordLine, values })
    values = []
  }
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index++
        } else {
          quoted = false
          closedQuote = true
        }
      } else field += char
    } else if (char === delimiter) endField()
    else if (char === "\n") {
      endRecord()
      recordLine = line + 1
    } else if (char === '"' && !field && !closedQuote) quoted = true
    else if (closedQuote || char === '"') {
      errors.push(`Line ${line}: invalid quoted field.`)
      return { rows: [] as ImportRow[], errors }
    } else field += char
    if (char === "\n") line++
  }
  if (quoted)
    return {
      rows: [] as ImportRow[],
      errors: [`Line ${recordLine}: close the quoted field.`]
    }
  endRecord()
  const header = records.shift()
  if (
    !header ||
    header.values.length !== 2 ||
    header.values[0].toLowerCase() !== "term" ||
    header.values[1].toLowerCase() !== "definition"
  )
    return {
      rows: [] as ImportRow[],
      errors: [
        `Start with a term${delimiter}definition header and use exactly those two columns.`
      ]
    }
  if (!records.length) errors.push("Add at least one term below the header.")
  if (records.length > IMPORT_MAX_ROWS)
    errors.push(`Import at most ${IMPORT_MAX_ROWS} rows at a time.`)
  const rows = records.slice(0, IMPORT_MAX_ROWS).map((record) => {
    if (record.values.length !== 2)
      errors.push(`Line ${record.line}: use exactly two columns.`)
    return {
      line: record.line,
      term: record.values[0] ?? "",
      definition: record.values[1] ?? ""
    }
  })
  return { rows, errors }
}

export function planImportRows(
  rows: ImportRow[],
  existingTerms: ExistingImportTerm[]
): ImportPreviewRow[] {
  const existing = new Map(
    existingTerms.map((term) => [termLabelKey(term.term), term])
  )
  const seen = new Map<string, ImportRow>()
  return rows.map((row) => {
    const key = termLabelKey(row.term)
    const invalid = (message: string): ImportPreviewRow => ({
      ...row,
      action: "error",
      message
    })
    if (!key) return invalid("A term is required.")
    if (row.term.length > TERM_MAX_LENGTH)
      return invalid(`Terms must be ${TERM_MAX_LENGTH} characters or fewer.`)
    if (row.definition.length > DEFINITION_MAX_LENGTH)
      return invalid(
        `Definitions must be ${DEFINITION_MAX_LENGTH} characters or fewer.`
      )
    const earlier = seen.get(key)
    if (earlier)
      return earlier.definition === row.definition
        ? {
            ...row,
            action: "duplicate",
            message: `Repeated row; line ${earlier.line} is used once.`
          }
        : invalid(
            `This label has different definitions in lines ${earlier.line} and ${row.line}. Keep one row.`
          )
    seen.set(key, row)
    const match = existing.get(key)
    if (match?.hiddenAt)
      return invalid("This label is unavailable for import. Contact a curator.")
    if (match)
      return {
        ...row,
        action: "reuse",
        message: row.definition
          ? "Reuse the existing term. The supplied definition will not be imported."
          : "Reuse the existing term and preserve its definitions.",
        termId: match.id,
        termSlug: match.slug
      }
    if (!row.definition)
      return invalid("A definition is required for a new term.")
    return {
      ...row,
      action: "create",
      message: "Create a term with an attributed first definition."
    }
  })
}
