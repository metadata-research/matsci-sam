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
import { buildTermActivity } from "../lib/term-activity"
import type { TermActivityRecords } from "../lib/term-activity-records"
import {
  activityEventAriaLabel,
  activityEventHref,
  activityEvidenceHref,
  isExampleActivityEvent,
  isRevisionActivityEvent,
  matchesActivityEventFilter
} from "../components/activity/activity-presenters"

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

const publicUser = {
  id: 7,
  name: "Public contributor",
  isAi: false,
  isProfilePublic: true
}
const privateUser = {
  id: 8,
  name: "Private contributor",
  isAi: false,
  isProfilePublic: false
}
const records: TermActivityRecords = {
  term: {
    label: "water",
    slug: "water",
    vocabularySlug: "test",
    vocabularyTitle: "Test"
  },
  definitions: [{ id: 10, number: 1, currentRevisionId: 102 }],
  revisions: [
    {
      id: 101,
      definitionId: 10,
      version: 1,
      previousRevisionId: null,
      derivedFromRevisionId: null,
      definitionDiff: [[1, "Water"]],
      source: "ai_assisted",
      legacyIncomplete: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      model: "model-v1",
      inference: null,
      editor: publicUser
    },
    {
      id: 102,
      definitionId: 10,
      version: 2,
      previousRevisionId: 101,
      derivedFromRevisionId: null,
      definitionDiff: [
        [0, "Water"],
        [1, " revised"]
      ],
      source: "author_edit",
      legacyIncomplete: false,
      createdAt: "2026-01-02T00:00:00.000Z",
      model: null,
      inference: null,
      editor: privateUser
    }
  ],
  comments: [],
  votes: [],
  externalSources: [],
  examples: [
    {
      id: 201,
      definitionId: 10,
      exampleNumber: 1,
      sourceRevisionId: 101,
      text: "Legacy example",
      legacyBackfill: true,
      createdAt: "1900-01-01T00:00:00.000Z",
      author: null
    },
    {
      id: 202,
      definitionId: 10,
      exampleNumber: 2,
      sourceRevisionId: 102,
      text: "Observed example",
      legacyBackfill: false,
      createdAt: "2026-01-03T00:00:00.000Z",
      author: privateUser
    }
  ],
  exampleSelections: [
    {
      id: 301,
      definitionId: 10,
      exampleId: 201,
      selectedAt: "1900-01-01T00:00:00.000Z",
      endedAt: "2026-01-04T00:00:00.000Z",
      legacyBackfill: true,
      selectedBy: null,
      endedBy: publicUser
    },
    {
      id: 302,
      definitionId: 10,
      exampleId: 202,
      selectedAt: "2026-01-04T00:00:00.000Z",
      endedAt: "2026-01-05T00:00:00.000Z",
      legacyBackfill: false,
      selectedBy: publicUser,
      endedBy: privateUser
    },
    {
      id: 303,
      definitionId: 10,
      exampleId: 201,
      selectedAt: "2026-01-05T00:00:00.000Z",
      endedAt: null,
      legacyBackfill: false,
      selectedBy: privateUser,
      endedBy: null
    }
  ],
  revisionReferences: [
    { revisionId: 101 },
    { revisionId: 102 },
    { revisionId: 102 }
  ],
  acceptedSuggestions: [
    {
      outputDefinitionId: 10,
      status: "accepted",
      model: "accepted-model",
      inference: {
        provider: "wolfram-agent-one",
        model: "accepted-model",
        profile: "fixture",
        configHash: "fixture"
      },
      modelInputCount: 3
    },
    // The builder must still reject a generated/discarded row supplied by a
    // caller, even though the loader already filters status in SQL.
    {
      outputDefinitionId: 10,
      status: "discarded",
      model: "discarded-model",
      inference: null,
      modelInputCount: 99
    }
  ]
}
const activity = buildTermActivity(records)
assert.equal(activity.summary.examplePublications, 1)
assert.equal(activity.summary.exampleFeatureStarts, 2)
assert.equal(activity.summary.exampleFeatureEnds, 2)
assert.equal(activity.summary.unknownExamplePublicationTimes, 1)
assert.equal(activity.summary.unknownExampleFeatureStartTimes, 1)
assert.equal(activity.summary.firstAt, "2026-01-01T00:00:00.000Z")
assert.equal(activity.summary.lastAt, "2026-01-05T00:00:00.000Z")
assert.ok(activity.events.every((item) => !item.at.startsWith("1900")))
assert.equal(
  new Set(activity.events.map((item) => item.key)).size,
  activity.events.length
)

