import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { standardXmlTemplate } from "../lib/standard-xml-template"
import { emptyMatcoreDraftPayload } from "../lib/matcore-workflow-types"
import type { StandardEntry } from "../lib/community-standard-types"

let checks = 0
function same(a: unknown, b: unknown) {
  assert.deepEqual(a, b)
  checks++
}
function field(
  path: string,
  rules: Partial<StandardEntry["payload"]["specification"]> = {}
): StandardEntry {
  const payload = emptyMatcoreDraftPayload()
  payload.label = "A label, not an XML name"
  payload.definition = "A definition, not a dataset value."
  payload.example = "An example, not a dataset value."
  payload.specification = { ...payload.specification, path, ...rules }
  return {
    id: path,
    fieldId: null,
    sourceOccurrenceId: null,
    revisionId: null,
    reviewEventId: null,
    profileKey: null,
    payload
  }
}
function parse(xml: string) {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `import sys,json,xml.etree.ElementTree as E
r=E.fromstring(sys.stdin.read())
rows=[]
def walk(n,p):
 for c in n:
  path=p+[c.tag]
  rows.append({"path":".".join(path),"value":(c.text or "").strip()})
  walk(c,path)
walk(r,[])
print(json.dumps({"root":r.tag,"rows":rows}))`
    ],
    { input: xml, encoding: "utf8", timeout: 5000 }
  )
  assert.equal(result.status, 0, result.stderr)
  checks++
  return JSON.parse(result.stdout) as {
    root: string
    rows: { path: string; value: string }[]
  }
}
const rows = [
  field("mesh.dimension", { requirement: "required", valueType: "integer" }),
  field("mesh", {
    requirement: "optional",
    repeatability: "yes",
    valueType: "object"
  }),
  field("mesh.spacing", {
    requirement: "conditional",
    condition: "Only for uniform grids",
    units: "m",
    valueForm: "array",
    allowedValues: ["a & b", "<x>"],
    format: "decimal",
    guidance: "Numbers > 0. --> <injected/><!--",
    notes: "Keep -- boundaries.\u0000"
  }),
  field("méthode.名称"),
  field("unknown"),
  field("recommended", { requirement: "recommended", repeatability: "no" })
]
const before = JSON.stringify(rows)
const xml = standardXmlTemplate(rows, [
  "Test -- header --> <injected/><!--",
  "Synthetic fixture"
])
const parsed = parse(xml)
same(parsed.root, "root")
same(
  parsed.rows.map((row) => row.path),
  [
    "mesh",
    "mesh.dimension",
    "mesh.spacing",
    "méthode",
    "méthode.名称",
    "unknown",
    "recommended"
  ]
)
same(parsed.rows.find((row) => row.path === "mesh.dimension")?.value, "FILL*")
same(parsed.rows.find((row) => row.path === "mesh.spacing")?.value, "FILL")
same(xml.includes("Optional. Repeatable"), true)
same(xml.includes("Requirement unspecified. Repeatability unspecified"), true)
same(xml.includes("Recommended. Not repeatable"), true)
same(xml.includes("Condition: Only for uniform grids"), true)
same(xml.includes("Units: m"), true)
same(xml.includes("Value form: array"), true)
same(xml.includes("Allowed values: a & b, <x>"), true)
same(xml.includes("Format: decimal"), true)
same(
  parse(
    standardXmlTemplate(
      [
        field("container.child", {
          requirement: "conditional",
          condition: "Required when container is present."
        })
      ],
      []
    )
  ).rows.find((row) => row.path === "container.child")?.value,
  "FILL*"
)
same(
  parse(
    standardXmlTemplate(
      [
        field("container.child", {
          requirement: "conditional",
          condition: "Required when a different condition holds."
        })
      ],
      []
    )
  ).rows.find((row) => row.path === "container.child")?.value,
  "FILL"
)
same(xml.includes("Value guidance: Numbers > 0."), true)
same(xml.includes("A definition, not a dataset value."), false)
same(xml.includes("An example, not a dataset value."), false)
same(JSON.stringify(rows), before)
same(
  standardXmlTemplate(rows, ["Stable"]),
  standardXmlTemplate(rows, ["Stable"])
)
for (const path of [
  "",
  "a..b",
  "1name",
  "x:local",
  "space name",
  " leading",
  "trailing ",
  "a/<x>",
  "x\u0001",
  "x".repeat(501),
  Array(66).fill("x").join(".")
]) {
  assert.throws(() => standardXmlTemplate([field(path)], []), /field path/)
  checks++
}
assert.throws(() => standardXmlTemplate([], []), /no fields/)
checks++
assert.throws(
  () => standardXmlTemplate([field("same"), field("same")], []),
  /duplicate/
)
checks++
assert.throws(
  () =>
    standardXmlTemplate([field("a"), { ...field("b"), profileKey: "pf" }], []),
  /one section/
)
checks++
assert.throws(
  () =>
    standardXmlTemplate(
      [field("mesh", { valueType: "number" }), field("mesh.x")],
      []
    ),
  /scalar/
)
checks++
same(
  parse(standardXmlTemplate([field("a-b", { valueType: "list" })], [])).rows[0]
    .value,
  "FILL"
)
console.log(`Standard XML template checks passed (${checks}).`)
