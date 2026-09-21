"use client"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import type {
  TermActivityData,
  TermActivityEvent,
  TermActivityRevisionEvent
} from "@/lib/term-activity-types"
import Link from "next/link"
import {
  activityEventDetail,
  activityEventHref,
  activityEvidenceHref,
  activityEventName,
  formatActivityDateTime,
  isExampleActivityEvent,
  isRevisionActivityEvent
} from "./activity-presenters"

type ActivityEventTableProps = {
  term: TermActivityData["term"]
  events: TermActivityEvent[]
  selectedRevisionKey: string | null
  onSelectRevision: (event: TermActivityRevisionEvent) => void
}

export function ActivityEventTable({
  term,
  events,
  selectedRevisionKey,
  onSelectRevision
}: ActivityEventTableProps) {
  const newestFirst = events.toReversed()

  return (
    <section aria-labelledby="activity-table-heading" className="space-y-3">
      <div>
        <h2 id="activity-table-heading" className="text-2xl font-semibold">
          Event record
        </h2>
        <p className="text-sm text-muted-foreground">
          The same events as the plot, newest first, with exact UTC times and
          links to the revision or independent example each act concerned.
        </p>
      </div>
      <Table>
        <TableCaption>
          {newestFirst.length} recorded events in the current filter.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Definition</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {newestFirst.map((event) => (
            <TableRow
              key={event.key}
              data-state={
                event.key === selectedRevisionKey ? "selected" : undefined
              }
            >
              <TableCell className="whitespace-normal text-xs text-muted-foreground">
                {formatActivityDateTime(event.at)}
              </TableCell>
              <TableCell>
                <Link
                  href={activityEventHref(term, event)}
                  className="font-medium text-primary hover:underline"
                >
                  Definition {event.definitionNumber}
                  {isExampleActivityEvent(event)
                    ? ` · example ${event.exampleNumber}`
                    : ` · revision ${event.version}`}
                </Link>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  <span>{activityEventName(event)}</span>
                  {isRevisionActivityEvent(event) ? (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => onSelectRevision(event)}
                    >
                      Compare
                    </button>
                  ) : null}
                </div>
                {event.actor ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    By{" "}
                    {event.actor.profileHref ? (
                      <Link
                        href={event.actor.profileHref}
                        className="text-primary hover:underline"
                      >
                        {event.actor.name}
                      </Link>
                    ) : (
                      event.actor.name
                    )}
                  </p>
                ) : null}
                {isRevisionActivityEvent(event) && event.evidence ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {event.evidence.model || event.evidence.provider
                      ? `${[event.evidence.model, event.evidence.provider].filter(Boolean).join(" · ")} · `
                      : ""}
                    {event.evidence.citedReferenceCount} cited references ·{" "}
                    {event.evidence.modelInputCount} model input references.{" "}
                    <Link
                      href={activityEvidenceHref(term, event)}
                      className="text-primary hover:underline"
                    >
                      View revision evidence
                    </Link>
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="min-w-60 whitespace-normal">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{activityEventDetail(event)}</span>
                  {(event.kind === "comment" || event.kind === "vote") &&
                  event.migratedLegacy ? (
                    <Badge variant="outline">Legacy association inferred</Badge>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
