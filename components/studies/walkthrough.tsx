"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Definition, Eyebrow } from "@/components/definition"
import { DefinitionReference } from "@/components/definition/display"
import { DefinitionForm } from "@/components/definition/definition-form"
import { RevisionSuggestionForm } from "@/components/definition/revision-suggestion-form"
import { TermComments } from "@/components/term/comments"
import { TermCommentBox } from "@/components/term/comment-box"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { CompletedStudySummary } from "@/components/studies/completed-study-summary"
import { StudyInstructionContent } from "@/components/studies/instruction-content"
import { cn } from "@/lib/utils"
import { SURVEY_RESPONSE_MAX_LENGTH } from "@/lib/input-limits"
import { collectionPath, studyPath } from "@/lib/public-identifiers"
import {
  positionAcceptanceExplanation,
  scaleLabelsForPrompt
} from "@/lib/study-presentation"
import { mayOpenStudyStep, nextStudyPosition } from "@/lib/study-navigation"
import {
  type MutationActivityCallbacks,
  useMutationActivity
} from "@/components/use-mutation-activity"

/*
 * The step shell of a walkthrough. It opens at the step the router says the
 * viewer resumes at, shows one step at a time, and moves on when the step
 * is complete. The acts a step asks for are the ordinary surfaces: the
 * definition cards with their votes, the definition form, the comment box.
 * Each is given the step, so what it writes names the step it was written
 * in, and the router decides whether the step is done.
 *
 * A define step is labelled Position and shows one set of definitions from
 * earlier work, with the model-authored definition first when there is one.
 * Accepting atomically retains the selected definition, preserves or adds its
 * upvote, and completes the step; suggesting a revision names the exact source
 * revision; proposing a new definition is a term-level alternative when none
 * of the earlier definitions is close. A review step compares the definitions
 * where there is more than one.
 *
 * A completed step stays readable from the dots, without its controls: its
 * completion stands. The first incomplete step is open, but a completed
 * paired Review later in the sequence does not open the step after it.
 */

type Walkthrough = RouterOutput["surveys"]["get"]
type Step = Walkthrough["steps"][number]
type Candidate = RouterOutput["definitions"]["list"][number]

const KIND_LABEL: Record<Step["kind"], string> = {
  instructions: "Instructions",
  define: "Position",
  review: "Review",
  question: "Question"
}

