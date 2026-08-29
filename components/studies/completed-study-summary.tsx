import Link from "next/link"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Button } from "@/components/ui/button"
import { revisionPath } from "@/lib/public-identifiers"
import { scaleLabelsForPrompt } from "@/lib/study-presentation"

type Step = RouterOutput["surveys"]["get"]["steps"][number]

const KIND_LABEL: Record<Step["kind"], string> = {
  instructions: "Instructions",
  define: "Position",
  review: "Review",
  question: "Question"
}

const DefinitionRevisionLink = ({
  step,
  definitionNumber,
  revisionVersion
}: {
  step: Step
  definitionNumber: number
  revisionVersion: number
}) => (
  <Link
    className="font-medium underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-current"
    href={revisionPath(
      step.termSlug!,
      definitionNumber,
      revisionVersion,
      step.termVocabularySlug!
    )}
  >
    Definition {definitionNumber}, revision {revisionVersion}
  </Link>
)

const PositionRecord = ({ step }: { step: Step }) => {
  if (step.held)
    return (
      <p>
        {step.held.kind === "proposed" ? "Proposed" : "Accepted"}{" "}
        <DefinitionRevisionLink
          step={step}
          definitionNumber={step.held.definitionNumber}
          revisionVersion={step.held.revisionVersion}
        />
        .
      </p>
    )

  return (
    <p className="text-muted-foreground">
      This Position step is complete, but its candidate record is unavailable.
      This can occur for an earlier completion or a candidate that was removed.
    </p>
  )
}

const voteLabel = (kind: "up" | "down" | null) =>
  kind === "up"
    ? "Upvoted"
    : kind === "down"
      ? "Downvoted"
      : "Withdrew a vote from"

const ReviewRecord = ({ step }: { step: Step }) => {
  const votes = step.reviewRecord?.votes ?? []
  const comments = step.reviewRecord?.comments ?? []

  if (votes.length === 0 && comments.length === 0)
    return (
      <p className="text-muted-foreground">
        Completed without a vote or comment recorded in this step.
      </p>
    )

  return (
    <div className="space-y-3">
      {votes.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Vote actions</p>
          <ul className="list-disc space-y-1 pl-5">
            {votes.map((vote, index) => (
              <li
                key={`${vote.definitionNumber}-${vote.revisionVersion}-${index}`}
              >
                {voteLabel(vote.kind)}{" "}
                <DefinitionRevisionLink
                  step={step}
                  definitionNumber={vote.definitionNumber}
                  revisionVersion={vote.revisionVersion}
                />
                .
              </li>
            ))}
          </ul>
        </div>
      )}
      {comments.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Comments</p>
          <ul className="space-y-2">
            {comments.map((comment, index) => (
              <li
                key={`${comment.definitionNumber}-${comment.revisionVersion}-${index}`}
                className="border-l-2 border-muted pl-3"
              >
                <p className="text-sm text-muted-foreground">
                  On{" "}
                  <DefinitionRevisionLink
                    step={step}
                    definitionNumber={comment.definitionNumber}
                    revisionVersion={comment.revisionVersion}
                  />
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">
                  {comment.message}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const QuestionRecord = ({ step }: { step: Step }) => {
  if (!step.response)
    return <p className="text-muted-foreground">No answer is recorded.</p>

  if (step.response.valueText !== null)
    return (
      <p className="whitespace-pre-wrap break-words">
        <span className="font-medium">Your answer:</span>{" "}
        {step.response.valueText}
      </p>
    )

  const labels = scaleLabelsForPrompt(step.prompt)
  return (
    <div className="space-y-1">
      <p>
        <span className="font-medium">Your answer:</span>{" "}
        {step.response.valueScale} of 5
      </p>
      <p className="text-sm text-muted-foreground">
        1 = {labels.minimum}; 5 = {labels.maximum}
      </p>
    </div>
  )
}

const StepRecord = ({ step }: { step: Step }) => {
  if (step.kind === "instructions") return <p>Instructions completed.</p>
  if (step.kind === "define") return <PositionRecord step={step} />
  if (step.kind === "review") return <ReviewRecord step={step} />
  return <QuestionRecord step={step} />
}

export const CompletedStudySummary = ({
  steps,
  onSelect
}: {
  steps: Step[]
  onSelect: (position: number) => void
}) => (
  <section className="space-y-4" aria-labelledby="study-record-heading">
    <div className="space-y-1">
      <h2 id="study-record-heading" className="text-2xl font-bold">
        Your study record
      </h2>
      <p className="text-sm text-muted-foreground">
        These are the responses and actions recorded inside each study step.
        Vote changes and withdrawals remain separate actions.
      </p>
    </div>
    <ol className="space-y-3">
      {steps.map((step) => (
        <li key={step.id} className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Step {step.position} · {KIND_LABEL[step.kind]}
              </p>
              {step.term && (
                <h3 className="font-serif text-xl font-bold">{step.term}</h3>
              )}
              {step.kind === "question" && step.prompt && (
                <h3 className="font-medium">{step.prompt}</h3>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Open step ${step.position}`}
              onClick={() => onSelect(step.position)}
            >
              Open step
            </Button>
          </div>
          <div className="mt-3 text-sm sm:text-base">
            <StepRecord step={step} />
          </div>
        </li>
      ))}
    </ol>
  </section>
)
