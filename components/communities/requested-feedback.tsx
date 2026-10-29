"use client"
import Link from "next/link"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Button } from "@/components/ui/button"

export function RequestedFeedback({
  communityId,
  area,
  initial
}: {
  communityId: number
  area?: string
  initial: RouterOutput["communityReviews"]["requested"]
}) {
  const query = trpc.communityReviews.requested.useQuery(
    { communityId, area },
    { initialData: initial, refetchOnMount: "always" }
  )
  if (query.error) return <p role="alert">{query.error.message}</p>
  if (!query.data.length)
    return (
      <p id="requested-feedback" data-section-target tabIndex={-1}>
        No open feedback requests in this area.
      </p>
    )
  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="requested-feedback"
    >
      <h3
        id="requested-feedback"
        tabIndex={-1}
        data-section-target
        className="text-lg font-semibold"
      >
        Requested feedback
      </h3>
      <p className="text-sm text-muted-foreground">
        Reviews open to community members. Participation is optional.
      </p>
      {query.data.map((review) => (
        <div
          key={review.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
        >
          <div>
            <p className="font-medium">{review.name}</p>
            <p className="text-sm text-muted-foreground">
              {review.reviewed} of {review.total} reviewed
              {review.remaining > 0
                ? ` · ${review.remaining} remaining`
                : " · Complete"}
            </p>
          </div>
          <Button
            asChild
            variant={review.remaining > 0 ? "default" : "outline"}
          >
            <Link href={review.href}>
              {review.remaining === 0
                ? "Open review"
                : review.reviewed
                  ? "Continue review"
                  : "Start review"}
            </Link>
          </Button>
        </div>
      ))}
    </section>
  )
}
