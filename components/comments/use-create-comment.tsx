"use client"

import { Button } from "@/components/ui/button"
import { trpc } from "@/trpc/client"
import Link from "next/link"
import { toast } from "sonner"

/*
 * The single client path for posting a comment, shared by every surface that
 * offers one (the definition detail page and the discussion page). Whatever
 * the entry point, posting behaves identically: the same success and error
 * messages, the same login prompt, the same comment-list refresh — and when
 * the server reports that the comment scheduled a model revision (comments on
 * the current revision of an AI-authored definition do), the toast says so
 * instead of leaving the trigger invisible.
 */
export const useCreateComment = ({
  definitionId,
  onPosted
}: {
  definitionId: number
  // Surface-specific cleanup: reset the form, refresh the route, etc.
  onPosted?: () => void
}) => {
  const utils = trpc.useUtils()

  return trpc.comments.create.useMutation({
    onSuccess: (created) => {
      utils.comments.get.refetch(definitionId)
      if (created.aiRevisionScheduled) {
        toast("Comment posted — the model will revise this definition in response.")
      } else {
        toast("Comment posted.")
      }
      onPosted?.()
    },
    onError: (error) => {
      if (error.data?.code !== "UNAUTHORIZED") {
        toast.error(error.message)
        return
      }
      toast("You must be logged in to comment!", {
        action: (
          <Button asChild>
            <Link href="/login" className="ml-auto">
              Login
            </Link>
          </Button>
        ),
        position: "top-center"
      })
    }
  })
}
