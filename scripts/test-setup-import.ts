import assert from "node:assert/strict"
import {
  IMPORT_MAX_ROWS,
  parseImportText,
  planImportRows
} from "../lib/setup-import"

const csv = parseImportText(
  '\uFEFFterm,definition\r\n"Band gap","An energy gap, between bands."\r\n"Crystal","A structure with\nperiodicity and ""order""."\n',
  "csv"
)
assert.deepEqual(csv.errors, [])
assert.deepEqual(csv.rows, [
  { line: 2, term: "Band gap", definition: "An energy gap, between bands." },
  {
    line: 3,
    term: "Crystal",
    definition: 'A structure with\nperiodicity and "order".'
  }
])
assert.deepEqual(
  parseImportText("term\tdefinition\nIron\tA chemical element.", "tsv"),
  {
    rows: [{ line: 2, term: "Iron", definition: "A chemical element." }],
    errors: []
  }
)
for (const text of [
  "Iron,A chemical element.",
  "term,definition,extra\nIron,Element,x",
  'term,definition\nIron,"Unclosed',
  'term,definition\nIron,"Closed"suffix',
  'term,definition\nIron,Embedded"quote',
  "term,definition\nIron,Element,extra",
  "term,definition\n"
])
  assert.ok(
    parseImportText(text, "csv").errors.length,
    `Reject malformed import: ${text}`
  )
assert.ok(
  parseImportText(
    `term,definition\n${Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `Term ${i},Definition`).join("\n")}`,
    "csv"
  ).errors.some((error) => error.includes("at most"))
)

const plan = planImportRows(
  [
    { line: 2, term: " Iron ", definition: "New supplied wording" },
    { line: 3, term: "Crystal", definition: "A periodic structure." },
    { line: 4, term: "CRYSTAL", definition: "A periodic structure." },
    { line: 5, term: "Crystal", definition: "Conflicting wording" },
    { line: 6, term: "Hidden", definition: "Hidden duplicate" },
    { line: 7, term: "No definition", definition: "" },
    { line: 8, term: "", definition: "No label" }
  ],
  [
    { id: 1, slug: "iron", term: "iron", hiddenAt: null },
    { id: 2, slug: "hidden", term: "hidden", hiddenAt: "2026-01-01" }
  ]
)
assert.deepEqual(
  plan.map((row) => row.action),
  ["reuse", "create", "duplicate", "error", "error", "error", "error"]
)
assert.equal(plan[0].termId, 1)
assert.match(plan[0].message, /will not be imported/)
assert.equal(plan[4].termId, undefined, "Hidden identities are not disclosed")
assert.deepEqual(
  planImportRows(
    [{ line: 2, term: "Iron", definition: "" }],
    [{ id: 1, slug: "iron", term: "Iron", hiddenAt: null }]
  ).map((row) => row.action),
  ["reuse"]
)
assert.equal(
  planImportRows(
    [{ line: 2, term: "x".repeat(201), definition: "Definition" }],
    []
  )[0].action,
  "error"
)
assert.equal(
  planImportRows(
    [{ line: 2, term: "Term", definition: "x".repeat(10_001) }],
    []
  )[0].action,
  "error"
)
console.log("Setup import parser and preview tests passed")
