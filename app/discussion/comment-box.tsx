"use client"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Eyebrow } from "@/components/definition"
import { ModelRevisionDisclosure } from "@/components/comments/model-revision-disclosure"
import { useCreateComment } from "@/components/comments/use-create-comment"
import { loginToast } from "@/components/login-toast"
import { trpc } from "@/trpc/client"
import { SparklesIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { COMMENT_MAX_LENGTH } from "@/lib/input-limits"
import { definitionPath } from "@/lib/public-identifiers"

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
 * The server persists the exact suggestion before returning it. Component
 * state keeps only its display and acceptance id, so model attribution cannot
 * be attached to client-altered text.
 */
export const DiscussionCommentBox = ({
  definitionId,
  revisionId,
  termSlug,
  feedsModelRevision = false
}: {
  definitionId: number
  revisionId: number
  termSlug: string
  // True when the definition is AI-authored, where a plain comment is also
  // sent to the model for its next revision — disclosed up front, exactly as
  // on the definition detail page.
  feedsModelRevision?: boolean
}) => {
  const router = useRouter()

  const [comment, setComment] = useState("")
  const [suggestion, setSuggestion] = useState<{
    suggestionId: number
    definition: string
    example: string
    model: string
  } | null>(null)

  const plainComment = useCreateComment({
    definitionId,
    onPosted: () => {
      setComment("")
      setSuggestion(null)
      router.refresh()
    }
  })

  const suggest = trpc.discussion.suggest.useMutation({
    onSuccess: (data) => setSuggestion(data),
    onError: (e) =>
      e.data?.code === "UNAUTHORIZED"
        ? loginToast("suggest a revision")
        : toast.error(e.message)
  })

  const accept = trpc.discussion.acceptSuggestion.useMutation({
    onSuccess: (created) => {
      setComment("")
      setSuggestion(null)
      toast("Published as a new definition.")
      router.push(definitionPath(termSlug, created.definitionNumber))
    },
    onError: (error) =>
      error.data?.code === "UNAUTHORIZED"
        ? loginToast("suggest a revision")
        : toast.error(error.message)
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
          if (!empty) suggest.mutate({ definitionId, revisionId, comment })
        }}
        className="space-y-2"
      >
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="What would you change about this definition?"
          aria-label="Comment"
          disabled={busy}
          maxLength={COMMENT_MAX_LENGTH}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy || empty}>
            <SparklesIcon className="size-3.5" />
            {suggest.isPending ? "Asking the model…" : "Suggest revision"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || empty}
            onClick={() =>
              plainComment.mutate({ id: definitionId, revisionId, comment })
            }
          >
            {plainComment.isPending ? "Posting…" : "Post comment"}
          </Button>
        </div>

        {feedsModelRevision && <ModelRevisionDisclosure />}
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
                  suggestionId: suggestion.suggestionId
                })
              }
            >
              {accept.isPending ? "Publishing…" : "Accept and publish"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                plainComment.mutate({ id: definitionId, revisionId, comment })
              }
            >
              {plainComment.isPending ? "Posting…" : "Post comment instead"}
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
