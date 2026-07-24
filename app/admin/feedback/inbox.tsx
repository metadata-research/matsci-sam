"use client"

import Link from "next/link"
import {
  CheckIcon,
  ExternalLinkIcon,
  MessageSquareTextIcon,
  RotateCcwIcon
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/date"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import styles from "../admin.module.css"

type FeedbackFilter = "open" | "resolved" | "all"
type FeedbackPage = RouterOutput["admin"]["feedbackInbox"]
type FeedbackItem = FeedbackPage["items"][number]

export function FeedbackInbox({
  status,
  initialPage
}: {
  status: FeedbackFilter
  initialPage: FeedbackPage
}) {
  const utils = trpc.useUtils()
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    refetch
  } = trpc.admin.feedbackInbox.useInfiniteQuery(
    { status, limit: 25 },
    {
      initialData: {
        pages: [initialPage],
        pageParams: [undefined]
      },
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      retry: 1
    }
  )
  const feedback = data.pages.flatMap((page) => page.items)
  const update = trpc.admin.setFeedbackStatus.useMutation({
    onSuccess: async (_, variables) => {
      await utils.admin.feedbackInbox.invalidate()
      toast.success(
        variables.status === "resolved"
          ? "Feedback marked resolved"
          : "Feedback reopened"
      )
    },
    onError: (mutationError) => toast.error(mutationError.message)
  })

  return (
    <section className={styles.panel} aria-labelledby="feedback-inbox-heading">
      <div className={styles.panelHeader}>
        <h2 id="feedback-inbox-heading" className={styles.panelTitle}>
          <MessageSquareTextIcon aria-hidden />
          {status === "open"
            ? "Open feedback"
            : status === "resolved"
              ? "Resolved feedback"
              : "All feedback"}
        </h2>
        <span className={styles.panelMeta} aria-live="polite">
          {feedback.length} {feedback.length === 1 ? "comment" : "comments"}
          {hasNextPage ? " loaded" : ""}
        </span>
      </div>

      {error && (
        <div className={styles.queryNotice} role="alert">
          <span>
            The feedback inbox could not be refreshed. The last loaded data is
            still shown.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? "Retrying" : "Retry"}
          </Button>
        </div>
      )}

      {feedback.length ? (
        <ul className={styles.feedbackList}>
          {feedback.map((item) => (
            <FeedbackRow
              key={item.id}
              item={item}
              pending={
                update.isPending && update.variables?.feedbackId === item.id
              }
              onStatusChange={(nextStatus) =>
                update.mutate({ feedbackId: item.id, status: nextStatus })
              }
            />
          ))}
        </ul>
      ) : (
        <div className={styles.emptyState}>
          <div>
            <MessageSquareTextIcon aria-hidden />
            <h2>
              {status === "open"
                ? "No feedback is waiting"
                : status === "resolved"
                  ? "No feedback has been resolved"
                  : "No feedback has been submitted"}
            </h2>
            <p>
              {status === "open"
                ? "New page-specific comments will appear here."
                : status === "resolved"
                  ? "Resolved comments will remain available here."
                  : "Visitor and contributor comments will appear here after they are submitted."}
            </p>
          </div>
        </div>
      )}

      {hasNextPage ? (
        <div className={styles.panelFooter}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? "Loading" : "Load more"}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function FeedbackRow({
  item,
  pending,
  onStatusChange
}: {
  item: FeedbackItem
  pending: boolean
  onStatusChange: (status: "open" | "resolved") => void
}) {
  const reporterName =
    item.author?.name?.trim() ||
    (item.userId ? "Signed-in contributor" : "Anonymous")
  const resolving = item.status === "open"
  const nextStatus = resolving ? "resolved" : "open"

  return (
    <li className={styles.feedbackItem}>
      <div className={styles.feedbackItemHeader}>
        <div className={styles.feedbackIdentity}>
          <span>{reporterName}</span>
          {item.status === "resolved" && item.resolvedAt ? (
            <span className={styles.feedbackResolution}>
              Resolved by {item.resolver?.name?.trim() || "an administrator"} on{" "}
              {formatDateTime(item.resolvedAt)}
            </span>
          ) : null}
        </div>
        <div className={styles.feedbackActions}>
          <Badge
            variant="outline"
            className={
              item.status === "open"
                ? "border-primary/35 text-primary"
                : "text-muted-foreground"
            }
          >
            {item.status === "open" ? "Open" : "Resolved"}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onStatusChange(nextStatus)}
          >
            {resolving ? (
              <CheckIcon aria-hidden />
            ) : (
              <RotateCcwIcon aria-hidden />
            )}
            {pending ? "Updating" : resolving ? "Mark resolved" : "Reopen"}
          </Button>
        </div>
      </div>

      <p className={styles.feedbackMessage}>{item.message}</p>

      <div className={styles.feedbackMeta}>
        <Link
          href={item.pagePath}
          target="_blank"
          rel="noreferrer"
          className={styles.feedbackPath}
          aria-label={`Open ${item.pagePath} in a new tab`}
        >
          {item.pagePath}
          <ExternalLinkIcon aria-hidden />
        </Link>
        <time
          dateTime={item.createdAt}
          className={styles.feedbackDate}
          title={item.createdAt}
        >
          {formatDateTime(item.createdAt)}
        </time>
      </div>
    </li>
  )
}
