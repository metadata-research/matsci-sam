"use client"

import { RevisionDiff } from "@/components/definition/revision-diff"
import { revisionPath } from "@/lib/public-identifiers"
import type {
  TermActivityData,
  TermActivityRevisionEvent
} from "@/lib/term-activity-types"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ActivityEventTable } from "./activity-event-table"
import {
  formatActivityDateTime,
  isRevisionActivityEvent,
  revisionSelection,
  validActivityDefinitionNumber
} from "./activity-presenters"
import { ActivityTimeline } from "./activity-timeline"
import { CurrentDefinitionComparison } from "./current-definition-comparison"

export function TermActivityExplorer({
  activity
}: {
  activity: TermActivityData
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const filteredDefinition = validActivityDefinitionNumber(
    searchParams.get("definition"),
    activity.definitions
  )
  const visibleDefinitions = filteredDefinition
    ? activity.definitions.filter(
        (definition) => definition.number === filteredDefinition
      )
    : activity.definitions
  const visibleEvents = filteredDefinition
    ? activity.events.filter(
        (event) => event.definitionNumber === filteredDefinition
      )
    : activity.events
  const visibleRevisions = visibleEvents.filter(isRevisionActivityEvent)
  const requestedRevision = searchParams.get("revision")
  const selectedRevision =
    visibleRevisions.find(
      (event) => revisionSelection(event) === requestedRevision
    ) ??
    visibleRevisions.findLast((event) => event.comparison.before !== null) ??
    visibleRevisions.at(-1) ??
    null

  const navigate = (
    changes: Record<string, string | null>,
    method: "push" | "replace" = "push"
  ) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    router[method](query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const selectRevision = (event: TermActivityRevisionEvent) =>
    navigate({ revision: revisionSelection(event) })
  const selectedKey = selectedRevision?.key ?? null

  return (
    <div className="space-y-10">
      <section
        aria-labelledby="activity-timeline-heading"
        className="space-y-4"
      >
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h2
              id="activity-timeline-heading"
              className="text-2xl font-semibold"
            >
              Recorded activity over time
            </h2>
            <p className="text-sm text-muted-foreground">
              Each mark is one recorded act. Select a publication or revision to
              inspect its wording below.
            </p>
          </div>
          <label className="space-y-1 text-sm font-medium sm:w-56">
            Definition
            <select
              value={filteredDefinition ?? "all"}
              onChange={(event) =>
                navigate({
                  definition:
                    event.target.value === "all" ? null : event.target.value,
                  revision: null
                })
              }
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">All definitions</option>
              {activity.definitions.map((definition) => (
                <option key={definition.number} value={definition.number}>
                  Definition {definition.number}
                </option>
              ))}
            </select>
          </label>
        </header>

        <p className="text-sm" aria-live="polite">
          Showing <strong>{visibleEvents.length}</strong> recorded events for{" "}
          <strong>
            {filteredDefinition
              ? `Definition ${filteredDefinition}`
              : `all ${activity.definitions.length} definitions`}
          </strong>
          .
        </p>
        <ActivityTimeline
          definitions={visibleDefinitions}
          events={visibleEvents}
          selectedRevisionKey={selectedKey}
          onSelectRevision={selectRevision}
        />
      </section>

      {selectedRevision ? (
        <section
          aria-labelledby="selected-revision-heading"
          className="space-y-4"
        >
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2
                id="selected-revision-heading"
                className="text-2xl font-semibold"
              >
                Selected revision
              </h2>
              <p className="text-sm text-muted-foreground">
                Definition {selectedRevision.definitionNumber}, revision{" "}
                {selectedRevision.version} ·{" "}
                {formatActivityDateTime(selectedRevision.at)}
              </p>
            </div>
            <Link
              href={revisionPath(
                activity.term.slug,
                selectedRevision.definitionNumber,
                selectedRevision.version,
                activity.term.vocabularySlug
              )}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open revision page
            </Link>
          </header>
          <RevisionDiff
            comparison={selectedRevision.comparison}
            headingLevel="h3"
            id="selected-revision-comparison"
          />
        </section>
      ) : null}

      <CurrentDefinitionComparison
        activity={activity}
        updateParams={navigate}
      />

      <ActivityEventTable
        term={activity.term}
        events={visibleEvents}
        selectedRevisionKey={selectedKey}
        onSelectRevision={selectRevision}
      />
    </div>
  )
}
