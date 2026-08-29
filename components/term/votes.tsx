"use client"

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"
import { Button } from "../ui/button"
import { Card } from "../ui/card"
import { cn } from "@/lib/utils"
import { trpc } from "@/trpc/client"
import { toast } from "sonner"
import { loginToast } from "@/components/login-toast"
import { useEffect, useRef } from "react"
import {
  type MutationActivityCallbacks,
  useMutationActivity
} from "@/components/use-mutation-activity"

interface Props extends MutationActivityCallbacks {
  definitionId: number
  revisionId: number
  initial: {
    score: number
    vote: "up" | "down" | null
  }
  readOnly?: boolean
  disabled?: boolean
  // Why the buttons are disabled, shown on hover. The default names the
  // one reason the definition pages have.
  readOnlyTitle?: string
  // Fired whenever this definition's score changes, so a parent list can
  // re-sort. Optional; most callers do not reorder.
  onScoreChange?: (score: number) => void
  // The review step of a walkthrough the vote is cast inside, passed through
  // to votes.vote, which checks it against the act.
  surveyStepId?: number
  expectedInstructions?: string | null
}

// Read-only support context for surfaces where voting is not the task. It
// deliberately has no arrow-shaped controls, so a Position step cannot look
// like a broken voting surface while still showing community support and the
// viewer's existing vote.
export const TermVoteSummary = ({
  score,
  vote
}: {
  score: number
  vote: "up" | "down" | null
}) => {
  const personalVote =
    vote === "up" ? "Your upvote" : vote === "down" ? "Your downvote" : null

  return (
    <Card
      aria-label={`Support score ${score}${personalVote ? `. ${personalVote}` : ""}`}
      className="h-min min-w-16 items-center gap-0.5 bg-muted/30 px-2 py-3 text-center"
    >
      <span className="text-lg font-bold leading-none">{score}</span>
      <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
        Support
      </span>
      {personalVote && (
        <span
          className={cn(
            "mt-1 text-[0.65rem] font-medium",
            vote === "up" ? "text-primary" : "text-destructive"
          )}
        >
          {personalVote}
        </span>
      )}
    </Card>
  )
}

export const TermVotes = ({
  definitionId,
  revisionId,
  initial,
  readOnly = false,
  disabled = false,
  readOnlyTitle = "Earlier revisions are read-only",
  onScoreChange,
  surveyStepId,
  expectedInstructions,
  onMutationStart,
  onMutationEnd
}: Props) => {
  const { data, refetch } = trpc.votes.get.useQuery(
    { definitionId, revisionId },
    { initialData: initial }
  )

  // Report score changes up without re-subscribing the effect on every render:
  // the callback lives in a ref, the effect depends only on the score.
  //
  // votes.get computes score as SUM(...), a bigint the driver returns as a
  // string (and null when a definition has no votes), so coerce it. null means
  // no votes, which the display renders as 0 -- match that for sorting.
  const cbRef = useRef(onScoreChange)
  useEffect(() => {
    cbRef.current = onScoreChange
  }, [onScoreChange])
  useEffect(() => {
    cbRef.current?.(data?.score == null ? 0 : Number(data.score))
  }, [data?.score])

  const activity = useMutationActivity({ onMutationStart, onMutationEnd })
  const { isPending, mutate } = trpc.votes.vote.useMutation({
    onSuccess: () => refetch(),
    onError: (error) => {
      if (error.data?.code === "UNAUTHORIZED") loginToast("vote")
      else toast.error(error.message)
    },
    onSettled: activity.end
  })

  return (
    // Keep clicks inside the vote rail from reaching a surrounding link in
    // legacy or embedded uses of this control.
    <Card
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="flex flex-col items-center !p-1 !gap-1 h-min rounded-full"
    >
      <Button
        aria-label="Upvote definition"
        className={cn(
          "rounded-t-full !px-2 !pb-1",
          data?.vote === "up" ? "text-primary" : ""
        )}
        disabled={activity.busy || isPending || readOnly || disabled}
        onClick={(e) => {
          e.preventDefault()
          activity.start()
          mutate({
            vote: "up",
            definitionId,
            revisionId,
            surveyStepId,
            expectedInstructions
          })
        }}
        title={readOnly ? readOnlyTitle : undefined}
        variant="ghost"
      >
        <ArrowUpIcon />
      </Button>
      <span className="font-bold">{data?.score || 0}</span>
      <Button
        aria-label="Downvote definition"
        className={cn(
          "rounded-b-full !px-2 !pt-1",
          data?.vote === "down" ? "text-primary" : ""
        )}
        disabled={activity.busy || isPending || readOnly || disabled}
        onClick={(e) => {
          e.preventDefault()
          activity.start()
          mutate({
            vote: "down",
            definitionId,
            revisionId,
            surveyStepId,
            expectedInstructions
          })
        }}
        title={readOnly ? readOnlyTitle : undefined}
        variant="ghost"
      >
        <ArrowDownIcon />
      </Button>
    </Card>
  )
}
