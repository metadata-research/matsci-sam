import { TermActivityExplorer } from "@/components/activity/term-activity-explorer"
import { Card, CardContent } from "@/components/ui/card"
import { termPath, vocabularyPath } from "@/lib/public-identifiers"
import type { TermActivityData } from "@/lib/term-activity-types"
import { ActivityIcon, ArrowLeftIcon, InfoIcon } from "lucide-react"
import Link from "next/link"
import { Suspense } from "react"

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric"
})

const summaryItems = (activity: TermActivityData) => [
  { label: "Definitions", value: activity.summary.definitions },
  { label: "Publications", value: activity.summary.publications },
  { label: "Later revisions", value: activity.summary.laterRevisions },
  { label: "Comments", value: activity.summary.comments },
  { label: "Vote acts", value: activity.summary.voteActs }
]

export function TermActivityPage({ activity }: { activity: TermActivityData }) {
  const span =
    activity.summary.firstAt && activity.summary.lastAt
      ? `${dateFormatter.format(new Date(activity.summary.firstAt))}–${dateFormatter.format(new Date(activity.summary.lastAt))}`
      : null

  return (
    <main className="px-4 py-8 sm:py-10">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <header className="space-y-4">
          <Link
            href={termPath(activity.term.slug, activity.term.vocabularySlug)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            Definitions for {activity.term.label}
          </Link>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ActivityIcon className="size-4 text-primary" aria-hidden />
              <span>Changes &amp; activity</span>
              <span aria-hidden>·</span>
              <Link
                href={vocabularyPath(activity.term.vocabularySlug)}
                className="text-primary hover:underline"
              >
                {activity.term.vocabularyTitle}
              </Link>
            </div>
            <h1 className="font-serif text-4xl font-bold tracking-tight">
              {activity.term.label}
            </h1>
            <p className="max-w-3xl text-muted-foreground">
              Compare exact published wording and inspect when definitions,
              revisions, comments, and voting acts were recorded.
            </p>
          </div>
        </header>

        <section
          aria-labelledby="activity-summary-heading"
          className="space-y-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="activity-summary-heading" className="text-xl font-semibold">
              Recorded history
            </h2>
            {span ? (
              <span className="text-xs text-muted-foreground">
                {span} · UTC
              </span>
            ) : null}
          </div>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {summaryItems(activity).map((item) => (
              <Card key={item.label} className="py-3">
                <CardContent>
                  <dt className="text-xs text-muted-foreground">
                    {item.label}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">
                    {item.value}
                  </dd>
                </CardContent>
              </Card>
            ))}
          </dl>
        </section>

        {activity.events.length ? (
          <Suspense
            fallback={
              <div
                className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
                role="status"
              >
                Preparing activity view…
              </div>
            }
          >
            <TermActivityExplorer activity={activity} />
          </Suspense>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No definition activity has been recorded for this term yet.
          </div>
        )}

        <aside className="flex gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            The display reports observed events and textual change. It does not
            turn edit size, comments, or votes into a contributor-impact score,
            and it does not infer that a comment caused a later revision.
          </p>
        </aside>
      </div>
    </main>
  )
}
