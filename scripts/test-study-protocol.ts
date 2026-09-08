import assert from "node:assert/strict"
import {
  activeStudySteps,
  ID4_ROUND_TWO,
  ID4_VOTING_INSTRUCTIONS,
  isActiveStudyStep,
  studyAllowsAct
} from "../lib/study-protocol"
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
assert.equal(active.length, 10)
assert.deepEqual(
  active.map((step) => step.position),
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
)
assert.deepEqual(
  active.map((step) => step.id),
  [100, 101, 102, 103, 104, 105, 106, 107, 108, 118]
)
assert.equal(active[0].prompt, ID4_VOTING_INSTRUCTIONS)
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
assert.equal(isActiveStudyStep(ID4_ROUND_TWO, stored[17]), false)
assert.equal(
  studyAllowsAct(ID4_ROUND_TWO, { kind: "define", termId: 1 }),
  false
)
assert.equal(
  studyAllowsAct(ID4_ROUND_TWO, { kind: "vote", vote: "up", termId: 1 }),
  true
)
assert.equal(
  studyAllowsAct("another_study", { kind: "define", termId: 1 }),
  true
)
console.log("ID4 amended protocol, stable records and resumption passed")
