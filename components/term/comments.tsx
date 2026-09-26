"use client"

import {
  ArrowDownIcon,
  ArrowUpIcon,
  MessageSquareIcon,
  UserIcon
} from "lucide-react"
import { Button } from "../ui/button"
import { trpc } from "@/trpc/client"
import { Skeleton } from "../ui/skeleton"
import { Card, CardContent } from "../ui/card"
import { formatDate, formatDateTime } from "@/lib/date"
import { PublicProfileName } from "../public-profile-name"
import { usePresentedView } from "../interface-view"

interface Props {
  id: number
  definitionNumber: number
  // The revision on screen. Simple marks a comment about another revision.
  displayedVersion?: number
  // True where no comment box follows the list, so the empty state does not
  // point at one.
  readOnly?: boolean
}

export const TermVotesFallback = () => {
  return (
    <div className="flex flex-col items-center">
      <Button variant="ghost" disabled>
        <ArrowUpIcon />
      </Button>
      <Skeleton className="w-6 h-4" />
      <Button variant="ghost" disabled>
        <ArrowDownIcon />
      </Button>
    </div>
  )
}

export const TermComments = ({
  id,
  definitionNumber,
  displayedVersion,
  readOnly = false
}: Props) => {
  const [comments] = trpc.comments.get.useSuspenseQuery(id)
  const advanced = usePresentedView() === "advanced"

  if (comments.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed bg-card/50 px-4 py-5 text-sm text-muted-foreground">
        <MessageSquareIcon className="size-4 shrink-0" aria-hidden />
        {readOnly
          ? "No comments."
          : "No comments yet. Be the first to comment below."}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {comments.map((comment) => (
        <Card key={comment.id} className="gap-3 py-4 shadow-none">
          <CardContent className="space-y-3 px-4 sm:px-5">
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <UserIcon
                  className="size-3.5 text-muted-foreground"
                  aria-hidden
                />
                <PublicProfileName user={comment.author} />
              </span>
              <span aria-hidden className="text-muted-foreground/50">
                &middot;
              </span>
              <time className="text-xs text-muted-foreground">
                {advanced
                  ? formatDateTime(comment.createdAt)
                  : formatDate(comment.createdAt)}
              </time>
              {advanced ? (
                <span className="rounded-full border px-2 py-0.5 text-[0.68rem] text-muted-foreground">
                  Definition {definitionNumber} · revision {comment.version}
                  {comment.authorKind !== "human"
                    ? ` · ${comment.authorKind}`
                    : ""}
                  {comment.migratedLegacy ? " · imported" : ""}
                </span>
              ) : comment.authorKind !== "human" ||
                (displayedVersion !== undefined &&
                  comment.version !== displayedVersion) ? (
                // Simple keeps what attributes a comment: a writer that is not a
                // person, or wording other than the revision on screen.
                <span className="rounded-full border px-2 py-0.5 text-[0.68rem] text-muted-foreground">
                  {[
                    comment.version !== displayedVersion
                      ? `revision ${comment.version}`
                      : null,
                    comment.authorKind !== "human" ? comment.authorKind : null
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
            </header>
            <p className="leading-7">{comment.message}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
