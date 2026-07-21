"use client"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Eyebrow } from "@/components/definition"
import { trpc } from "@/trpc/client"
import { SparklesIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

/*
 * Discussion comment box offering two distinct actions on the same text:
 *
 *   Suggest revision -> sends the comment to the model, which proposes a
 *                       revised definition. The author reviews it and either
 *                       publishes it as a new definition of the term (credited
 *                       to them, model as coauthor) or backs out.
 *   Comment          -> posts it as an ordinary comment. On an AI-authored
 *                       definition the existing comments.create path still
 *                       feeds the model its own revision.
 *
 * The suggestion lives in component state until accepted, so an abandoned
 * proposal leaves nothing behind.
 */
export const DiscussionCommentBox = ({
  definitionId
}: {
  definitionId: number
}) => {
  const router = useRouter()
  const utils = trpc.useUtils()

  const [comment, setComment] = useState("")
  const [suggestion, setSuggestion] = useState<{
    definition: string
    example: string
    model: string
  } | null>(null)

  const loginToast = () =>
    toast("You must be logged in to take part!", {
      action: (
        <Link href="/api/login" className="ml-auto">
          <Button>Login</Button>
        </Link>
      ),
      position: "top-center"
    })

  const plainComment = trpc.comments.create.useMutation({
    onSuccess: () => {
      setComment("")
      setSuggestion(null)
      utils.comments.get.refetch(definitionId)
      toast("Comment posted.")
      router.refresh()
    },
    onError: loginToast
  })

  const suggest = trpc.discussion.suggest.useMutation({
    onSuccess: (data) => setSuggestion(data),
    onError: (e) =>
      e.data?.code === "UNAUTHORIZED"
        ? loginToast()
        : toast("The model could not produce a revision. Try again.")
  })

  const accept = trpc.discussion.acceptSuggestion.useMutation({
    onSuccess: (created) => {
      setComment("")
      setSuggestion(null)
      toast("Published as a new definition.")
      router.push(`/definition/${created.id}`)
    },
    onError: loginToast
  })

  const busy = suggest.isPending || accept.isPending || plainComment.isPending
  const empty = !comment.trim()

  return (
    <div className="space-y-2">
      {/* Submitting the form runs the suggested-revision path, the encouraged
          action; Comment is an explicit alternative. */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!empty) suggest.mutate({ definitionId, comment })
        }}
        className="space-y-2"
      >
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="What would you change about this definition?"
          aria-label="Your comment"
          disabled={busy}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy || empty}>
            <SparklesIcon className="size-3.5" />
            {suggest.isPending ? "Asking the model..." : "Suggest revision"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || empty}
            onClick={() => plainComment.mutate({ id: definitionId, comment })}
          >
            {plainComment.isPending ? "Posting..." : "Comment"}
          </Button>
        </div>
      </form>

      {suggestion && (
        <div className="rounded-lg border border-ai/30 bg-ai/5 p-3 space-y-3">
          <span className="flex items-center gap-1 text-ai text-xs font-semibold uppercase tracking-[0.12em]">
            <SparklesIcon className="size-3.5" />
            Suggested revision
            <span aria-hidden className="text-ai/50">
              &middot;
            </span>
            <span className="font-mono normal-case tracking-normal">
              {suggestion.model}
            </span>
          </span>

          <div>
            <Eyebrow>Definition</Eyebrow>
            <p className="text-sm">{suggestion.definition}</p>
          </div>
          <div>
            <Eyebrow>Example</Eyebrow>
            <p className="text-sm text-muted-foreground">
              {suggestion.example}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                accept.mutate({
                  definitionId,
                  comment,
                  definition: suggestion.definition,
                  example: suggestion.example
                })
              }
            >
              {accept.isPending ? "Publishing..." : "Accept and publish"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => plainComment.mutate({ id: definitionId, comment })}
            >
              Just comment instead
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setSuggestion(null)}
            >
              Discard
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Accepting publishes this as a new definition of the term, credited
            to you with {suggestion.model} as coauthor, and records your comment
            alongside it.
          </p>
        </div>
      )}
    </div>
  )
}
