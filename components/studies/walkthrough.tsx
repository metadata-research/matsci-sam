"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Definition, Eyebrow } from "@/components/definition"
import { DefinitionForm } from "@/components/definition/definition-form"
import { AiPendingCard } from "@/components/definition/ai-pending-card"
import { TermComments } from "@/components/term/comments"
import { TermCommentBox } from "@/components/term/comment-box"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { SURVEY_RESPONSE_MAX_LENGTH } from "@/lib/input-limits"
import { collectionPath, studyPath } from "@/lib/public-identifiers"

/*
 * The step shell of a walkthrough. It opens at the step the router says the
 * viewer resumes at, shows one step at a time, and moves on when the step
 * is complete. The acts a step asks for are the ordinary surfaces: the
 * definition form, the definition cards with their votes, the comment box.
 * Each is given the step, so what it writes names the step it was written
 * in, and the router decides whether the step is done.
 *
 * A completed step stays readable from the dots, without its controls: its
 * completion stands. A step is reachable once the step before it is
 * complete, so nobody reviews a term they have not defined.
 */

type Walkthrough = RouterOutput["surveys"]["get"]
type Step = Walkthrough["steps"][number]

const KIND_LABEL: Record<Step["kind"], string> = {
  instructions: "Instructions",
  define: "Define",
  review: "Review",
  question: "Question"
}

// Plain text, split on blank lines, as the study page renders the welcome.
const Paragraphs = ({ text }: { text: string }) => (
  <>
    {text.split(/\n\s*\n/).map((paragraph, index) => (
      <p key={index} className="whitespace-pre-line">
        {paragraph}
      </p>
    ))}
  </>
)

const Dots = ({
  steps,
  position,
  reachable,
  onSelect
}: {
  steps: Step[]
  position: number
  reachable: (position: number) => boolean
  onSelect: (position: number) => void
}) => (
  <ol className="flex flex-wrap gap-2" aria-label="Steps">
    {steps.map((step) => {
      const current = step.position === position
      const open = reachable(step.position)
      const label = [
        `Step ${step.position}`,
        KIND_LABEL[step.kind],
        step.term,
        step.completed ? "done" : null
      ]
        .filter(Boolean)
        .join(", ")

      return (
        <li key={step.id}>
          <button
            type="button"
            aria-label={label}
            title={label}
            aria-current={current ? "step" : undefined}
            disabled={!open}
            onClick={() => onSelect(step.position)}
            className={cn(
              "block size-3.5 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-30",
              step.completed
                ? "border-primary bg-primary"
                : "border-muted-foreground/60 bg-background",
              open && !step.completed && "hover:border-primary",
              current && "ring-2 ring-ring ring-offset-2 ring-offset-background"
            )}
          />
        </li>
      )
    })}
  </ol>
)

const Instructions = ({
  step,
  pending,
  onContinue
}: {
  step: Step
  pending: boolean
  onContinue: () => void
}) => (
  <div className="space-y-4">
    {step.prompt && <Paragraphs text={step.prompt} />}
    <Button onClick={onContinue} disabled={pending}>
      Continue
    </Button>
  </div>
)

// The viewer's own definition of the term, as a record: the vote rail is
// left off, because a define step is not where votes are cast.
const OwnDefinition = ({
  termId,
  termSlug,
  viewerId
}: {
  termId: number
  termSlug: string
  viewerId: number
}) => {
  const [definitions] = trpc.definitions.list.useSuspenseQuery({ termId })
  const own = definitions.find(
    (definition) =>
      definition.authorId === viewerId && definition.refinedFromId === null
  )

  if (!own)
    return (
      <p className="text-sm text-muted-foreground">
        Your definition of this term is no longer in the vocabulary.
      </p>
    )

  return <Definition definition={{ ...own, termSlug, vote: undefined }} />
}

const Define = ({
  step,
  viewerId,
  pending,
  onPublished,
  onContinue
}: {
  step: Step
  viewerId: number
  pending: boolean
  onPublished: (published: RouterOutput["definitions"]["create"]) => void
  onContinue: () => void
}) => {
  if (!step.hasOriginalDefinition)
    return (
      <div className="space-y-4">
        {step.prompt && <p className="text-muted-foreground">{step.prompt}</p>}
        <DefinitionForm
          interactive={false}
          lockedTerm={step.term!}
          surveyStepId={step.id}
          onPublished={onPublished}
        />
      </div>
    )

  return (
    <div className="space-y-4">
      <Suspense fallback={<Skeleton className="h-32 w-full" />}>
        <OwnDefinition
          termId={step.termId!}
          termSlug={step.termSlug!}
          viewerId={viewerId}
        />
      </Suspense>
      <Button onClick={onContinue} disabled={pending}>
        Continue
      </Button>
    </div>
  )
}