const Dots = ({
  steps,
  position,
  reachable,
  navigationLocked,
  onSelect
}: {
  steps: Step[]
  position: number
  reachable: (position: number) => boolean
  navigationLocked: boolean
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
        step.completionOutcome === "skipped"
          ? "skipped"
          : step.completed
            ? "done"
            : null
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
            disabled={!open || navigationLocked}
            onClick={() => onSelect(step.position)}
            className={cn(
              "flex size-3.5 items-center justify-center rounded-full border text-[11px] font-bold leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-30",
              step.completionOutcome === "skipped"
                ? "border-primary bg-background text-primary"
                : step.completed
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/60 bg-background",
              open && !step.completed && "hover:border-primary",
              current && "ring-2 ring-ring ring-offset-2 ring-offset-background"
            )}
          >
            {step.completionOutcome === "skipped" && (
              <span aria-hidden="true">−</span>
            )}
          </button>
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
    {step.prompt && (
      <StudyInstructionContent text={step.prompt} part="actions" />
    )}
    <Button onClick={onContinue} disabled={pending}>
      Start with the first term
    </Button>
  </div>
)

// The draft of a term is its model definition, the earliest where there is
// more than one.
const isDraft = (candidate: Candidate) => Boolean(candidate.authorModelSlug)

const earliestFirst = (a: Candidate, b: Candidate) =>
  a.createdAt.localeCompare(b.createdAt) || a.id - b.id

/*
 * The candidates in the order the position step shows them: the draft
 * first, then the rest in support order, the earliest first among equals,
 * which is the order the outcome on the study page reads them in. The
 * server orders by score with the newest first among equals, for the term
 * page.
 */
const orderCandidates = (definitions: Candidate[]) => {
  const bySupport = [...definitions].sort(
    (a, b) => b.score - a.score || earliestFirst(a, b)
  )
  const draft = definitions.filter(isDraft).sort(earliestFirst)[0]
  return draft
    ? [draft, ...bySupport.filter((candidate) => candidate.id !== draft.id)]
    : bySupport
}

/*
 * The exact candidate a position names, as a record. A legacy completion or
 * a purged contribution may have no surviving target; it is not inferred from
 * a different standing vote. Support remains visible as noninteractive
 * context, while voting itself belongs to Review.
 */
const PositionTarget = ({ step }: { step: Step }) => {
  const [definitions] = trpc.definitions.list.useSuspenseQuery({
    termId: step.termId!,
    surveyStepId: step.id,
    includeExcluded: true
  })
  const held = step.held
    ? definitions.find(
        (definition) => definition.id === step.held?.definitionId
      )
    : undefined

  if (!held)
    return (
      <p className="text-sm text-muted-foreground">
        {step.held
          ? "The definition you took a position on is no longer in the vocabulary."
          : "Your position is recorded, but this earlier completion does not identify the definition."}
      </p>
    )

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {step.held?.kind === "proposed"
          ? step.held.refinedFromId
            ? "You suggested this revision as your position. Publishing it did not cast a vote. You can compare and vote on all definitions in the Review step."
            : "You proposed this definition as your position. Publishing it did not cast a vote. You can compare and vote on all definitions in the Review step."
          : "You accepted this definition as written. Accepting it also recorded an upvote. You can compare and vote on all definitions in the Review step."}
      </p>
      {held.excludedFromStudy && (
        <p className="text-sm text-muted-foreground">
          This definition is now excluded from this study. Your recorded
          position is retained.
        </p>
      )}
      <Definition
        definition={{
          ...held,
          termSlug: step.termSlug!,
          termVocabularySlug: step.termVocabularySlug!
        }}
        voteDisplay="summary"
        showStatus={false}
      />
    </div>
  )
}

const HeldPosition = ({ step }: { step: Step }) =>
  step.completionOutcome === "skipped" ? (
    <p className="text-sm text-muted-foreground">
      Skipped this term. No position was recorded.
    </p>
  ) : (
    <PositionTarget step={step} />
  )

type Move =
  | { kind: "choose" }
  | { kind: "revise"; candidate: Candidate }
  | { kind: "propose" }

/*
 * The definitions of the term and the three moves. Accepting records the exact
 * definition and its upvote. A suggested revision names one definition as its
 * source; a new proposal belongs to the term as a whole. Both publish separate
 * definitions and record the completion in the same transaction.
 */
