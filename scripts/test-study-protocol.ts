import assert from "node:assert/strict"
import {
  activeStudySteps,
  ID4_ROUND_TWO,
  ID4_INSTRUCTIONS,
  isActiveStudyStep
} from "../lib/study-protocol"
import { studyActMatchesStep } from "../lib/study-protocol-actions"
import { planSteps, DEFAULT_QUESTIONS, resumePosition } from "../lib/surveys"

const stored = planSteps({
  welcome: "Original instructions",
  terms: Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    term: `Term ${index + 1}`
  })),
  questions: DEFAULT_QUESTIONS
}).map((step, index) => ({ ...step, id: 100 + index }))
const original = structuredClone(stored)
const active = activeStudySteps(ID4_ROUND_TWO, stored)
assert.equal(stored.length, 19)
assert.deepEqual(stored, original, "Never rewrite the historical protocol")
assert.equal(active.length, 11)
assert.deepEqual(
  active.map((step) => step.position),
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
)
assert.deepEqual(
  active.map((step) => step.id),
  [100, 101, 102, 103, 104, 105, 106, 107, 108, 117, 118]
)
assert.equal(active[0].prompt, ID4_INSTRUCTIONS)
assert.deepEqual(activeStudySteps("another_study", stored), stored)
assert.equal(resumePosition(active, new Set()), 1)
assert.equal(
  resumePosition(active, new Set(stored.slice(0, 9).map((step) => step.id))),
  10,
  "A returning participant goes straight from eight choices to feedback"
)
assert.equal(
  resumePosition(active, new Set(active.map((step) => step.id))),
  null
)
assert.equal(isActiveStudyStep(ID4_ROUND_TWO, stored[9]), false)
assert.equal(isActiveStudyStep(ID4_ROUND_TWO, stored[17]), true)
for (const slug of [ID4_ROUND_TWO, "another_study"]) {
  assert.equal(
    studyActMatchesStep(slug, { kind: "define", termId: 1 }, stored[1]),
    true
  )
  assert.equal(
    studyActMatchesStep(
      slug,
      { kind: "vote", vote: "up", termId: 1 },
      stored[1]
    ),
    true
  )
  assert.equal(
    studyActMatchesStep(
      slug,
      { kind: "vote", vote: "down", termId: 1 },
      stored[1]
    ),
    false
  )
}
assert.equal(
  studyActMatchesStep(ID4_ROUND_TWO, { kind: "comment", termId: 1 }, stored[1]),
  true
)
assert.equal(
  studyActMatchesStep(ID4_ROUND_TWO, { kind: "comment", termId: 2 }, stored[1]),
  false
)
assert.equal(
  studyActMatchesStep(
    "another_study",
    { kind: "comment", termId: 1 },
    stored[1]
  ),
  false
)
console.log(
  "ID4 single-pass protocol, original actions, stable records and resumption passed"
)
