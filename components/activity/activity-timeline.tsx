"use client"

import {
  buildActivityTimelineGeometry,
  type ActivityTimelineMark
} from "@/lib/activity-timeline"
import type {
  TermActivityDefinition,
  TermActivityEvent,
  TermActivityRevisionEvent
} from "@/lib/term-activity-types"
import { useId, useMemo, useState } from "react"
import {
  activityEventAriaLabel,
  formatActivityDate,
  isRevisionActivityEvent
} from "./activity-presenters"

const MarkShape = ({ mark }: { mark: ActivityTimelineMark }) => {
  if (mark.event.kind === "publication")
    return (
      <path
        d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"
        className="fill-purple-600 dark:fill-purple-400"
      />
    )
  if (mark.event.kind === "revision")
    return <circle r="7" className="fill-primary" />
  if (mark.event.kind === "comment")
    return (
      <path
        d="M 0 -8 L 8 7 L -8 7 Z"
        className="fill-amber-600 dark:fill-amber-400"
      />
    )
  return (
    <path
      d="M -7 -2 H -2 V -7 H 2 V -2 H 7 V 2 H 2 V 7 H -2 V 2 H -7 Z"
      className="fill-teal-700 dark:fill-teal-300"
    />
  )
}

export function ActivityTimeline({
  definitions,
  events,
  selectedRevisionKey,
  onSelectRevision
}: {
  definitions: TermActivityDefinition[]
  events: TermActivityEvent[]
  selectedRevisionKey: string | null
  onSelectRevision: (event: TermActivityRevisionEvent) => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const geometry = useMemo(
    () => buildActivityTimelineGeometry(definitions, events),
    [definitions, events]
  )

  if (events.length === 0)
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        No recorded activity matches this definition filter.
      </div>
    )

  return (
    <div className="space-y-3">
      <ul
        className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"
        aria-label="Timeline event symbols"
      >
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2.5 rotate-45 bg-purple-600 dark:bg-purple-400"
          />
          Publication
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-full bg-primary" />
          Later revision
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-0 border-x-[6px] border-b-[10px] border-x-transparent border-b-amber-600 dark:border-b-amber-400"
          />
          Comment
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="text-base font-bold leading-none text-teal-700 dark:text-teal-300"
          >
            +
          </span>
          Vote act
        </li>
      </ul>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <svg
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          className="min-w-[720px] w-full"
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
        >
          <title id={titleId}>Recorded term activity by definition</title>
          <desc id={descriptionId}>
            Time runs from left to right in UTC. Each definition has one row.
            Diamonds mark publications, circles later revisions, triangles
            comments, and plus signs voting acts. The table after the chart
            contains every event and exact value.
          </desc>

          {geometry.rows.map((row, index) => (
            <g key={row.definitionNumber}>
              <rect
                x="0"
                y={row.y - 32}
                width={geometry.width}
                height="64"
                className={index % 2 === 0 ? "fill-muted/25" : "fill-card"}
              />
              <line
                x1="112"
                x2={geometry.width - 36}
                y1={row.y}
                y2={row.y}
                className="stroke-border"
              />
              <text
                x="12"
                y={row.y + 4}
                className="fill-foreground text-[12px] font-medium"
              >
                Definition {row.definitionNumber}
              </text>
            </g>
          ))}

          {geometry.ticks.map((tick, index) => (
            <g key={tick.at}>
              <line
                x1={tick.x}
                x2={tick.x}
                y1="26"
                y2={geometry.height - 34}
                className="stroke-border/70"
                strokeDasharray="3 5"
              />
              <text
                x={tick.x}
                y={geometry.height - 15}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === geometry.ticks.length - 1
                      ? "end"
                      : "middle"
                }
                className="fill-muted-foreground text-[11px]"
              >
                {formatActivityDate(tick.at)}
              </text>
            </g>
          ))}

          {geometry.marks.map((mark) => {
            const selectableEvent = isRevisionActivityEvent(mark.event)
              ? mark.event
              : null
            const selected = mark.event.key === selectedRevisionKey
            const focused = mark.event.key === focusedKey
            return (
              <g
                key={mark.event.key}
                transform={`translate(${mark.x} ${mark.y})`}
                tabIndex={0}
                role={selectableEvent ? "button" : "img"}
                aria-label={activityEventAriaLabel(mark.event)}
                className={
                  selectableEvent
                    ? "cursor-pointer outline-none"
                    : "outline-none"
                }
                onClick={
                  selectableEvent
                    ? () => onSelectRevision(selectableEvent)
                    : undefined
                }
                onKeyDown={
                  selectableEvent
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          onSelectRevision(selectableEvent)
                        }
                      }
                    : undefined
                }
                onFocus={() => setFocusedKey(mark.event.key)}
                onBlur={() => setFocusedKey(null)}
              >
                <title>{activityEventAriaLabel(mark.event)}</title>
                <circle r="18" fill="transparent" />
                {selected || focused ? (
                  <circle
                    r="12"
                    fill="none"
                    className="stroke-foreground"
                    strokeWidth={selected ? 2 : 1.5}
                  />
                ) : null}
                <MarkShape mark={mark} />
              </g>
            )
          })}
        </svg>
      </div>
      <p className="text-xs text-muted-foreground">
        Exact recorded times are retained; the axis is labelled in UTC. Event
        types are not combined into a weighted activity or impact score.
      </p>
    </div>
  )
}
