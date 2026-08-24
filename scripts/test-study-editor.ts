import assert from "node:assert/strict"
import {
  STUDY_INSTRUCTIONS_MAX,
  STUDY_TITLE_MAX,
  instructionEditability,
  isoToLocalDateTime,
  localDateTimeToIso,
  normalizeStudyInstructions,
  studyWindowError,
  type StudyEditorUsage
} from "../lib/study-editor"

assert.equal(STUDY_TITLE_MAX, 120)
assert.equal(STUDY_INSTRUCTIONS_MAX, 2_000)
assert.equal("t".repeat(STUDY_TITLE_MAX).length, STUDY_TITLE_MAX)
assert.equal("i".repeat(STUDY_INSTRUCTIONS_MAX).length, STUDY_INSTRUCTIONS_MAX)

assert.equal(normalizeStudyInstructions(""), null)
assert.equal(normalizeStudyInstructions(" \n\t "), null)
const literalInstructions =
  "# Literal Markdown\n\n<strong>Literal HTML</strong>\n\nKeep *all* markers."
assert.equal(
  normalizeStudyInstructions(` \n${literalInstructions}\n `),
  literalInstructions,
  "normalization removes outer whitespace without interpreting or collapsing text"
)

assert.equal(localDateTimeToIso(""), null)
assert.equal(localDateTimeToIso("  "), null)
const localDateTime = "2026-08-24T14:35"
const isoDateTime = localDateTimeToIso(localDateTime)
assert.notEqual(isoDateTime, null)
assert.equal(isoDateTime, "2026-08-24T14:35:00.000Z")
assert.equal(isoToLocalDateTime(isoDateTime), localDateTime)
assert.equal(isoToLocalDateTime(null), "")
assert.equal(isoToLocalDateTime(""), "")
assert.throws(() => localDateTimeToIso("not-a-date"), RangeError)
assert.throws(() => localDateTimeToIso("2026-02-30T12:00"), RangeError)
assert.throws(() => localDateTimeToIso("2026-08-24T24:00"), RangeError)
assert.throws(() => isoToLocalDateTime("not-an-iso-date"), RangeError)

assert.equal(studyWindowError(null, null), null)
assert.equal(studyWindowError("2026-08-24T12:00:00.000Z", null), null)
assert.equal(studyWindowError(null, "2026-08-24T13:00:00.000Z"), null)
assert.equal(
  studyWindowError("2026-08-24T12:00:00.000Z", "2026-08-24T13:00:00.000Z"),
  null
)
assert.match(
  studyWindowError("2026-08-24T12:00:00.000Z", "2026-08-24T12:00:00.000Z") ??
    "",
  /must be after/
)
assert.match(
  studyWindowError("2026-08-24T13:00:00.000Z", "2026-08-24T12:00:00.000Z") ??
    "",
  /must be after/
)
assert.match(
  studyWindowError("invalid", "2026-08-24T12:00:00.000Z") ?? "",
  /valid opening/
)

const emptyUsage = (): StudyEditorUsage => ({
  completions: 0,
  responses: 0,
  definitionRevisions: 0,
  voteEvents: 0,
  comments: 0
})
const validSteps = [
  { kind: "instructions", position: 1 },
  { kind: "define", position: 2 }
]

assert.deepEqual(instructionEditability({ steps: [], usage: emptyUsage() }), {
  editable: true,
  reason: null,
  activity: 0
})
assert.deepEqual(
  instructionEditability({ steps: validSteps, usage: emptyUsage() }),
  { editable: true, reason: null, activity: 0 }
)

for (const usageKey of Object.keys(
  emptyUsage()
) as (keyof StudyEditorUsage)[]) {
  const usage = emptyUsage()
  usage[usageKey] = 1
  const result = instructionEditability({ steps: validSteps, usage })
  assert.equal(result.editable, false, `${usageKey} locks instructions`)
  assert.equal(result.activity, 1)
  assert.match(result.reason ?? "", /recorded activity/)
}

const accumulatedActivity = instructionEditability({
  steps: validSteps,
  usage: {
    completions: 1,
    responses: 2,
    definitionRevisions: 3,
    voteEvents: 4,
    comments: 5
  }
})
assert.equal(accumulatedActivity.activity, 15)
assert.match(accumulatedActivity.reason ?? "", /15 recorded activity items/)

for (const malformedSteps of [
  [{ kind: "define", position: 1 }],
  [{ kind: "instructions", position: 2 }],
  [
    { kind: "instructions", position: 1 },
    { kind: "instructions", position: 2 }
  ]
]) {
  const result = instructionEditability({
    steps: malformedSteps,
    usage: emptyUsage()
  })
  assert.equal(result.editable, false)
  assert.match(
    result.reason ?? "",
    /exactly one instructions step at position 1/
  )
}

console.log("study editor helpers: ok")
