import assert from "node:assert/strict"
import { parseDraftImport, importedEvidence } from "../lib/import-draft-parser"
import { parseImportText } from "../lib/setup-import"
import { importEvidenceSchema } from "../lib/import-draft-types"

const minimal = parseDraftImport("term,definition\nionic transport,", "csv")
assert.equal(minimal.errors.length, 0)
assert.equal(minimal.rows[0].errors.length, 0)
assert.equal(minimal.rows[0].definition, "")
const multiline = parseDraftImport(
  '\ufeffterm,definition,source_title,row_id\r\nLi⁺,"Line one\nLine two",Paper,x\r\nNa⁺,Other,Paper,y',
  "csv"
)
assert.equal(multiline.rows[0].definition, "Line one\nLine two")
assert.equal(multiline.rows[1].record, 2)
assert.equal(multiline.rows[1].line, 4)
assert.equal(multiline.rows[0].rowId, "x")
assert.equal(multiline.rows[0].fields.term, "Li⁺")
assert.equal(
  parseDraftImport("term\tdefinition\nA\tB", "tsv").rows[0].definition,
  "B"
)
const unknown = parseDraftImport("term,definition,author\nA,B,C", "csv")
assert.deepEqual(unknown.unknownColumns, ["author"])
assert.match(unknown.errors.join(" "), /explicitly ignore/)
assert.equal(
  parseDraftImport("term,definition,author\nA,B,C", "csv", ["author"]).errors
    .length,
  0
)
assert.equal(
  parseDraftImport('term,definition\nA,"unclosed', "csv").rows.length,
  0
)
assert.equal(
  parseDraftImport('term,definition\nA,"closed"invalid', "csv").rows.length,
  0
)
assert.ok(
  parseDraftImport("term,definition,row_id\nA,B,x\nC,D,x", "csv").errors.length
)
assert.ok(parseDraftImport("term,definition,term\nA,B,C", "csv").errors.length)
assert.ok(
  parseDraftImport(`term,definition\n${"A,B\n".repeat(101)}`, "csv").errors
    .length
)
assert.ok(
  parseDraftImport(`term,definition\nA,${"世".repeat(350000)}`, "csv").errors
    .length
)
const evidence = importedEvidence({
  source_title: "Paper",
  source_creator: "Original scientist",
  ontology_iri: "https://example.org/Ontology/123",
  source_keys: "paper; notes",
  scope_note: "Narrow scope"
})
assert.equal(evidence.origin?.decision, "pending")
assert.equal(
  evidence.citations.length,
  0,
  "Declared origin is not automatically a citation"
)
assert.equal(evidence.ontology[0].decision, "pending")
assert.deepEqual(
  evidence.sourceKeys.map((item) => item.key),
  ["paper", "notes"]
)
assert.equal(
  importEvidenceSchema.safeParse({ ...evidence, aiSuggestionId: 9 }).success,
  false
)
assert.equal(
  importEvidenceSchema.safeParse({
    ...evidence,
    origin: { ...evidence.origin, lookupId: "forged" }
  }).success,
  false
)
assert.equal(parseImportText("term,definition\nA,B", "csv").errors.length, 0)
assert.ok(
  parseImportText("term,definition,source_title\nA,B,C", "csv").errors.length,
  "Legacy parser stays strictly compatible"
)
console.log("Draft import parser and declared evidence tests passed")
