"use client"

import { RevisionDiff } from "@/components/definition/revision-diff"
import { buildDefinitionComparison } from "@/lib/definition-comparison"
import type { TermActivityData } from "@/lib/term-activity-types"
import { useSearchParams } from "next/navigation"
import { validActivityDefinitionNumber } from "./activity-presenters"

type CurrentDefinitionComparisonProps = {
  activity: TermActivityData
  updateParams: (changes: Record<string, string | null>) => void
}

export function CurrentDefinitionComparison({
  activity,
  updateParams
}: CurrentDefinitionComparisonProps) {
  const searchParams = useSearchParams()
  if (activity.definitions.length < 2) return null

  const fallbackFrom = activity.definitions[0]
  const fallbackTo = activity.definitions[1]
  const fromNumber =
    validActivityDefinitionNumber(
      searchParams.get("from"),
      activity.definitions
    ) ?? fallbackFrom.number
  let toNumber =
    validActivityDefinitionNumber(
      searchParams.get("to"),
      activity.definitions
    ) ?? fallbackTo.number
  if (toNumber === fromNumber)
    toNumber =
      activity.definitions.find(
        (definition) => definition.number !== fromNumber
      )?.number ?? toNumber

  const from = activity.definitions.find(
    (definition) => definition.number === fromNumber
  )!
  const to = activity.definitions.find(
    (definition) => definition.number === toNumber
  )!
  const comparison = buildDefinitionComparison({
    basis: "selected",
    before: {
      definitionNumber: from.number,
      version: from.currentRevision.version,
      termSlug: activity.term.slug,
      vocabularySlug: activity.term.vocabularySlug,
      text: from.currentRevision.text
    },
    after: {
      definitionNumber: to.number,
      version: to.currentRevision.version,
      termSlug: activity.term.slug,
      vocabularySlug: activity.term.vocabularySlug,
      text: to.currentRevision.text
    }
  })

  return (
    <section
      aria-labelledby="current-definition-comparison-heading"
      className="space-y-4"
    >
      <header className="space-y-1">
        <h2
          id="current-definition-comparison-heading"
          className="text-2xl font-semibold"
        >
          Compare current definitions
        </h2>
        <p className="text-sm text-muted-foreground">
          Select two current candidates to see their exact wording differences.
          Removed text belongs to the first selection; added text belongs to the
          second.
        </p>
      </header>
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <label className="space-y-1 text-sm font-medium">
          First definition
          <select
            value={from.number}
            onChange={(event) => {
              const nextFrom = Number(event.target.value)
              const nextTo =
                nextFrom === to.number
                  ? (activity.definitions.find(
                      (definition) => definition.number !== nextFrom
                    )?.number ?? to.number)
                  : to.number
              updateParams({
                from: String(nextFrom),
                to: String(nextTo)
              })
            }}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            {activity.definitions.map((definition) => (
              <option key={definition.number} value={definition.number}>
                Definition {definition.number}, revision{" "}
                {definition.currentRevision.version}
              </option>
            ))}
          </select>
        </label>
        <span
          className="hidden pb-2 text-muted-foreground sm:block"
          aria-hidden
        >
          →
        </span>
        <label className="space-y-1 text-sm font-medium">
          Second definition
          <select
            value={to.number}
            onChange={(event) =>
              updateParams({
                from: String(from.number),
                to: event.target.value
              })
            }
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          >
            {activity.definitions
              .filter((definition) => definition.number !== from.number)
              .map((definition) => (
                <option key={definition.number} value={definition.number}>
                  Definition {definition.number}, revision{" "}
                  {definition.currentRevision.version}
                </option>
              ))}
          </select>
        </label>
      </div>
      <RevisionDiff
        comparison={comparison}
        headingLevel="h3"
        id="current-definition-text-comparison"
      />
    </section>
  )
}
