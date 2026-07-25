import Link from "next/link"
import { trpc } from "@/trpc/server"
import { AdminPageHeader } from "../page-header"
import { FeedbackInbox } from "./inbox"
import styles from "../admin.module.css"

const FILTERS = ["open", "resolved", "all"] as const
type FeedbackFilter = (typeof FILTERS)[number]

const isFeedbackFilter = (value: string | undefined): value is FeedbackFilter =>
  FILTERS.some((filter) => filter === value)

export default async function AdminFeedbackPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status: requestedStatus } = await searchParams
  const status = isFeedbackFilter(requestedStatus) ? requestedStatus : "open"
  const feedback = await trpc.admin.feedbackInbox({ status, limit: 25 })

  return (
    <>
      <AdminPageHeader
        title="Feedback"
        description="Review page-specific comments from visitors and contributors."
      />
      <nav className={styles.subnavigation} aria-label="Feedback status">
        {FILTERS.map((filter) => (
          <Link
            key={filter}
            href={
              filter === "open"
                ? "/admin/feedback"
                : `/admin/feedback?status=${filter}`
            }
            data-active={status === filter}
            aria-current={status === filter ? "page" : undefined}
          >
            {filter[0].toUpperCase() + filter.slice(1)}
          </Link>
        ))}
      </nav>
      <div className="mt-5">
        <FeedbackInbox status={status} initialPage={feedback} />
      </div>
    </>
  )
}
