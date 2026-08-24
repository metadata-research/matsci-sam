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
