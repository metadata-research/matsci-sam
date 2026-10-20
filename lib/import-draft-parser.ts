import {
  IMPORT_DRAFT_MAX_BYTES,
  IMPORT_DRAFT_MAX_ROWS,
  importRowWritingSchema,
  importEvidenceSchema,
  type ImportEvidence,
  type ParsedDraftImportRow
} from "./import-draft-types"
import { EXAMPLE_MAX_LENGTH } from "./input-limits"

export const IMPORT_DRAFT_COLUMNS = [
  "term",
  "definition",
  "row_id",
  "example",
  "scope_note",
  "source_keys",
  "source_url",
  "source_title",
  "source_creator",
  "source_version",
  "source_license",
  "ontology_iri",
  "ontology_label",
  "ontology_name",
  "ontology_version",
  "ontology_source_url",
  "ontology_note"
] as const

/** Preserve original text separately; record numbers and physical start lines
 * are different when CSV contains quoted multiline fields. */
export function parseDraftImport(
  text: string,
  format: "csv" | "tsv",
  ignoredColumns: string[] = []
) {
  const errors: string[] = []
  const records: { line: number; values: string[] }[] = []
  if (new TextEncoder().encode(text).length > IMPORT_DRAFT_MAX_BYTES)
    return {
      rows: [] as ParsedDraftImportRow[],
      errors: ["Import input must be at most 1 MB."],
      unknownColumns: [] as string[]
    }
  let values: string[] = [],
    field = "",
    quoted = false,
    closed = false
  let line = 1,
    start = 1
  const delimiter = format === "csv" ? "," : "\t"
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  const endField = () => {
    values.push(field)
    field = ""
    closed = false
  }
  const endRecord = () => {
    endField()
    if (values.some((value) => value.trim()))
      records.push({ line: start, values })
    values = []
  }
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else field += char
    } else if (char === delimiter) endField()
    else if (char === "\n") {
      endRecord()
      start = line + 1
    } else if (char === '"' && !field && !closed) quoted = true
    else if (closed || char === '"') {
      return {
        rows: [] as ParsedDraftImportRow[],
        errors: [`Line ${line}: invalid quoted field.`],
        unknownColumns: [] as string[]
      }
    } else field += char
    if (char === "\n") line++
  }
  if (quoted)
    return {
      rows: [] as ParsedDraftImportRow[],
      errors: [`Line ${start}: close the quoted field.`],
      unknownColumns: [] as string[]
    }
  endRecord()
  const header =
    records.shift()?.values.map((value) => value.trim().toLowerCase()) ?? []
  if (!header.includes("term") || !header.includes("definition"))
    errors.push("Include term and definition column headers.")
  if (new Set(header).size !== header.length || header.some((value) => !value))
    errors.push("Column headers must be unique and nonempty.")
  const unknownColumns = header.filter(
    (value) => !(IMPORT_DRAFT_COLUMNS as readonly string[]).includes(value)
  )
  for (const column of unknownColumns)
    if (!ignoredColumns.includes(column))
      errors.push(
        `Review the unknown column "${column}" and explicitly ignore it before creating drafts.`
      )
  if (!records.length) errors.push("Add at least one row below the header.")
  if (records.length > IMPORT_DRAFT_MAX_ROWS)
    errors.push(`Preview at most ${IMPORT_DRAFT_MAX_ROWS} rows at a time.`)
  const ids = new Set<string>()
  const rows = records.slice(0, IMPORT_DRAFT_MAX_ROWS).map((record, index) => {
    const fields = Object.fromEntries(
      header.map((key, i) => [key, record.values[i] ?? ""])
    )
    const rowId = fields.row_id?.trim() || `record-${index + 1}`
    const issues: string[] = []
    if (record.values.length !== header.length)
      issues.push("The number of values does not match the header.")
    if (rowId.length > 200 || ids.has(rowId))
      errors.push("Row identifiers must be unique and at most 200 characters.")
    ids.add(rowId)
    const term = fields.term?.trim() ?? "",
      definition = fields.definition?.trim() ?? ""
    const writing = importRowWritingSchema.safeParse({ term, definition })
    if (!writing.success)
      issues.push(...writing.error.issues.map((issue) => issue.message))
    if (fields.example?.length > EXAMPLE_MAX_LENGTH)
      issues.push("The example is too long.")
    if (
      (fields.source_keys ?? "").split(";").filter((key) => key.trim()).length >
      3
    )
      issues.push("Assign at most three source keys to a row.")
    const evidence = importEvidenceSchema.safeParse(importedEvidence(fields))
    if (!evidence.success)
      issues.push(...evidence.error.issues.map((issue) => issue.message))
    return {
      rowId,
      record: index + 1,
      line: record.line,
      term,
      definition,
      fields,
      errors: issues
    }
  })
  return { rows, errors, unknownColumns }
}

export function importedEvidence(
  fields: Record<string, string>
): ImportEvidence {
  const source = {
    title: fields.source_title ?? "",
    creator: fields.source_creator ?? "",
    url: fields.source_url ?? "",
    version: fields.source_version ?? "",
    license: fields.source_license ?? ""
  }
  return {
    publishOriginalWording: false,
    origin: Object.values(source).some(Boolean)
      ? { ...source, decision: "pending" }
      : null,
    citations: [],
    ontology: Object.entries(fields).some(
      ([key, value]) => key.startsWith("ontology_") && value
    )
      ? [
          {
            id: "ontology-1",
            iri: fields.ontology_iri ?? "",
            label: fields.ontology_label ?? "",
            ontology: fields.ontology_name ?? "",
            version: fields.ontology_version ?? "",
            sourceUrl: fields.ontology_source_url ?? "",
            note: fields.ontology_note ?? "",
            decision: "pending"
          }
        ]
      : [],
    scopeNote: fields.scope_note
      ? { text: fields.scope_note, decision: "pending" }
      : null,
    sourceKeys: (fields.source_keys ?? "")
      .split(";")
      .map((key) => key.trim())
      .filter(Boolean)
      .map((key) => ({ key, decision: "pending" }))
  }
}