const Candidates = ({
  step,
  expectedInstructions,
  pending,
  onAccepted,
  onSkip,
  onPublished,
  onFailed,
  onMutationStart,
  onMutationEnd
}: {
  step: Step
  expectedInstructions: string | null
  pending: boolean
  onAccepted: (nextPosition: number | null) => void
  onSkip: () => void
  onPublished: (published: RouterOutput["definitions"]["create"]) => void
  onFailed: () => void
} & MutationActivityCallbacks) => {
  const termId = step.termId!
  const [definitions] = trpc.definitions.list.useSuspenseQuery({
    termId,
    surveyStepId: step.id
  })
  const candidates = orderCandidates(definitions)
  const [move, setMove] = useState<Move>({ kind: "choose" })
  const moveHeadingRef = useRef<HTMLHeadingElement>(null)
  const returnFocusIdRef = useRef<string | null>(null)
  const utils = trpc.useUtils()
  const activity = useMutationActivity({ onMutationStart, onMutationEnd })

  useEffect(() => {
    if (move.kind !== "choose") moveHeadingRef.current?.focus()
  }, [move.kind])

  const openMove = (next: Move, trigger: HTMLButtonElement) => {
    returnFocusIdRef.current = trigger.id
    setMove(next)
  }

  const closeMove = () => {
    setMove({ kind: "choose" })
    window.requestAnimationFrame(() => {
      if (returnFocusIdRef.current)
        document.getElementById(returnFocusIdRef.current)?.focus()
    })
  }

  const accept = trpc.surveys.acceptPosition.useMutation({
    onSuccess: ({ nextPosition }, { definitionId, revisionId }) => {
      utils.votes.get.invalidate({ definitionId, revisionId })
      utils.definitions.list.invalidate({ termId })
      onAccepted(nextPosition)
    },
    onError: (error) => {
      toast.error(error.message)
      utils.definitions.list.invalidate({ termId })
      // A refusal means the step the shell holds is behind the record — the
      // position was recorded in another tab, or the instructions changed —
      // so the walkthrough is read again rather than re-offering Accept.
      onFailed()
    },
    onSettled: activity.end
  })

  const busy = pending || activity.busy || accept.isPending
  const acceptCandidate = (candidate: Candidate) => {
    if (busy) return
    activity.start()
    accept.mutate({
      stepId: step.id,
      definitionId: candidate.id,
      revisionId: candidate.revisionId,
      expectedInstructions
    })
  }

  if (move.kind === "revise") {
    const candidate = move.candidate
    return (
      <div className="space-y-4">
        <h2 ref={moveHeadingRef} tabIndex={-1} className="sr-only">
          Suggest a revision
        </h2>
        <p className="text-sm text-muted-foreground">
          Revise the closest definition to make it more accurate. Your revision
          will be added as a separate option. The original remains available.
        </p>
        <DefinitionReference
          definition={candidate}
          label="Definition you are revising"
        />
        <p className="text-sm text-muted-foreground">
          If this definition works as written, accept it below.{" "}
          {positionAcceptanceExplanation(candidate.vote)} You can add a public
          comment when you review this term.
        </p>
        <RevisionSuggestionForm
          term={step.term!}
          definitionId={candidate.id}
          sourceRevisionId={candidate.revisionId}
          surveyStepId={step.id}
          expectedInstructions={expectedInstructions}
          renderInitialActions={(formBusy) => (
            <>
              <Button
                type="button"
                disabled={busy || formBusy}
                onClick={() => acceptCandidate(candidate)}
              >
                Accept as written
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || formBusy}
                onClick={closeMove}
              >
                Back to earlier definitions
              </Button>
            </>
          )}
          onPublished={onPublished}
          onMutationStart={activity.start}
          onMutationEnd={activity.end}
        />
      </div>
    )
  }

  if (move.kind === "propose")
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h2
            ref={moveHeadingRef}
            tabIndex={-1}
            className="text-xl font-semibold outline-none"
          >
            Propose a new definition
          </h2>
          <p className="text-sm text-muted-foreground">
            Write a definition that states the meaning you consider correct.
            Existing definitions remain unchanged.
          </p>
        </div>
        <DefinitionForm
          lockedTerm={step.term!}
          surveyStepId={step.id}
          expectedInstructions={expectedInstructions}
          onPublished={onPublished}
          onMutationStart={activity.start}
          onMutationEnd={activity.end}
        />
        <Button variant="ghost" onClick={closeMove} disabled={busy}>
          Back to earlier definitions
        </Button>
      </div>
    )

  return (
    <div className="space-y-6">
      <Card className="gap-1 bg-muted/30 p-4 shadow-none">
        <h2 className="font-semibold">Choose the closest definition</h2>
        <p className="text-sm text-muted-foreground">
          Choose the definition closest to what you consider correct. Accept it
          as written, or suggest a revision to make it more accurate. If none is
          close enough, propose a new definition. Accepting records the
          definition as your position and adds your upvote.
        </p>
      </Card>
      <section aria-labelledby="skip-term-heading">
        <Card className="gap-4 bg-muted/20 p-4 shadow-none sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 id="skip-term-heading" className="font-semibold">
              Don’t know this term well enough to choose?
            </h2>
            <p className="text-sm text-muted-foreground">
              You can record no opinion and move to the next term.
            </p>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                className="w-full sm:w-auto"
              >
                Skip this term
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Skip {step.term}?</DialogTitle>
                <DialogDescription>
                  You won’t be asked to choose or review a definition for this
                  term.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={busy}>
                    Go back
                  </Button>
                </DialogClose>
                <Button type="button" disabled={busy} onClick={onSkip}>
                  Skip this term
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Card>
      </section>
      <section className="space-y-5" aria-labelledby="earlier-definitions">
        <div className="space-y-1">
          <h2 id="earlier-definitions" className="text-xl font-semibold">
            Definitions from earlier work
          </h2>
          <p className="text-sm text-muted-foreground">
            This includes definitions already in the vocabulary and definitions
            proposed by earlier participants.
          </p>
        </div>
        {candidates.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This term has no earlier definition yet.
          </p>
        )}
        <ol className="space-y-6">
          {candidates.map((candidate, index) => (
            <li key={candidate.id}>
              <article
                className="space-y-3"
                aria-labelledby={`position-definition-${candidate.id}`}
              >
                <h3
                  id={`position-definition-${candidate.id}`}
                  className="sr-only"
                >
                  Option {index + 1} of {candidates.length}
                </h3>
                <Definition
                  definition={{
                    ...candidate,
                    termSlug: step.termSlug!,
                    termVocabularySlug: step.termVocabularySlug!
                  }}
                  voteDisplay="summary"
                  showStatus={false}
                >
                  <p className="text-xs font-medium text-muted-foreground">
                    Option {index + 1} of {candidates.length}
                  </p>
                </Definition>
                <div className="space-y-3 pl-4 sm:pl-8">
                  {(candidate.comments ?? 0) > 0 && (
                    <div className="space-y-2">
                      <Eyebrow>Earlier comments</Eyebrow>
                      <Suspense fallback={<Skeleton className="h-16 w-full" />}>
                        <TermComments
                          id={candidate.id}
                          definitionNumber={candidate.definitionNumber}
                          readOnly
                        />
                      </Suspense>
                    </div>
                  )}
                  {candidate.vote && (
                    <p className="text-sm text-muted-foreground">
                      {positionAcceptanceExplanation(candidate.vote)}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => acceptCandidate(candidate)}
                      aria-label={`Accept option ${index + 1} as written`}
                    >
                      Accept as written
                    </Button>
                    <Button
                      id={`revise-definition-${candidate.id}`}
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={(event) =>
                        openMove(
                          { kind: "revise", candidate },
                          event.currentTarget
                        )
                      }
                      aria-label={`Suggest a revision to option ${index + 1}`}
                    >
                      Suggest a revision
                    </Button>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ol>
      </section>
      <Separator />
      <section aria-labelledby="new-definition-alternative">
        <Card className="gap-4 bg-muted/30 p-4 shadow-none sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 id="new-definition-alternative" className="font-semibold">
              None is close enough?
            </h2>
            <p className="text-sm text-muted-foreground">
              Write the definition you would use instead. It will be added as a
              new option for this term.
            </p>
          </div>
          <Button
            id="propose-new-definition"
            variant="outline"
            disabled={busy}
            className="w-full sm:w-auto"
            onClick={(event) =>
              openMove({ kind: "propose" }, event.currentTarget)
            }
          >
            Propose a new definition
          </Button>
        </Card>
      </section>
    </div>
  )
}

/*
 * A define step is settled once an act of the viewer names it, or once the
 * step is complete: the position is then shown as a record, whatever the
 * gate would say now. Otherwise the candidates are shown with the moves,
 * a standing upvote included, where Accept on that candidate records the
 * completion.
 */
const Position = ({
  step,
  expectedInstructions,
  pending,
  onAccepted,
  onSkip,
  onPublished,
  onFailed,
  onContinue,
  onMutationStart,
  onMutationEnd
}: {
  step: Step
  expectedInstructions: string | null
  pending: boolean
  onAccepted: (nextPosition: number | null) => void
  onSkip: () => void
  onPublished: (published: RouterOutput["definitions"]["create"]) => void
  onFailed: () => void
  onContinue: () => void
} & MutationActivityCallbacks) => {
  const settled = step.completed || step.held !== null
  return (
    <div className="space-y-6">
      <Suspense fallback={<Skeleton className="h-32 w-full" />}>
        {settled ? (
          <HeldPosition step={step} />
        ) : (
          <Candidates
            step={step}
            expectedInstructions={expectedInstructions}
            pending={pending}
            onAccepted={onAccepted}
            onSkip={onSkip}
            onPublished={onPublished}
            onFailed={onFailed}
            onMutationStart={onMutationStart}
            onMutationEnd={onMutationEnd}
          />
        )}
      </Suspense>
      {settled && (
        <Button onClick={onContinue} disabled={pending}>
          Continue
        </Button>
      )}
    </div>
  )
}

/*
 * The candidates of the term, each with its discussion, where there is more
 * than one to compare. The order is the one the server returns and does not
 * follow the votes cast here, so a card does not move under the person
 * commenting on it. Read-only after the step is complete: the vote rail
 * keeps the score and the viewer's vote with its buttons disabled, and the
 * comment boxes are not shown. A term with one candidate has nothing to
 * compare, and the step completes on the press.
 */
const ReviewList = ({
  step,
  expectedInstructions,
  readOnly,
  pending,
  onDone,
  onMutationStart,
  onMutationEnd
}: {
  step: Step
  expectedInstructions: string | null
  readOnly: boolean
  pending: boolean
  onDone: () => void
} & MutationActivityCallbacks) => {
  const termId = step.termId!
  const [definitions] = trpc.definitions.list.useSuspenseQuery({
    termId,
    surveyStepId: step.id,
    includeExcluded: readOnly
  })

  if (definitions.length <= 1)
    return (
      <div className="space-y-6">
        {definitions.length === 1 ? (
          <>
            <p className="text-muted-foreground">
              This term has one definition, so there is nothing to compare. It
              stands with the support it has.
            </p>
            <Definition
              definition={{
                ...definitions[0],
                termSlug: step.termSlug!,
                termVocabularySlug: step.termVocabularySlug!
              }}
              voteReadOnly
              voteReadOnlyTitle="The only definition is not compared"
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            This term has no definition to review.
          </p>
        )}
        <Button onClick={onDone} disabled={pending}>
          Continue
        </Button>
      </div>
    )

  return (
    <div className="space-y-6">
      {step.prompt && <p className="text-muted-foreground">{step.prompt}</p>}
      {definitions.map((definition, index) => (
        <div key={definition.id} className="space-y-3">
          {definition.excludedFromStudy && (
            <p className="text-sm text-muted-foreground">
              Excluded from this study. Earlier contributions remain in this
              record.
            </p>
          )}
          <Definition
            definition={{
              ...definition,
              termSlug: step.termSlug!,
              termVocabularySlug: step.termVocabularySlug!
            }}
            // As on the term page: the leading candidate is marked.
            isDefault={index === 0}
            surveyStepId={step.id}
            expectedInstructions={expectedInstructions}
            voteReadOnly={readOnly}
            voteDisabled={pending}
            voteReadOnlyTitle="This step is complete"
            onMutationStart={onMutationStart}
            onMutationEnd={onMutationEnd}
          />
          <div className="space-y-3 pl-4 sm:pl-8">
            <Suspense fallback={<Skeleton className="h-16 w-full" />}>
              <TermComments
                id={definition.id}
                definitionNumber={definition.definitionNumber}
                readOnly={readOnly}
              />
            </Suspense>
            {/* A comment here is the same comment-only act used everywhere. */}
            {!readOnly && (
              <TermCommentBox
                id={definition.id}
                revisionId={definition.revisionId}
                surveyStepId={step.id}
                expectedInstructions={expectedInstructions}
                disabled={pending}
                onMutationStart={onMutationStart}
                onMutationEnd={onMutationEnd}
              />
            )}
          </div>
        </div>
      ))}
      <Button onClick={onDone} disabled={pending}>
        {step.completed ? "Continue" : "Done with this term"}
      </Button>
    </div>
  )
}

const Review = ({
  step,
  expectedInstructions,
  pending,
  onDone,
  onMutationStart,
  onMutationEnd
}: {
  step: Step
  expectedInstructions: string | null
  pending: boolean
  onDone: () => void
} & MutationActivityCallbacks) =>
  step.completionOutcome === "skipped" ? (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Skipped with this term. No vote or comment was recorded.
      </p>
      <Button onClick={onDone} disabled={pending}>
        Continue
      </Button>
    </div>
  ) : (
    <Suspense fallback={<Skeleton className="h-32 w-full" />}>
      <ReviewList
        step={step}
        expectedInstructions={expectedInstructions}
        readOnly={step.completed}
        pending={pending}
        onDone={onDone}
        onMutationStart={onMutationStart}
        onMutationEnd={onMutationEnd}
      />
    </Suspense>
  )

const SCALE = [1, 2, 3, 4, 5] as const

// A question and its answer. Answered once: the answer stays on show,
// with its controls disabled, when the step is read again.
const Question = ({
  step,
  expectedInstructions,
  pending,
  onAnswered,
  onFailed,
  onContinue,
  onMutationStart,
  onMutationEnd
}: {
  step: Step
  expectedInstructions: string | null
  pending: boolean
  onAnswered: (nextPosition: number | null) => void
  onFailed: () => void
  onContinue: () => void
} & MutationActivityCallbacks) => {
  const answered = step.response !== null
  const [text, setText] = useState(step.response?.valueText ?? "")
  const [scale, setScale] = useState<number | null>(
    step.response?.valueScale ?? null
  )
  const activity = useMutationActivity({ onMutationStart, onMutationEnd })

  const answer = trpc.surveys.answerQuestion.useMutation({
    onSuccess: ({ nextPosition }) => onAnswered(nextPosition),
    onError: (error) => {
      toast.error(error.message)
      onFailed()
    },
    onSettled: activity.end
  })

  const ready =
    step.responseKind === "text" ? text.trim().length > 0 : scale !== null
  const scaleLabels = scaleLabelsForPrompt(step.prompt)

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready || answered || pending || activity.busy) return
        activity.start()
        answer.mutate(
          step.responseKind === "text"
            ? { stepId: step.id, expectedInstructions, valueText: text }
            : { stepId: step.id, expectedInstructions, valueScale: scale! }
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
          disabled={answered || pending || activity.busy}
          onChange={(event) => setText(event.target.value)}
        />
      ) : (
        <fieldset>
          <legend className="sr-only">
            {`Your answer, from 1 (${scaleLabels.minimum}) to 5 (${scaleLabels.maximum})`}
          </legend>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">
              {scaleLabels.minimum}
            </span>
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
                  disabled={answered || pending || activity.busy}
                  onChange={() => setScale(value)}
                  className="size-4 accent-primary"
                />
                {value}
              </label>
            ))}
            <span className="text-xs text-muted-foreground">
              {scaleLabels.maximum}
            </span>
          </div>
        </fieldset>
      )}
      {answered ? (
        <Button type="button" onClick={onContinue} disabled={pending}>
          Continue
        </Button>
      ) : (
        <Button
          type="submit"
          disabled={!ready || pending || activity.busy || answer.isPending}
        >
          Submit
        </Button>
      )}
    </form>
  )
}

