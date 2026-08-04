"use client"

import { loginToast } from "@/components/login-toast"
import { trpc } from "@/trpc/client"
import { SparklesIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

// Give up watching for a model revision after this long; matches the
// server-side generation timeout in terms.aiGeneration.
const WATCH_TIMEOUT_MS = 5 * 60 * 1000

/*
 * The single client path for posting a comment, shared by every surface that
 * offers one (the definition detail page and the discussion page). Whatever
 * the entry point, posting behaves identically: the same success and error
 * messages, the same login prompt, the same comment-list refresh — and when
 * the server reports that the comment scheduled a model revision (comments on
 * the current revision of an AI-authored definition do), the toast says so,
 * then the hook watches the definition's current version and announces the
 * revision when it lands instead of letting it replace the text silently.
 */
export const useCreateComment = ({
  definitionId,
  onPosted
}: {
  definitionId: number
  // Surface-specific cleanup: reset the form, refresh the route, etc.
  onPosted?: () => void
}) => {
  const router = useRouter()
  const utils = trpc.useUtils()

  // Armed after a comment schedules a model revision: the version the
  // comment was made against, and when the watch started.
  const [watch, setWatch] = useState<{
    sinceVersion: number
    startedAt: number
  } | null>(null)

  const { data: current } = trpc.definitions.currentVersion.useQuery(
    definitionId,
    { enabled: watch !== null, refetchInterval: watch ? 4000 : false }
  )

  const announced = useRef(false)
  useEffect(() => {
    if (!watch) return

    if (
      current?.version != null &&
      current.version > watch.sinceVersion &&
      !announced.current
    ) {
      announced.current = true
      setWatch(null)
      toast("The model revised this definition in response to feedback.", {
        icon: <SparklesIcon className="size-4 text-ai" />,
        action: {
          label: "Show",
          onClick: () => router.refresh()
        }
      })
      utils.comments.get.refetch(definitionId)
      return
    }

    // The version may simply never change, so the timeout needs its own
    // timer rather than piggybacking on poll-result changes.
    const remaining = watch.startedAt + WATCH_TIMEOUT_MS - Date.now()
    const timer = setTimeout(() => {
      setWatch(null)
      toast("The model has not produced a revision yet.", {
        description: "It may still arrive; refresh the page later to check."
      })
    }, Math.max(remaining, 0))
    return () => clearTimeout(timer)
  }, [watch, current?.version, definitionId, router, utils])

  const mutation = trpc.comments.create.useMutation({
    onSuccess: (created) => {
      utils.comments.get.refetch(definitionId)
      if (created.aiRevisionScheduled) {
        toast(
          "Comment posted — the model will revise this definition in response.",
          { icon: <SparklesIcon className="size-4 text-ai" /> }
        )
        if (created.commentedVersion != null) {
          announced.current = false
          setWatch({
            sinceVersion: created.commentedVersion,
            startedAt: Date.now()
          })
        }
      } else {
        toast("Comment posted.")
      }
      onPosted?.()
    },
    onError: (error) => {
      if (error.data?.code === "UNAUTHORIZED") loginToast("comment")
      else toast.error(error.message)
    }
  })

  return mutation
}
