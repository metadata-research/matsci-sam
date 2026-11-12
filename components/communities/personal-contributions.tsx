import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/date"
import { proposalStatusLabels } from "@/lib/community-standard-types"
import { withCommunityWorkReturn } from "@/lib/community-work-return"
import type { PersonalCommunityContribution } from "@/lib/community-personal-work"

export function PersonalContributions({
  rows,
  hasMore,
  offset,
  returnTo
}: {
  rows: PersonalCommunityContribution[]
  hasMore: boolean
  offset: number
  returnTo: string
}) {
  function pageHref(next: number) {
    const url = new URL(returnTo, "http://local")
    if (next) url.searchParams.set("contributionOffset", String(next))
    else url.searchParams.delete("contributionOffset")
    return `${url.pathname}${url.search}#submitted-work`
  }
  return (
    <section className="flex flex-col gap-3" aria-labelledby="submitted-work">
      <h3
        id="submitted-work"
        tabIndex={-1}
        data-section-target
        className="text-lg font-semibold"
      >
        Submitted and published
      </h3>
      {rows.length ? (
        <ul className="divide-y rounded-lg border">
          {rows.map((row) => (
            <li
              key={row.target}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  className="break-words font-medium underline underline-offset-4"
                  href={withCommunityWorkReturn(row.href, returnTo)}
                >
                  {row.label}
                </Link>
                <p className="mt-1 text-sm text-muted-foreground">
                  {row.version}
                  {row.referenceVersion
                    ? ` · Reference ${/^\d/.test(row.referenceVersion) ? "v" : ""}${row.referenceVersion}`
                    : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.kind === "proposal" ? "Submitted" : "Published"}{" "}
                  <time dateTime={row.createdAt}>
                    {formatDateTime(row.createdAt)}
                  </time>
                </p>
              </div>
              <Badge variant="secondary">
                {row.kind === "definition"
                  ? "Published"
                  : (proposalStatusLabels[row.status] ?? "Submitted")}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No submitted or published contributions yet.
        </p>
      )}
      {offset > 0 || hasMore ? (
        <nav
          aria-label="Submitted work pages"
          className="flex items-center justify-between gap-3"
        >
          {offset > 0 ? (
            <Button asChild variant="outline">
              <Link href={pageHref(Math.max(0, offset - 40))}>Previous</Link>
            </Button>
          ) : (
            <span />
          )}
          {hasMore ? (
            <Button asChild variant="outline">
              <Link href={pageHref(offset + 40)}>Next</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </section>
  )
}