const Finished = ({
  study,
  steps,
  onSelect
}: {
  study: Walkthrough["study"]
  steps: Step[]
  onSelect: (position: number) => void
}) => (
  <div className="space-y-8">
    <CompletedStudySummary steps={steps} onSelect={onSelect} />
    <div className="space-y-4 border-t pt-6">
      <p className="text-muted-foreground">
        Thank you. Your contributions are recorded with the study. You can
        review them above or browse the terms in the collection.
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
  </div>
)

export const Walkthrough = ({ studySlug }: { studySlug: string }) => {
  const [walkthrough] = trpc.surveys.get.useSuspenseQuery({ studySlug })
  const utils = trpc.useUtils()
  const { study, steps } = walkthrough
  const total = steps.length
  const expectedInstructions =
    steps.find(
      (candidate) =>
        candidate.kind === "instructions" && candidate.position === 1
    )?.prompt ?? null

  // The position on show. One past the last step is the finished state.
  const [position, setPosition] = useState(
    walkthrough.resumePosition ?? total + 1
  )
  const interaction = useMutationActivity()

  // Completed steps stay readable, including a Review completed when its
  // term was skipped. Apart from those records, only the first incomplete
  // step is open. A completed Review beyond that gap must not unlock the
  // following step.
  const reachable = (at: number) =>
    mayOpenStudyStep(steps, walkthrough.resumePosition, at)

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

  // A refusal means the facts the shell holds are behind the record: the
  // candidate a position named was removed, or the steps were regenerated.
  // The walkthrough is read again so the step shows what the router sees.
  const reread = () => utils.surveys.get.invalidate({ studySlug })

  const complete = trpc.surveys.completeStep.useMutation({
    onSuccess: ({ nextPosition }) => advance(nextPosition),
    onError: (error) => {
      toast.error(error.message)
      reread()
    },
    onSettled: interaction.end
  })

  const skip = trpc.surveys.skipTerm.useMutation({
    onSuccess: ({ nextPosition }) => advance(nextPosition),
    onError: (error) => {
      toast.error(error.message)
      reread()
    },
    onSettled: interaction.end
  })

  // A completed step is pressed through without a second completion.
  const press = (step: Step) => {
    if (step.completed) {
      show(nextStudyPosition(steps, walkthrough.resumePosition, step.position))
    } else {
      interaction.start()
      complete.mutate({ stepId: step.id, expectedInstructions })
    }
  }

  // The step after this one reads the candidates of its term, so they are
  // fetched before the shell moves on, and the step paints without its
  // skeleton.
  const prefetchNext = (step: Step) => {
    const next = steps[step.position]
    if (next?.termId)
      utils.definitions.list.prefetch({
        termId: next.termId,
        surveyStepId: next.id,
        includeExcluded: next.completed
      })
  }

  const step: Step | undefined = steps[position - 1]
  const navigationLocked =
    complete.isPending || skip.isPending || interaction.busy

  return (
    <main className="px-4 py-8">
      <section className="max-w-3xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Link href={studyPath(study.slug)}>{study.title}</Link>
          </div>
          {total === 0 ? (
            <h1 className="text-3xl font-bold">Study activity</h1>
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
              The study steps have not been prepared yet.
            </p>
            <Button asChild variant="outline">
              <Link href={studyPath(study.slug)}>Open the study</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Dots
                steps={steps}
                position={position}
                reachable={reachable}
                navigationLocked={navigationLocked}
                onSelect={show}
              />
              {steps.some(
                (candidate) => candidate.completionOutcome === "skipped"
              ) && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-bold text-primary" aria-hidden>
                    −
                  </span>{" "}
                  A skipped term marks both its Position and Review steps.
                </p>
              )}
            </div>

            {step === undefined ? (
              <Finished study={study} steps={steps} onSelect={show} />
            ) : step.kind === "instructions" ? (
              <Instructions
                key={step.id}
                step={step}
                pending={navigationLocked}
                onContinue={() => press(step)}
              />
            ) : step.kind === "define" ? (
              <Position
                key={step.id}
                step={step}
                expectedInstructions={expectedInstructions}
                pending={navigationLocked}
                onAccepted={(nextPosition) => {
                  prefetchNext(step)
                  advance(nextPosition)
                }}
                onSkip={() => {
                  interaction.start()
                  skip.mutate({ stepId: step.id, expectedInstructions })
                }}
                onPublished={(published) => {
                  utils.definitions.list.invalidate({ termId: step.termId! })
                  prefetchNext(step)
                  // The completion came back with the definition, and with
                  // it where the viewer resumes.
                  if (published.walkthrough)
                    advance(published.walkthrough.nextPosition)
                  else utils.surveys.get.invalidate({ studySlug })
                }}
                onFailed={reread}
                onContinue={() => press(step)}
                onMutationStart={interaction.start}
                onMutationEnd={interaction.end}
              />
            ) : step.kind === "review" ? (
              <Review
                key={step.id}
                step={step}
                expectedInstructions={expectedInstructions}
                pending={navigationLocked}
                onDone={() => press(step)}
                onMutationStart={interaction.start}
                onMutationEnd={interaction.end}
              />
            ) : (
              <Question
                key={step.id}
                step={step}
                expectedInstructions={expectedInstructions}
                pending={navigationLocked}
                onAnswered={advance}
                onFailed={reread}
                onContinue={() => show(step.position + 1)}
                onMutationStart={interaction.start}
                onMutationEnd={interaction.end}
              />
            )}
          </>
        )}
      </section>
    </main>
  )
}
