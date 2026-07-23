"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { trpc } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  CheckIcon,
  Loader2Icon,
  RefreshCwIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UndoIcon
} from "lucide-react"
import { diffWords } from "@/lib/word-diff"
import { toast } from "sonner"
import { COMMENT_MAX_LENGTH } from "@/lib/input-limits"

const DiffText = ({ from, to }: { from: string; to: string }) => (
  <>
    {diffWords(from, to).map((token, i) => (
      <span
        key={i}
        className={
          token.added ? "bg-green-100 dark:bg-green-950 rounded-sm" : undefined
        }
      >
        {token.text}{" "}
      </span>
    ))}
  </>
)

// The interactive refine flow: each round is one element appended to the
// page (not a chat log). Decided rounds collapse to a status line; only the
// standing suggestion offers actions.
export const RefinePanel = ({
  definitionId,
  revisionId,
  current
}: {
  definitionId: number
  revisionId: number
  current: { definition: string; example: string }
}) => {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [comment, setComment] = useState("")

  const rounds = trpc.refinements.list.useQuery(
    { definitionId },
    {
      refetchInterval: (query) =>
        query.state.data?.some((r) => r.status === "pending") ? 2000 : false
    }
  )

  const invalidate = () => utils.refinements.list.invalidate({ definitionId })
  const onError = (err: { message: string }) => toast.error(err.message)

  const request = trpc.refinements.request.useMutation({
    onSuccess: () => {
      setComment("")
      invalidate()
    },
    onError
  })
  const accept = trpc.refinements.accept.useMutation({
    onSuccess: (refined) => {
      invalidate()
      router.push(`/definition/${refined.id}`)
    },
    onError
  })
  const keep = trpc.refinements.keep.useMutation({
    onSuccess: invalidate,
    onError
  })
  const retry = trpc.refinements.retry.useMutation({
    onSuccess: invalidate,
    onError
  })

  if (!rounds.data) return null

  const open = rounds.data.find(
    (r) => r.status === "pending" || r.status === "suggested"
  )
  const busy =
    request.isPending || accept.isPending || keep.isPending || retry.isPending

  return (
    <section className="space-y-2">
      <h2 className="text-xl font-medium flex items-center gap-2">
        <SparklesIcon className="size-5 text-ai" />
        AI Refinement
      </h2>

      {rounds.data.map((round) => {
        if (round.status === "pending")
          return (
            <Card key={round.id} className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Round {round.round} in progress. The model is generating a
                suggestion, which can take up to half a minute.
              </div>
            </Card>
          )

        if (round.status === "failed")
          return (
            <Card key={round.id} className="p-4 border-destructive">
              <div className="flex items-center gap-2 text-destructive">
                <TriangleAlertIcon className="size-4" />
                Round {round.round} failed: {round.errorMessage}
              </div>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => retry.mutate({ refinementId: round.id })}
                >
                  <RefreshCwIcon className="size-4 mr-1" /> Retry
                </Button>
              </div>
            </Card>
          )

        if (round.status === "suggested")
          return (
            <Card key={round.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Suggested revision (round {round.round})
                  <Badge variant="secondary">{round.model}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div>
                  <span className="italic">Definition: </span>
                  <DiffText
                    from={current.definition}
                    to={round.suggestedDefinition ?? ""}
                  />
                </div>
                <div>
                  <span className="italic">Example: </span>
                  <DiffText
                    from={current.example}
                    to={round.suggestedExample ?? ""}
                  />
                </div>
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-2">
                <div className="flex gap-2">
                  <Button
                    disabled={busy}
                    onClick={() => accept.mutate({ refinementId: round.id })}
                  >
                    <CheckIcon className="size-4 mr-1" /> Accept suggestion
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => keep.mutate({ refinementId: round.id })}
                  >
                    <UndoIcon className="size-4 mr-1" /> Keep mine
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Not quite right? Say what should change and ask for a re-evaluation."
                    className="min-h-9"
                    maxLength={COMMENT_MAX_LENGTH}
                  />
                  <Button
                    variant="secondary"
                    disabled={busy || !comment.trim()}
                    onClick={() =>
                      request.mutate({
                        definitionId,
                        expectedRevisionId: revisionId,
                        comment: comment.trim()
                      })
                    }
                  >
                    Re-evaluate
                  </Button>
                </div>
              </CardFooter>
            </Card>
          )

        // decided rounds collapse to a status line, expandable for the record
        const label =
          round.status === "accepted"
            ? `You accepted the round ${round.round} suggestion`
            : round.status === "kept"
              ? `You kept your original after round ${round.round}`
              : `Round ${round.round} was replaced after your feedback`

        return (
          <details key={round.id} className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">
              {label}
              {round.userComment ? ` (feedback: "${round.userComment}")` : ""}
            </summary>
            <div className="pl-4 pt-1 space-y-1">
              <div>
                <span className="italic">Suggested definition: </span>
                {round.suggestedDefinition}
              </div>
              <div>
                <span className="italic">Suggested example: </span>
                {round.suggestedExample}
              </div>
            </div>
          </details>
        )
      })}

      {rounds.data.some((r) => r.status === "accepted") && (
        <div className="text-sm">
          <CheckIcon className="size-4 inline mr-1 text-green-600" />
          Suggestion accepted. The refined definition is published alongside
          this one.
        </div>
      )}

      {!open && (
        <Button
          variant={rounds.data.length ? "outline" : "default"}
          disabled={busy}
          onClick={() =>
            request.mutate({ definitionId, expectedRevisionId: revisionId })
          }
        >
          <SparklesIcon className="size-4 mr-1" />
          {rounds.data.length ? "Refine again" : "Refine with AI"}
        </Button>
      )}
    </section>
  )
}
