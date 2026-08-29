import type {
  TermActivityDefinition,
  TermActivityEvent
} from "./term-activity-types"

export const ACTIVITY_TIMELINE_WIDTH = 920
export const ACTIVITY_TIMELINE_LEFT = 112
export const ACTIVITY_TIMELINE_RIGHT = 36
export const ACTIVITY_TIMELINE_TOP = 48
export const ACTIVITY_TIMELINE_ROW_HEIGHT = 72
export const ACTIVITY_TIMELINE_BOTTOM = 50

export type ActivityTimelineMark = {
  event: TermActivityEvent
  x: number
  y: number
}

export type ActivityTimelineGeometry = {
  width: number
  height: number
  rows: Array<{ definitionNumber: number; y: number }>
  marks: ActivityTimelineMark[]
  ticks: Array<{ at: string; x: number }>
  domain: { firstAt: string; lastAt: string } | null
}

const laneOffset: Record<TermActivityEvent["kind"], number> = {
  publication: -18,
  revision: -18,
  comment: 3,
  vote: 22
}

const uniqueTimes = (values: number[]) => Array.from(new Set(values))

export function buildActivityTimelineGeometry(
  definitions: TermActivityDefinition[],
  events: TermActivityEvent[]
): ActivityTimelineGeometry {
  const rows = definitions.map((definition, index) => ({
    definitionNumber: definition.number,
    y: ACTIVITY_TIMELINE_TOP + index * ACTIVITY_TIMELINE_ROW_HEIGHT + 28
  }))
  const height =
    ACTIVITY_TIMELINE_TOP +
    Math.max(definitions.length, 1) * ACTIVITY_TIMELINE_ROW_HEIGHT +
    ACTIVITY_TIMELINE_BOTTOM
  const validEvents = events.filter((event) =>
    Number.isFinite(Date.parse(event.at))
  )
  if (validEvents.length === 0)
    return {
      width: ACTIVITY_TIMELINE_WIDTH,
      height,
      rows,
      marks: [],
      ticks: [],
      domain: null
    }

  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const event of validEvents) {
    const at = Date.parse(event.at)
    if (at < first) first = at
    if (at > last) last = at
  }
  const plotStart = ACTIVITY_TIMELINE_LEFT
  const plotEnd = ACTIVITY_TIMELINE_WIDTH - ACTIVITY_TIMELINE_RIGHT
  const span = last - first
  const xFor = (at: string) =>
    span === 0
      ? (plotStart + plotEnd) / 2
      : plotStart + ((Date.parse(at) - first) / span) * (plotEnd - plotStart)
  const rowByDefinition = new Map(
    rows.map((row) => [row.definitionNumber, row.y])
  )
  const tickTimes = uniqueTimes(
    span === 0 ? [first] : [first, first + span / 2, last]
  )

  return {
    width: ACTIVITY_TIMELINE_WIDTH,
    height,
    rows,
    marks: validEvents.flatMap((event) => {
      const row = rowByDefinition.get(event.definitionNumber)
      return row === undefined
        ? []
        : [{ event, x: xFor(event.at), y: row + laneOffset[event.kind] }]
    }),
    ticks: tickTimes.map((at) => ({
      at: new Date(at).toISOString(),
      x: xFor(new Date(at).toISOString())
    })),
    domain: {
      firstAt: new Date(first).toISOString(),
      lastAt: new Date(last).toISOString()
    }
  }
}
