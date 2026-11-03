import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"
import { FieldChanges } from "../components/metadata-workspace/field-changes"
import { FieldHistory } from "../components/metadata-workspace/source-history"
import { RevisionDiff } from "../components/definition/revision-diff"
import {
  emptyFieldPayload,
  proposalDifferences
} from "../components/metadata-workspace/workspace-presenters"
import {
  compareDefinitionText,
  createPresentationTextDiff,
  diffSourceText,
  diffToStringSimple
} from "../lib/definition-comparison"
import {
  fieldRevisionProvenance,
  previousFieldRevision,
  type PublishedFieldRecord,
  type FieldRevision
} from "../lib/metadata-field-provenance"

const baseline = emptyFieldPayload()
baseline.label = "Mesh spacing"
baseline.definition = "Spacing between mesh points."
baseline.specification.repeatability = "no"
const payload = structuredClone(baseline)
payload.definition = "Distance between adjacent mesh points."
payload.specification.repeatability = "yes"
payload.specification.units = "m"
payload.citations = [
  {
    title: "Mesh reference",
    url: "https://example.org/mesh",
    note: "Defines spacing."
  }
]
const differences = proposalDifferences(payload, baseline)
let checks = 0
function test(name: string, run: () => void) {
  run()
  checks++
  console.log(`PASS ${name}`)
}

test("every changed field reconstructs both stored values", () => {
  for (const row of differences) {
    const diff = createPresentationTextDiff(row.before, row.after)
    assert.equal(diffSourceText(diff), row.before)
    assert.equal(diffToStringSimple(diff), row.after)
  }
})
test("definition and field rules use accessible shared highlighting", () => {
  const html = renderToStaticMarkup(<FieldChanges differences={differences} />)
  assert.match(html, /<ins /)
  assert.match(html, /<del /)
  assert.match(html, /Added: /)
  assert.match(html, /Removed: /)
  assert.match(html, /Repeatable/)
  assert.match(html, /Units/)
  assert.doesNotMatch(html, /<dt[^>]*>Label/)
})
test("full deletion remains visible and text is escaped", () => {
  const html = renderToStaticMarkup(
    <FieldChanges
      differences={[
        { label: "Definition", before: "<script>alert(1)</script>", after: "" }
      ]}
    />
  )
  assert.match(html, /<del /)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>/)
})
test("unchanged comparisons have a concise empty state", () => {
  assert.match(
    renderToStaticMarkup(<FieldChanges differences={[]} />),
    /No changes/
  )
})
test("dictionary revision diff retains shared highlighting and metrics", () => {
  const html = renderToStaticMarkup(
    <RevisionDiff
      comparison={{
        ...compareDefinitionText("Old definition", "New definition"),
        basis: "previous",
        before: {
          definitionNumber: 1,
          version: 1,
          termSlug: "mesh",
          vocabularySlug: "materials"
        },
        after: {
          definitionNumber: 1,
          version: 2,
          termSlug: "mesh",
          vocabularySlug: "materials"
        },
        caveat: null
      }}
    />
  )
  assert.match(html, /<ins /)
  assert.match(html, /<del /)
  assert.match(html, /Definition edit magnitude/)
})

