import assert from "node:assert/strict"
import { DiffOp } from "diff-match-patch-ts"
import {
  buildStoredRevisionComparison,
  compareDefinitionText,
  createPresentationTextDiff,
  createTextDiff,
  diffSourceText,
  diffToStringSimple,
  LEGACY_REVISION_COMPARISON_CAVEAT
} from "../lib/definition-comparison"

const assertReconstructs = (previous: string, next: string) => {
  const diff = createPresentationTextDiff(previous, next)
  assert.equal(diffSourceText(diff), previous)
  assert.equal(diffToStringSimple(diff), next)
  return diff
}

const replacement = compareDefinitionText(
  "A hard alpha phase.",
  "A hard beta phase."
)
assert.equal(diffSourceText(replacement.diff), "A hard alpha phase.")
assert.equal(diffToStringSimple(replacement.diff), "A hard beta phase.")
assert.deepEqual(replacement.metrics, {
  charsAdded: 3,
  charsRemoved: 4,
  charsUnchanged: 15,
  beforeChars: 19,
  afterChars: 18,
  netChars: -1,
  beforeWords: 4,
  afterWords: 4,
  wordDelta: 0,
  editMagnitude: 0.189
})

assert.deepEqual(createPresentationTextDiff("", ""), [[DiffOp.Equal, ""]])
assert.deepEqual(createPresentationTextDiff("Clear me", ""), [
  [DiffOp.Delete, "Clear me"],
  [DiffOp.Equal, ""]
])

assertReconstructs("alpha\nbeta", "alpha\ngamma")
assertReconstructs("Ni-based alloy", "Ni–based alloy")
assertReconstructs("grain boundary 🔬", "grain-boundary 🔬")

const initial = compareDefinitionText("", "A new definition")
assert.equal(initial.metrics.editMagnitude, 1)
assert.equal(initial.metrics.charsRemoved, 0)
assert.equal(initial.metrics.charsAdded, 16)

const stored = buildStoredRevisionComparison({
  basis: "previous",
  before: {
    definitionNumber: 2,
    version: 1,
    termSlug: "fatigue",
    vocabularySlug: "mrc",
    definitionDiff: createTextDiff("", "Old wording"),
    legacyIncomplete: true
  },
  after: {
    definitionNumber: 2,
    version: 2,
    termSlug: "fatigue",
    vocabularySlug: "mrc",
    definitionDiff: createTextDiff("Old wording", "New wording"),
    legacyIncomplete: false
  }
})
assert.equal(stored.caveat, LEGACY_REVISION_COMPARISON_CAVEAT)
assert.equal(diffSourceText(stored.diff), "Old wording")
assert.equal(diffToStringSimple(stored.diff), "New wording")

console.log("Definition comparison checks passed.")
