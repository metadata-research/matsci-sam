import assert from "node:assert/strict"
import { DiffOp } from "diff-match-patch-ts"
import type { Diff } from "diff-match-patch-ts"

const main = async () => {
  process.env.DATABASE_URL ??= "postgresql:///definition-revision-test"
  const {
    createTextDiff,
    diffToStringSimple,
    revisionDiffMetrics
  } = await import("../lib/definition-revisions")

  const initialDefinition: Diff[] = [
    [DiffOp.Insert, "A crystalline phase."]
  ]
  assert.equal(diffToStringSimple(initialDefinition), "A crystalline phase.")

  const definitionDiff = createTextDiff(
    "A hard alpha phase.",
    "A hard beta phase."
  )
  const exampleDiff = createTextDiff(
    "Alpha forms slowly.",
    "Beta forms rapidly."
  )

  assert.equal(diffToStringSimple(definitionDiff), "A hard beta phase.")
  assert.equal(diffToStringSimple(exampleDiff), "Beta forms rapidly.")
  assert.deepEqual(revisionDiffMetrics([definitionDiff, exampleDiff]), {
    charsAdded: 11,
    charsRemoved: 12,
    changeDelta: "0.307"
  })

  console.log("Definition revision diff checks passed.")
}

main()