// These fixtures contain only the already-authorized response fields used by
// the display adapter. Source text is invented, never copied from MatCore.
const first = {
  id: "r1",
  fieldId: "f1",
  version: 1,
  previousRevisionId: null,
  occurrenceKey: "mesh",
  profileKey: null,
  profileReleaseId: null,
  sourceOccurrenceId: null,
  payload: baseline,
  createdById: 1,
  createdAt: "2026-11-03T10:00:00Z",
  reviewState: "awaiting_review"
} as FieldRevision
const second = {
  ...first,
  id: "r2",
  version: 2,
  previousRevisionId: first.id,
  payload
} as FieldRevision
const record = {
  field: { id: "f1" },
  revisions: [second, first],
  selectedRevisionId: second.id,
  baseline: null,
  sourceRelease: null,
  sourceOccurrence: null,
  history: [
    {
      id: 3,
      revisionId: "r2",
      action: "reviewed",
      actorId: 2,
      actorName: "Reviewer",
      createdAt: "2026-11-03T11:00:00Z",
      detail: {
        authority: "community_steward",
        decision: "accepted",
        reason: "Clarifies the field."
      }
    },
    {
      id: 2,
      revisionId: "r2",
      action: "published",
      actorId: 1,
      actorName: "Author",
      createdAt: second.createdAt,
      detail: {}
    },
    {
      id: 1,
      revisionId: null,
      action: "draft_updated",
      actorId: 3,
      actorName: "Private author",
      createdAt: second.createdAt,
      detail: { reason: "Private edit" }
    }
  ]
} as unknown as PublishedFieldRecord
const snapshot = JSON.stringify(record)
test("predecessor follows the recorded id regardless of array ordering", () => {
  assert.equal(previousFieldRevision([first, second], second)?.id, "r1")
  assert.equal(
    previousFieldRevision([first, second], {
      ...second,
      previousRevisionId: "missing"
    }),
    undefined
  )
})
for (const key of [
  "fieldId",
  "occurrenceKey",
  "profileKey",
  "profileReleaseId",
  "sourceOccurrenceId"
] as const)
  test(`predecessor cannot cross ${key}`, () => {
    assert.equal(
      previousFieldRevision(
        [{ ...first, [key]: "other" } as FieldRevision],
        second
      ),
      undefined
    )
  })
test("new generic fields have no invented reference", () => {
  const graph = fieldRevisionProvenance(record, second)
  assert.ok(!graph.nodes.some((node) => node.id === "reference"))
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.source === "revision:r2" &&
        edge.target === "revision:r1" &&
        edge.rel === "wasDerivedFrom"
    )
  )
})
test("graph links recorded author, review decision and cited sources", () => {
  const graph = fieldRevisionProvenance(record, second)
  assert.ok(graph.nodes.some((node) => node.label === "Author"))
  assert.ok(graph.nodes.some((node) => node.label === "Review decision"))
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.source === "event:3" &&
        edge.target === "revision:r2" &&
        edge.rel === "used"
    )
  )
  assert.ok(
    graph.edges.some(
      (edge) => edge.rel === "references" && edge.target === "citation:0"
    )
  )
  assert.ok(
    !graph.edges.some(
      (edge) =>
        edge.source === "revision:r2" &&
        edge.target === "event:3" &&
        edge.rel === "wasGeneratedBy"
    )
  )
})
test("private edits and another revision's review are absent", () => {
  const text = JSON.stringify(fieldRevisionProvenance(record, second))
  assert.doesNotMatch(text, /Private author|Private edit|event:1/)
  assert.ok(
    !fieldRevisionProvenance(record, first).nodes.some(
      (node) => node.id === "event:3"
    )
  )
})
test("reference is attached only to the response's selected revision", () => {
  const sourced = {
    ...record,
    baseline,
    sourceRelease: { version: "1.0", attribution: "Reference publisher" },
    sourceOccurrence: {
      id: "source:mesh",
      sourceUrl: "https://example.org/standard"
    }
  } as unknown as PublishedFieldRecord
  assert.ok(
    fieldRevisionProvenance(sourced, {
      ...second,
      sourceOccurrenceId: "source:mesh"
    }).nodes.some((node) => node.id === "reference")
  )
  assert.ok(
    !fieldRevisionProvenance(sourced, first).nodes.some(
      (node) => node.id === "reference"
    )
  )
})
test("history links only known published revisions and labels steward decisions", () => {
  const html = renderToStaticMarkup(
    <FieldHistory
      history={record.history}
      fieldId="f1"
      revisions={record.revisions}
    />
  )
  assert.match(html, /\/metadata\/fields\/f1\?revision=r2/)
  assert.match(html, /Community steward decision/)
  assert.doesNotMatch(html, /revision=null/)
})
test("display generation preserves its inputs", () =>
  assert.equal(JSON.stringify(record), snapshot))
console.log(`${checks} metadata provenance checks passed.`)
