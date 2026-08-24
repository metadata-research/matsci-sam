"use client"

import { loginToast } from "@/components/login-toast"
import { trpc } from "@/trpc/client"
import { toast } from "sonner"

/*
 * The single client path for posting a comment, shared by every surface that
 * offers one (the definition detail page and the discussion page). Whatever
 * the entry point, posting behaves identically: the same success and error
 * messages, the same login prompt, and the same comment-list refresh. Posting
 * a comment never requests or publishes model output; AI-assisted revision is
 * an explicit contribution path of its own.
 */
export const useCreateComment = ({
  definitionId,
  surveyStepId,
  expectedInstructions,
  onPosted
}: {
  definitionId: number
  // The review step of a walkthrough the comment is posted inside. Sent with
  // every comment posted through this hook, so the surfaces keep calling
  // mutate with the comment alone.
  surveyStepId?: number
  expectedInstructions?: string | null
  // Surface-specific cleanup: reset the form, refresh the route, etc.
  onPosted?: () => void
}) => {
  const utils = trpc.useUtils()

  const mutation = trpc.comments.create.useMutation({
    onSuccess: () => {
      utils.comments.get.refetch(definitionId)
      // The comment count on a definition card comes from definitions.list,
      // so a surface that shows the card above the box reads it again.
      utils.definitions.list.invalidate()
      toast("Comment posted.")
      onPosted?.()
    },
    onError: (error) => {
      if (error.data?.code === "UNAUTHORIZED") loginToast("comment")
      else toast.error(error.message)
    }
  })

  return {
    ...mutation,
    mutate: (
      input: Omit<
        Parameters<typeof mutation.mutate>[0],
        "surveyStepId" | "expectedInstructions"
      >
    ) => mutation.mutate({ ...input, surveyStepId, expectedInstructions })
  }
}