const exampleEvents = activity.events.filter(isExampleActivityEvent)
const publication = exampleEvents.find(
  (item) => item.kind === "example-publication"
)!
assert.equal(publication.version, 2)
assert.equal(publication.exampleNumber, 2)
assert.deepEqual(publication.actor, { name: "Private contributor" })
const legacyEnd = exampleEvents.find(
  (item) => item.kind === "example-unfeatured" && item.exampleNumber === 1
)!
assert.equal(legacyEnd.at, "2026-01-04T00:00:00.000Z")
assert.equal(legacyEnd.version, null)
assert.equal(legacyEnd.legacyExample, true)
assert.deepEqual(legacyEnd.actor, {
  name: "Public contributor",
  profileHref: "/people/7"
})
assert.match(
  activityEventAriaLabel(legacyEnd),
  /Example feature ended: Example 1 for Definition 1/
)
assert.ok(!activityEventAriaLabel(legacyEnd).includes("revision null"))
assert.equal(
  activityEventHref(activity.term, legacyEnd),
  "/vocabulary/test/water/definitions/1#examples-heading"
)
assert.equal(
  activity.events.filter((item) => matchesActivityEventFilter(item, "examples"))
    .length,
  5
)
assert.equal(
  activity.events.filter((item) =>
    matchesActivityEventFilter(item, "revisions")
  ).length,
  2
)
assert.equal(
  activity.events.filter((item) => matchesActivityEventFilter(item, "comments"))
    .length,
  0
)
assert.equal(
  activity.events.filter((item) => matchesActivityEventFilter(item, "unknown"))
    .length,
  activity.events.length
)

const revisions = activity.events.filter(isRevisionActivityEvent)
assert.deepEqual(revisions[0].evidence, {
  model: "model-v1",
  provider: "wolfram-agent-one",
  citedReferenceCount: 1,
  modelInputCount: 3
})
assert.deepEqual(revisions[1].evidence, {
  model: null,
  provider: null,
  citedReferenceCount: 2,
  modelInputCount: 0
})
assert.equal(
  activityEvidenceHref(activity.term, revisions[1]),
  "/vocabulary/test/water/provenance#definition-1-revision-2-evidence"
)
assert.equal(
  activityEventHref(activity.term, revisions[1]),
  "/vocabulary/test/water/definitions/1/revisions/2"
)
const exampleGeometry = buildActivityTimelineGeometry(
  activity.definitions,
  activity.events
)
assert.equal(exampleGeometry.marks.length, activity.events.length)
assert.ok(
  exampleGeometry.marks.every(
    (mark) => Number.isFinite(mark.x) && Number.isFinite(mark.y)
  )
)
const sameTime = exampleGeometry.marks.filter(
  (mark) => mark.event.at === "2026-01-04T00:00:00.000Z"
)
assert.equal(sameTime.length, 2)
assert.notEqual(
  sameTime[0].y,
  sameTime[1].y,
  "feature end and replacement start retain separate lanes"
)
for (const privateField of [
  '"id"',
  '"userId"',
  '"editorId"',
  '"prompt"',
  '"revisionId"',
  '"definitionId"'
])
  assert.ok(!JSON.stringify(activity).includes(privateField))
assert.equal(
  buildTermActivity({
    ...records,
    definitions: [],
    revisions: [],
    examples: [],
    exampleSelections: []
  }).events.length,
  0
)

console.log(
  "Activity timeline, observed example history, and revision evidence fixture checks passed."
)