/*
 * The definitions of the term, each with its discussion. The order is the
 * one the server returns and does not follow the votes cast here, so a card
 * does not move under the person commenting on it. Read-only after the
 * step is complete: the cards lose their vote rail and the comment boxes
 * are not shown.
 */
const ReviewList = ({ step, readOnly }: { step: Step; readOnly: boolean }) => {
  const termId = step.termId!
  const [definitions] = trpc.definitions.list.useSuspenseQuery({ termId })

  return (
    <div className="space-y-6">
      {definitions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          This term has no definitions to review.
        </p>
      )}
      {definitions.map((definition, index) => (
        <div key={definition.id} className="space-y-3">
          <Definition
            definition={{
              ...definition,
              termSlug: step.termSlug!,
              vote: readOnly ? undefined : definition.vote
            }}
            // As on the term page: marked only when there is more than one.
            isDefault={index === 0 && definitions.length > 1}
            surveyStepId={step.id}
          />
          <div className="space-y-3 pl-4 sm:pl-8">
            <Suspense fallback={<Skeleton className="h-16 w-full" />}>
              <TermComments
                id={definition.id}
                definitionNumber={definition.definitionNumber}
              />
            </Suspense>
            {!readOnly && (
              <TermCommentBox
                id={definition.id}
                revisionId={definition.revisionId}
                feedsModelRevision={definition.isAi}
                surveyStepId={step.id}
              />
            )}
          </div>
        </div>
      ))}
      <AiPendingCard termId={termId} />
    </div>
  )
}

const Review = ({
  step,
  pending,
  onDone
}: {
  step: Step
  pending: boolean
  onDone: () => void
}) => (
  <div className="space-y-6">
    {step.prompt && <p className="text-muted-foreground">{step.prompt}</p>}
    <Suspense fallback={<Skeleton className="h-32 w-full" />}>
      <ReviewList step={step} readOnly={step.completed} />
    </Suspense>
    <Button onClick={onDone} disabled={pending}>
      {step.completed ? "Continue" : "Done with this term"}
    </Button>
  </div>
)

const SCALE = [1, 2, 3, 4, 5] as const

// A question and its answer. Answered once: the answer stays on show,
// with its controls disabled, when the step is read again.
const Question = ({
  step,
  onAnswered,
  onContinue
}: {
  step: Step
  onAnswered: (nextPosition: number | null) => void
  onContinue: () => void
}) => {
  const answered = step.response !== null
  const [text, setText] = useState(step.response?.valueText ?? "")
  const [scale, setScale] = useState<number | null>(
    step.response?.valueScale ?? null
  )

  const answer = trpc.surveys.answerQuestion.useMutation({
    onSuccess: ({ nextPosition }) => onAnswered(nextPosition),
    onError: (error) => toast.error(error.message)
  })

  const ready =
    step.responseKind === "text" ? text.trim().length > 0 : scale !== null

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready || answered) return
        answer.mutate(
          step.responseKind === "text"
            ? { stepId: step.id, valueText: text }
            : { stepId: step.id, valueScale: scale! }
        )
      }}
    >
      <p className="text-lg">{step.prompt}</p>
      {step.responseKind === "text" ? (
        <Textarea
          aria-label="Your answer"
          className="min-h-32"
          maxLength={SURVEY_RESPONSE_MAX_LENGTH}
          value={text}
          disabled={answered}
          onChange={(event) => setText(event.target.value)}
        />
      ) : (
        <fieldset>
          <legend className="sr-only">Your answer, from 1 to 5</legend>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">Lowest</span>
            {SCALE.map((value) => (
              <label
                key={value}
                className="flex flex-col items-center gap-1 text-sm"
              >
                <input
                  type="radio"
                  name={`answer-${step.id}`}
                  value={value}
                  checked={scale === value}
                  disabled={answered}
                  onChange={() => setScale(value)}
                  className="size-4 accent-primary"
                />
                {value}
              </label>
            ))}
            <span className="text-xs text-muted-foreground">Highest</span>
          </div>
        </fieldset>
      )}
      {answered ? (
        <Button type="button" onClick={onContinue}>
          Continue
        </Button>
      ) : (
        <Button type="submit" disabled={!ready || answer.isPending}>
          Submit
        </Button>
      )}
    </form>
  )
}

