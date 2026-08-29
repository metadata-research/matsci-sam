import type { DefinitionComparisonView } from "@/lib/definition-comparison"
import { revisionPath } from "@/lib/public-identifiers"
import { DiffOp } from "diff-match-patch-ts"
import { ArrowRightIcon, InfoIcon } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

const signed = (value: number) => (value > 0 ? `+${value}` : String(value))

const referenceLabel = (
  reference: NonNullable<DefinitionComparisonView["before"]>
) => `Definition ${reference.definitionNumber}, revision ${reference.version}`

export function RevisionDiff({
  comparison,
  headingLevel = "h2",
  id = "revision-changes"
}: {
  comparison: DefinitionComparisonView
  headingLevel?: "h2" | "h3"
  id?: string
}) {
  const Heading = headingLevel
  const hasComparison = comparison.before !== null
  const hasChanges =
    comparison.metrics.charsAdded > 0 || comparison.metrics.charsRemoved > 0

  return (
    <Card aria-labelledby={`${id}-heading`}>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <Heading id={`${id}-heading`} className="text-xl font-semibold">
              {comparison.basis === "selected"
                ? "Textual comparison"
                : hasComparison
                  ? "Changes in this revision"
                  : "Initial publication"}
            </Heading>
            {comparison.before ? (
              <p className="text-sm text-muted-foreground">
                Compared with{" "}
                <Link
                  href={revisionPath(
                    comparison.before.termSlug,
                    comparison.before.definitionNumber,
                    comparison.before.version,
                    comparison.before.vocabularySlug
                  )}
                  className="font-medium text-primary hover:underline"
                >
                  {referenceLabel(comparison.before)}
                </Link>
                {comparison.basis === "derived-source"
                  ? ", the source of this proposal."
                  : comparison.basis === "selected"
                    ? ", reading from the first selection to the second."
                    : "."}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                This is the first recorded text for this definition.
              </p>
            )}
          </div>
          {comparison.basis === "derived-source" ? (
            <Badge variant="outline">Source comparison</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasComparison ? (
          <>
            <div
              className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"
              aria-label="Difference legend"
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="rounded-sm bg-emerald-500/15 px-1 text-emerald-800 underline decoration-2 underline-offset-2 dark:text-emerald-300"
                >
                  Added
                </span>
                inserted text
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="rounded-sm bg-destructive/15 px-1 text-destructive line-through decoration-2"
                >
                  Removed
                </span>
                deleted text
              </span>
            </div>
            <p className="rounded-lg border bg-muted/20 p-4 text-base leading-8 whitespace-pre-wrap">
              {hasChanges ? (
                comparison.diff.map(([operation, text], index) => {
                  if (operation === DiffOp.Insert)
                    return (
                      <ins
                        key={index}
                        className="rounded-sm bg-emerald-500/15 px-0.5 text-emerald-800 decoration-2 underline-offset-2 dark:text-emerald-300"
                      >
                        <span className="sr-only">Added: </span>
                        {text}
                      </ins>
                    )
                  if (operation === DiffOp.Delete)
                    return (
                      <del
                        key={index}
                        className="rounded-sm bg-destructive/15 px-0.5 text-destructive decoration-2"
                      >
                        <span className="sr-only">Removed: </span>
                        {text}
                      </del>
                    )
                  return <span key={index}>{text}</span>
                })
              ) : (
                <span>No textual differences.</span>
              )}
            </p>
          </>
        ) : null}

        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {hasComparison ? (
            <>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Added</dt>
                <dd className="mt-1 text-lg font-semibold">
                  +{comparison.metrics.charsAdded} characters
                </dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Removed</dt>
                <dd className="mt-1 text-lg font-semibold">
                  −{comparison.metrics.charsRemoved} characters
                </dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Length</dt>
                <dd className="mt-1 flex items-center gap-1 text-lg font-semibold">
                  {comparison.metrics.beforeChars}
                  <ArrowRightIcon className="size-4" aria-label="to" />
                  {comparison.metrics.afterChars}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({signed(comparison.metrics.netChars)})
                  </span>
                </dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">
                  Definition edit magnitude
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {comparison.metrics.editMagnitude.toFixed(3)}
                </dd>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Length</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {comparison.metrics.afterChars} characters
                </dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Words</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {comparison.metrics.afterWords}
                </dd>
              </div>
            </>
          )}
        </dl>

        {hasComparison ? (
          <p className="flex gap-2 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            The magnitude runs from 0 for unchanged text to 1 for complete
            replacement. It measures definition wording only—not authorship,
            quality, or community impact.
          </p>
        ) : null}
        {comparison.caveat ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            {comparison.caveat}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
