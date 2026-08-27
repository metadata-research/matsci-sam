import assert from "node:assert/strict"
import {
  ACTIVITY_TIMELINE_LEFT,
  ACTIVITY_TIMELINE_WIDTH,
  buildActivityTimelineGeometry
} from "../lib/activity-timeline"
import type {
  TermActivityDefinition,
  TermActivityEvent
} from "../lib/term-activity-types"

const definitions: TermActivityDefinition[] = [
  {
    number: 1,
    currentRevision: { version: 1, text: "Alpha" }
  },
  {
    number: 2,
    currentRevision: { version: 1, text: "Beta" }
  }
]

const event = (
  key: string,
  at: string,
  definitionNumber: number
): TermActivityEvent => ({
  key,
  at,
  definitionNumber,
  version: 1,
  kind: "comment",
  message: key,
  migratedLegacy: false
})

const geometry = buildActivityTimelineGeometry(definitions, [
  event("first", "2026-01-01T00:00:00.000Z", 1),
  event("last", "2026-01-03T00:00:00.000Z", 2)
])
assert.equal(geometry.rows.length, 2)
assert.equal(geometry.marks.length, 2)
assert.equal(geometry.marks[0].x, ACTIVITY_TIMELINE_LEFT)
assert.equal(geometry.marks[1].x, ACTIVITY_TIMELINE_WIDTH - 36)
assert.equal(geometry.ticks.length, 3)
assert.deepEqual(geometry.domain, {
  firstAt: "2026-01-01T00:00:00.000Z",
  lastAt: "2026-01-03T00:00:00.000Z"
})

const single = buildActivityTimelineGeometry(definitions.slice(0, 1), [
  event("only", "2026-01-01T00:00:00.000Z", 1)
])
assert.equal(single.marks[0].x, (ACTIVITY_TIMELINE_LEFT + 884) / 2)
assert.equal(single.ticks.length, 1)

const empty = buildActivityTimelineGeometry(definitions, [])
assert.equal(empty.domain, null)
assert.deepEqual(empty.marks, [])

console.log("Activity timeline geometry checks passed.")
