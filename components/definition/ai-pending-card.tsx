"use client"

import { trpc } from "@/trpc/client"
import { SparklesIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useRef } from "react"
import { toast } from "sonner"

/*
 * Shows the automatic alternate definition arriving instead of letting it
 * appear silently on the next full reload. While the model is drafting, the
 * term page carries a placeholder card that polls terms.aiGeneration; when
 * the status flips to ready the definition list refetches, the card gives
 * way to the real definition, and a toast announces it. Past the server-side
 * timeout the card reports failure honestly rather than shimmering forever
 * (an admin can retry the generation).
 */
export const AiPendingCard = ({ termId }: { termId: number }) => {
  const utils = trpc.useUtils()

  const { data } = trpc.terms.aiGeneration.useQuery(termId, {
    refetchInterval: (query) =>
      query.state.data?.status === "generating" ? 4000 : false
  })

  // Announce only the generating -> ready transition this viewer witnessed,
  // not a definition that was already there when the page loaded.
  const previousStatus = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (previousStatus.current === "generating" && data?.status === "ready") {
      toast("The AI definition has been published.", {
        icon: <SparklesIcon className="size-4 text-ai" />
      })
      utils.definitions.list.refetch({ termId })
    }
    previousStatus.current = data?.status
  }, [data?.status, termId, utils])

  if (data?.status === "generating")
    return (
      <div className="rounded-lg border border-ai/30 bg-ai/5 p-4">
        <span className="flex items-center gap-1.5 text-ai text-xs font-semibold uppercase tracking-[0.12em]">
          <SparklesIcon aria-hidden className="size-3.5 animate-pulse" />
          The model is generating an alternate definition
        </span>
        <div aria-hidden className="mt-3 space-y-2">
          <div className="h-3 w-4/5 animate-pulse rounded bg-ai/15" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-ai/15" />
        </div>
      </div>
    )

  if (data?.status === "failed")
    return (
      <div className="rounded-lg border border-muted bg-muted/30 p-4">
        <span className="flex items-center gap-1.5 text-muted-foreground text-xs font-semibold uppercase tracking-[0.12em]">
          <TriangleAlertIcon aria-hidden className="size-3.5" />
          The model did not produce an alternate definition
        </span>
      </div>
    )

  return null
}
