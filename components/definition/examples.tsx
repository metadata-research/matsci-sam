"use client"

import { useState } from "react"
import { PlusIcon, SparklesIcon, StarIcon, UserIcon } from "lucide-react"
import { trpc } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { PublicProfileName } from "@/components/public-profile-name"
import { loginToast } from "@/components/login-toast"
import { formatDate } from "@/lib/date"
import { EXAMPLE_MAX_LENGTH } from "@/lib/input-limits"
import { cn } from "@/lib/utils"

type Feedback = {
  kind: "success" | "error"
  message: string
}

export function DefinitionExamples({
  definitionId,
  sourceRevisionId
}: {
  definitionId: number
  sourceRevisionId: number
}) {
  const [{ items, canFeature }] = trpc.examples.list.useSuspenseQuery({
    definitionId
  })
  const utils = trpc.useUtils()
  const [text, setText] = useState("")
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const reportError = (error: {
    message: string
    data?: { code?: string } | null
  }) => {
    if (error.data?.code === "UNAUTHORIZED") {
      loginToast("add or feature an example")
      setFeedback({
        kind: "error",
        message: "Log in to add or feature an example."
      })
      return
    }

    setFeedback({ kind: "error", message: error.message })
  }

  const create = trpc.examples.create.useMutation({
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      setText("")
      await Promise.all([
        utils.examples.list.invalidate({ definitionId }),
        utils.definitions.get.invalidate({ definitionId }),
        utils.definitions.list.invalidate()
      ])
      setFeedback({ kind: "success", message: "Example added." })
    },
    onError: reportError
  })

  const feature = trpc.examples.setFeatured.useMutation({
    onMutate: () => setFeedback(null),
    onSuccess: async () => {
      await Promise.all([
        utils.examples.list.invalidate({ definitionId }),
        utils.definitions.get.invalidate({ definitionId }),
        utils.definitions.list.invalidate()
      ])
      setFeedback({
        kind: "success",
        message: "Featured example updated."
      })
    },
    onError: reportError
  })

  const trimmed = text.trim()

  return (
    <section aria-labelledby="examples-heading" className="space-y-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="examples-heading" className="text-lg font-semibold">
            Examples of use
          </h2>
          {items.length > 0 ? (
            <Badge variant="outline">
              {items.length} {items.length === 1 ? "example" : "examples"}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Examples are contributed separately. The featured example appears in
          compact views of this definition.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No examples yet — add one.
        </p>
      ) : (
        <ol className="overflow-hidden rounded-xl border bg-card">
          {items.map((example) => {
            const featuring =
              feature.isPending && feature.variables?.exampleId === example.id
            const modelAuthored =
              example.actorKind === "model" || example.author?.isAi === true

            return (
              <li
                key={example.id}
                className={cn(
                  "space-y-3 p-4 [&+li]:border-t sm:p-5",
                  example.isFeatured && "bg-primary/5"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Example {example.exampleNumber}
                    </span>
                    {example.isFeatured ? (
                      <Badge className="border-primary/30 bg-primary/15 text-primary">
                        <StarIcon aria-hidden className="size-3 fill-current" />
                        Featured
                      </Badge>
                    ) : null}
                    {example.legacyBackfill ? (
                      <Badge variant="outline">Legacy example</Badge>
                    ) : null}
                  </div>

                  {canFeature && !example.isFeatured ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={feature.isPending || create.isPending}
                      aria-label={`Make example ${example.exampleNumber} featured`}
                      onClick={() =>
                        feature.mutate({
                          definitionId,
                          exampleId: example.id
                        })
                      }
                    >
                      <StarIcon aria-hidden />
                      {featuring ? "Featuring…" : "Make featured"}
                    </Button>
                  ) : null}
                </div>

                <p className="whitespace-pre-wrap leading-7 text-muted-foreground">
                  {example.text}
                </p>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    {modelAuthored ? (
                      <SparklesIcon aria-hidden className="size-3.5 text-ai" />
                    ) : (
                      <UserIcon aria-hidden className="size-3.5" />
                    )}
                    <span>Added by</span>
                    <PublicProfileName
                      user={example.author}
                      fallback={
                        example.legacyBackfill
                          ? "Contributor not recorded"
                          : "Unknown contributor"
                      }
                      className={modelAuthored ? "text-ai" : undefined}
                    />
                  </span>
                  {example.model ? (
                    <span className="font-mono text-ai">{example.model}</span>
                  ) : null}
                  <span>{formatDate(example.createdAt)}</span>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <div aria-live="polite">
        {feedback ? (
          <p
            role={feedback.kind === "error" ? "alert" : "status"}
            className={cn(
              "text-sm",
              feedback.kind === "error"
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {feedback.message}
          </p>
        ) : null}
      </div>

      <form
        className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"
        aria-busy={create.isPending}
        onSubmit={(event) => {
          event.preventDefault()
          if (!trimmed || create.isPending) return
          create.mutate({
            definitionId,
            sourceRevisionId,
            text: trimmed
          })
        }}
      >
        <div className="space-y-1">
          <label
            htmlFor={`new-example-${definitionId}`}
            className="font-medium"
          >
            Add example
          </label>
          <p
            id={`new-example-help-${definitionId}`}
            className="text-sm text-muted-foreground"
          >
            Show how this definition is used in a materials science context.
          </p>
        </div>
        <Textarea
          id={`new-example-${definitionId}`}
          value={text}
          maxLength={EXAMPLE_MAX_LENGTH}
          disabled={create.isPending}
          aria-describedby={`new-example-help-${definitionId}`}
          className="min-h-24"
          placeholder="Add an example of use"
          onChange={(event) => {
            setText(event.target.value)
            if (feedback) setFeedback(null)
          }}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!trimmed || create.isPending || feature.isPending}
          >
            <PlusIcon aria-hidden />
            {create.isPending ? "Adding…" : "Add example"}
          </Button>
        </div>
      </form>
    </section>
  )
}
