"use client"

import { type ReactNode, useState } from "react"
import { useRouter } from "next/navigation"
import { CircleAlertIcon, SendIcon, SparklesIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { loginToast } from "@/components/login-toast"
import { COMMENT_MAX_LENGTH, DEFINITION_MAX_LENGTH } from "@/lib/input-limits"
import { definitionPath } from "@/lib/public-identifiers"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import {
  type MutationActivityCallbacks,
  useMutationActivity
} from "@/components/use-mutation-activity"

type PublishedDefinition = RouterOutput["definitions"]["create"]

/**
 * The one canonical AI-assisted revision action. A contributor first states
 * what is wrong, then reviews and may edit the model's draft. The feedback is
 * revision provenance, not a public comment; publishing creates a separately
 * voteable candidate derived from the exact source revision.
 */
export function RevisionSuggestionForm({
  term,
  definitionId,
  sourceRevisionId,
  surveyStepId,
  expectedInstructions,
  renderInitialActions,
  onPublished,
  onBusyChange,
  onMutationStart,
  onMutationEnd
}: {
  term: string
  definitionId: number
  sourceRevisionId: number
  surveyStepId?: number
  expectedInstructions?: string | null
  // Context-specific alternatives while no model draft exists. Once a draft
  // exists, the form replaces them with publishing and discard actions.
  renderInitialActions?: (disabled: boolean) => ReactNode
  onPublished?: (published: PublishedDefinition) => void
  onBusyChange?: (busy: boolean) => void
} & MutationActivityCallbacks) {
  const router = useRouter()
  const activity = useMutationActivity({
    onBusyChange,
    onMutationStart,
    onMutationEnd
  })
  const [feedback, setFeedback] = useState("")
  const [draft, setDraft] = useState<{
    suggestionId: number
    definition: string
    model: string
  } | null>(null)

  const discard = trpc.aiAssist.discard.useMutation({
    onSuccess: () => setDraft(null),
    onSettled: activity.end
  })
  const suggest = trpc.aiAssist.suggestRevision.useMutation({
    onSuccess: setDraft,
    onError: (error) => {
      if (error.data?.code === "UNAUTHORIZED") loginToast("suggest a revision")
    },
    onSettled: activity.end
  })
  const publish = trpc.definitions.create.useMutation({
    onSuccess: (published) => {
      if (onPublished) {
        onPublished(published)
        return
      }
      router.push(
        definitionPath(
          published.term.slug,
          published.definition.definitionNumber,
          published.term.vocabularySlug
        )
      )
    },
    onError: (error) => {
      if (error.data?.code === "UNAUTHORIZED")
        loginToast("publish a suggested revision")
    },
    onSettled: activity.end
  })

  const busy =
    activity.busy || suggest.isPending || publish.isPending || discard.isPending
  const critique = feedback.trim()
  const revisedDefinition = draft?.definition.trim() ?? ""
  const error = suggest.error ?? publish.error ?? discard.error

  const clearDraft = () => {
    if (!draft || discard.isPending) return
    activity.start()
    discard.mutate({ suggestionId: draft.suggestionId })
  }

  return (
    <Card className="py-0">
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 font-medium text-ai">
            <SparklesIcon className="size-4" aria-hidden />
            Suggest a revision
          </p>
          <p className="text-sm text-muted-foreground">
            Explain what is wrong or missing, then prompt the configured
            language model for an editable revision draft. Nothing is published
            until you review and submit it.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor={"revision-feedback-" + definitionId}
            className="font-medium"
          >
            What should change?
          </label>
          <Textarea
            id={"revision-feedback-" + definitionId}
            value={feedback}
            maxLength={COMMENT_MAX_LENGTH}
            className="min-h-24"
            placeholder="Name the error, ambiguity, or missing distinction."
            disabled={busy || draft !== null}
            onChange={(event) => setFeedback(event.target.value)}
          />
        </div>

        {draft ? (
          <>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor={"revision-draft-" + definitionId}
                  className="font-medium"
                >
                  Revision draft
                </label>
                <span className="text-xs text-muted-foreground">
                  Drafted by <span className="font-mono">{draft.model}</span>
                </span>
              </div>
              <Textarea
                id={"revision-draft-" + definitionId}
                value={draft.definition}
                maxLength={DEFINITION_MAX_LENGTH}
                className="min-h-28"
                disabled={busy}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, definition: event.target.value }
                      : current
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                Publishing adds this revision as another definition. The
                original remains available for comparison and voting, and the
                language model is credited.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || !revisedDefinition}
                onClick={() => {
                  activity.start()
                  publish.mutate({
                    term,
                    definition: revisedDefinition,
                    surveyStepId,
                    expectedInstructions,
                    derivedFromRevisionId: sourceRevisionId,
                    aiSuggestionId: draft.suggestionId
                  })
                }}
              >
                <SendIcon aria-hidden />
                {publish.isPending ? "Publishing…" : "Publish revision"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={clearDraft}
              >
                <XIcon aria-hidden />
                Discard draft
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || !critique}
              onClick={() => {
                activity.start()
                suggest.mutate({
                  definitionId,
                  sourceRevisionId,
                  feedback: critique
                })
              }}
            >
              <SparklesIcon aria-hidden />
              {suggest.isPending
                ? "Drafting…"
                : "Draft revision with a language model"}
            </Button>
            {renderInitialActions?.(busy)}
          </div>
        )}

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            <CircleAlertIcon
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden
            />
            <span>{error.message}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