const Finished = ({ study }: { study: Walkthrough["study"] }) => (
  <div className="space-y-4">
    <p className="text-muted-foreground">
      Thank you. Your work here is recorded with the study, and the steps above
      stay open to read.
    </p>
    <div className="flex flex-wrap gap-2">
      <Button asChild>
        <Link href={studyPath(study.slug)}>Open the study</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={collectionPath(study.collectionSlug)}>
          Browse the terms
        </Link>
      </Button>
    </div>
  </div>
)

export const Walkthrough = ({
  studySlug,
  viewerId
}: {
  studySlug: string
  viewerId: number
}) => {
  const [walkthrough] = trpc.surveys.get.useSuspenseQuery({ studySlug })
  const utils = trpc.useUtils()
  const { study, steps } = walkthrough
  const total = steps.length

  // The position on show. One past the last step is the finished state.
  const [position, setPosition] = useState(
    walkthrough.resumePosition ?? total + 1
  )

  const show = (next: number) => {
    setPosition(next)
    window.scrollTo({ top: 0 })
  }

  // After a completion the record has changed, so the walkthrough is read
  // again, and the shell moves to where the router says the viewer resumes.
  const advance = (nextPosition: number | null) => {
    utils.surveys.get.invalidate({ studySlug })
    show(nextPosition ?? total + 1)
  }

  const complete = trpc.surveys.completeStep.useMutation({
    onSuccess: ({ nextPosition }) => advance(nextPosition),
    onError: (error) => toast.error(error.message)
  })

  // A completed step is pressed through without a second completion.
  const press = (step: Step) =>
    step.completed
      ? show(step.position + 1)
      : complete.mutate({ stepId: step.id })

  // A step is reachable once the step before it is complete, and the
  // finished state once the last step is.
  const reachable = (at: number) => at === 1 || steps[at - 2].completed

  const step: Step | undefined = steps[position - 1]

  return (
    <main className="px-4 py-8">
      <section className="max-w-3xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Link href={studyPath(study.slug)}>{study.title}</Link>
          </div>
          {total === 0 ? (
            <h1 className="text-3xl font-bold">Walkthrough</h1>
          ) : step ? (
            <>
              <h1 className="text-3xl font-bold">
                Step {step.position} of {total}
              </h1>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Eyebrow>{KIND_LABEL[step.kind]}</Eyebrow>
                {step.term && (
                  <span className="text-2xl font-bold font-serif">
                    {step.term}
                  </span>
                )}
              </div>
            </>
          ) : (
            <h1 className="text-3xl font-bold">You have finished</h1>
          )}
        </div>

        {total === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This study has no walkthrough yet.
            </p>
            <Button asChild variant="outline">
              <Link href={studyPath(study.slug)}>Open the study</Link>
            </Button>
          </div>
        ) : (
          <>
            <Dots
              steps={steps}
              position={position}
              reachable={reachable}
              onSelect={show}
            />

            {step === undefined ? (
              <Finished study={study} />
            ) : step.kind === "instructions" ? (
              <Instructions
                key={step.id}
                step={step}
                pending={complete.isPending}
                onContinue={() => press(step)}
              />
            ) : step.kind === "define" ? (
              <Define
                key={step.id}
                step={step}
                viewerId={viewerId}
                pending={complete.isPending}
                onPublished={(published) => {
                  utils.definitions.list.invalidate({ termId: step.termId! })
                  // The completion came back with the definition, and with
                  // it where the viewer resumes.
                  if (published.walkthrough)
                    advance(published.walkthrough.nextPosition)
                  else utils.surveys.get.invalidate({ studySlug })
                }}
                onContinue={() => press(step)}
              />
            ) : step.kind === "review" ? (
              <Review
                key={step.id}
                step={step}
                pending={complete.isPending}
                onDone={() => press(step)}
              />
            ) : (
              <Question
                key={step.id}
                step={step}
                onAnswered={advance}
                onContinue={() => show(step.position + 1)}
              />
            )}
          </>
        )}
      </section>
    </main>
  )
}
