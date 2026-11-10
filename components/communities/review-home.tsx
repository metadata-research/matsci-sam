"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { trpc } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { communityReviewHref } from "@/lib/community-review-types"
import { communityContributionActions } from "@/lib/community-actions"
import { ClipboardCheck, PencilLine, FolderPen } from "lucide-react"

export function CommunityReviewHome({
  communityId,
  slug,
  areas,
  area,
  canManage,
  standards,
  reviewOnly = false
}: {
  communityId: number
  slug: string
  areas: { id: string; label: string }[]
  area?: string
  canManage: boolean
  standards: boolean
  reviewOnly?: boolean
}) {
  const router = useRouter()
  const rounds = trpc.communityReviews.list.useQuery({ communityId })
  const rows =
    rounds.data?.filter((row) => !area || row.area === area || !row.area) ?? []
  const active = rows.filter((row) => !row.closedAt)
  const actions = communityContributionActions({
    communityId,
    communitySlug: slug,
    metadataEnabled: standards,
    profile: area
  })
  const href = (view: string) =>
    "/communities/" +
    slug +
    "?" +
    new URLSearchParams({ view, ...(area ? { profile: area } : {}) })
  return (
    <section
      className="flex flex-col gap-6"
      aria-label={reviewOnly ? "Community reviews" : "Community quick start"}
    >
      {areas.length > 0 && (
        <label className="flex max-w-sm flex-col gap-2 text-sm font-medium">
          Area
          <select
            aria-label="Area"
            className="h-10 rounded-md border bg-background px-3"
            value={area ?? ""}
            onChange={(event) =>
              router.push(
                "/communities/" +
                  slug +
                  "?" +
                  new URLSearchParams({
                    view: reviewOnly ? "review" : "quickstart",
                    ...(event.target.value
                      ? { profile: event.target.value }
                      : {})
                  })
              )
            }
          >
            <option value="">All areas</option>
            {areas.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {!reviewOnly && (
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: actions.feedback.label,
              text: standards
                ? "Give feedback on fields and proposed changes."
                : "Give feedback on definitions.",
              href: active[0]
                ? communityReviewHref(slug, active[0].id, active[0].area)
                : actions.feedback.href,
              Icon: ClipboardCheck
            },
            {
              title: actions.change.label,
              text: "Choose an entry to revise.",
              href: actions.change.href,
              Icon: PencilLine
            },
            {
              title: actions.draft.label,
              text: "Resume a draft or revisit your contributions.",
              href: actions.draft.href,
              Icon: FolderPen
            }
          ].map(({ title, text, href, Icon }) => (
            <div
              key={title}
              className="flex flex-col items-start gap-3 rounded-xl border p-5"
            >
              <Icon aria-hidden className="size-5 text-muted-foreground" />
              <Button asChild variant="outline">
                <Link href={href}>{title}</Link>
              </Button>
              <p className="text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Open reviews</h2>
          {canManage && (
            <Link
              className="text-sm underline"
              href={href("review") + "&manage=1#participant-responses"}
            >
              Request feedback / View results
            </Link>
          )}
        </div>
        {rounds.isPending ? (
          <p role="status">Loading reviews…</p>
        ) : rounds.error ? (
          <p role="alert">{rounds.error.message}</p>
        ) : active.length ? (
          <ul className="divide-y rounded-lg border">
            {active.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-2 p-3"
              >
                <Link
                  className="flex min-h-11 flex-1 items-center justify-between gap-4 rounded-md px-1 hover:bg-accent"
                  href={communityReviewHref(slug, row.id, row.area)}
                >
                  <span className="font-medium">
                    {row.name}
                    {row.datasetExercise && (
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        Includes a dataset exercise
                      </span>
                    )}
                  </span>
                  <span className="text-sm">Give feedback →</span>
                </Link>
                {canManage && (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={
                        communityReviewHref(slug, row.id, row.area) +
                        "&manage=1#participant-responses"
                      }
                    >
                      View results
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            No open reviews{area ? " in this area" : ""}.
          </p>
        )}
        {rows.some((row) => row.closedAt) && (
          <details>
            <summary className="cursor-pointer text-sm">Closed reviews</summary>
            <ul>
              {rows
                .filter((row) => row.closedAt)
                .map((row) => (
                  <li key={row.id}>
                    <Link
                      className="block py-2 underline"
                      href={communityReviewHref(slug, row.id, row.area)}
                    >
                      {row.name}
                    </Link>
                    {canManage && (
                      <Link
                        className="inline-block min-h-11 py-2 text-sm underline"
                        href={
                          communityReviewHref(slug, row.id, row.area) +
                          "&manage=1#participant-responses"
                        }
                      >
                        View results for {row.name}
                      </Link>
                    )}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  )
}
