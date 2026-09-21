import assert from "node:assert/strict"
import {
  modelInputAvailability,
  type DraftReferenceSelection,
  type ReferenceLookup,
  type ReferenceProviderState
} from "../components/definition/term-reference-workspace"
import { DEFAULT_WOLFRAM_OPTIONS } from "../lib/wolfram-query"

const lookup = (id: string, sizes: number[]): ReferenceLookup => ({
  lookupId: id,
  term: "iron",
  retrievedAt: "2026-09-20T12:00:00Z",
  references: sizes.map((size, index) => ({
    id: `${id}-${index}`,
    lookupId: id,
    term: "iron",
    definition: "a".repeat(size),
    source: "Fixture",
    sourceIri: `https://example.org/${id}/${index}`,
    sourceKey: "fixture",
    kind: "definition",
    usageStatus: "open",
    version: "1",
    license: "CC-BY-4.0",
    contentHash: "fixture",
    copiedAt: null,
    addedToDraftAt: null
  }))
})
const state = (history: ReferenceLookup[]): ReferenceProviderState => ({
  status: history.length ? "ready" : "idle",
  result: history.at(-1) ?? null,
  history,
  editing: false,
  options: DEFAULT_WOLFRAM_OPTIONS,
  error: null,
  context: "",
  notice: "",
  clipboardBusy: false,
  actionError: false,
  showMore: false,
  revealedReferenceIds: [],
  consultedReferenceIds: []
})
const selected = (
  lookupId: string,
  ids: string[]
): DraftReferenceSelection => ({
  lookupId,
  term: "iron",
  provider: "wolfram",
  citedReferenceIds: ["citation-is-independent"],
  modelReferenceIds: ids
})
const old = lookup("old", [12000])
const current = lookup("current", [12000, 12001])
const providers = { chebi: state([]), wolfram: state([old, current]) }
const selection = [selected("old", ["old-0"])]

assert.equal(
  modelInputAvailability(selection, providers, "current-0").allowed,
  true,
  "24,000 source characters may be submitted"
)
assert.equal(
  modelInputAvailability(selection, providers, "current-1").allowed,
  false,
  "saved lookup text participates in the combined limit"
)
assert.equal(
  modelInputAvailability(selection, providers, "old-0").allowed,
  true,
  "an included source is not counted twice"
)
assert.equal(
  modelInputAvailability(selection, providers, "missing").allowed,
  false,
  "unknown source IDs cannot be added"
)
const many = lookup("many", [1, 1, 1, 1, 1, 1, 1])
const six = [
  selected(
    "many",
    many.references.slice(0, 6).map((entry) => entry.id)
  )
]
assert.equal(
  modelInputAvailability(six, { ...providers, chebi: state([many]) }, "many-6")
    .allowed,
  false,
  "a seventh source is rejected"
)
assert.equal(
  modelInputAvailability(
    [selected("many", Array(6).fill("many-0"))],
    { ...providers, chebi: state([many]) },
    "many-6"
  ).allowed,
  true,
  "repeated identity counts once"
)
assert.deepEqual(
  selection[0].citedReferenceIds,
  ["citation-is-independent"],
  "limit checks never mutate citation choices"
)
console.log("Source context count and size limits passed.")
