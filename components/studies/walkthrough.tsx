"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Definition, Eyebrow } from "@/components/definition"
import { DefinitionForm } from "@/components/definition/definition-form"
import { RevisionSuggestionForm } from "@/components/definition/revision-suggestion-form"
import { TermComments } from "@/components/term/comments"
import { TermCommentBox } from "@/components/term/comment-box"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { CompletedStudySummary } from "@/components/studies/completed-study-summary"
import { cn } from "@/lib/utils"
import { SURVEY_RESPONSE_MAX_LENGTH } from "@/lib/input-limits"
import { collectionPath, studyPath } from "@/lib/public-identifiers"
import { scaleLabelsForPrompt } from "@/lib/study-presentation"
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
 * A define step is labelled Position and shows the candidates of the term,
 * the draft first, and three explicit moves. Accepting a candidate is an upvote
 * that names the step, or, on a candidate the viewer already upvoted, the
 * completion recorded against that standing vote; suggesting a revision
 * opens the form with a candidate's text and names its revision as the source;
 * proposing a replacement opens the form empty. A review step compares the
 * candidates where there is more than one.
 *
 * A completed step stays readable from the dots, without its controls: its
 * completion stands. A step is reachable once the step before it is
 * complete, so nobody compares candidates before taking a position.
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
            disabled={!open || navigationLocked}
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
 * The candidate a position names, as a record: the act of the viewer naming
 * the step or, on a completed step with none, the candidate their standing
 * upvote stands on. The vote rail keeps the score with its buttons
 * disabled, because the position is taken.
 */
const HeldPosition = ({ step }: { step: Step }) => {
  const [definitions] = trpc.definitions.list.useSuspenseQuery({
    termId: step.termId!
  })
  const held = step.held
    ? definitions.find(
        (definition) => definition.id === step.held?.definitionId
      )
    : definitions.find((definition) => definition.vote === "up")

  if (!held)
    return (
      <p className="text-sm text-muted-foreground">
        {step.held
          ? "The candidate you took a position on is no longer in the vocabulary."
          : "Your position on this term is recorded."}
      </p>
    )

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {step.held?.kind === "proposed"
          ? "You proposed this candidate."
          : "You accepted this candidate."}
      </p>
      <Definition
        definition={{
          ...held,
          termSlug: step.termSlug!,
          termVocabularySlug: step.termVocabularySlug!
        }}
        voteReadOnly
        voteReadOnlyTitle="Your position on this term is recorded"
      />
    </div>
  )
}

type Move =
  | { kind: "choose" }
  | { kind: "revise"; candidate: Candidate }
  | { kind: "replace"; candidate: Candidate }

/*
 * The candidates of the term and the three moves. Accepting is an upvote that
 * names the step. A suggested revision and a proposed replacement publish
 * separate candidates through the shared definition form, which records the
 * completion with the definition.
 */
const Candidates = ({
  step,
  expectedInstructions,
  pending,
  onAccepted,
  onPublished,
  onMutationStart,
  onMutationEnd
}: {
  step: Step
  expectedInstructions: string | null
  pending: boolean
  onAccepted: () => void
  onPublished: (published: RouterOutput["definitions"]["create"]) => void
} & MutationActivityCallbacks) => {
  const termId = step.termId!
  const [definitions] = trpc.definitions.list.useSuspenseQuery({ termId })
  const candidates = orderCandidates(definitions)
  const [move, setMove] = useState<Move>({ kind: "choose" })
  const utils = trpc.useUtils()
  const activity = useMutationActivity({ onMutationStart, onMutationEnd })

  const accept = trpc.votes.vote.useMutation({
    onSuccess: (_, { definitionId, revisionId }) => {
      // The rail of the accepted card reads votes.get, which was primed from
      // the list and is read again here, or it would show the score as it
      // was before the upvote.
      utils.votes.get.invalidate({ definitionId, revisionId })
      onAccepted()
    },
    onError: (error) => {
      toast.error(error.message)
      utils.definitions.list.invalidate({ termId })
    },
    onSettled: activity.end
  })

  const busy = pending || activity.busy || accept.isPending

  if (move.kind !== "choose") {
    const candidate = move.candidate
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {move.kind === "revise"
            ? `Suggesting a revision to Definition ${candidate.definitionNumber}. Publishing creates a separate candidate derived from it; the source remains available for comparison and voting.`
            : "Proposing a replacement creates a separate candidate for this term. Existing candidates remain available for comparison and voting."}
        </p>
        {move.kind === "revise" ? (
          <RevisionSuggestionForm
            term={step.term!}
            definitionId={candidate.id}
            sourceRevisionId={candidate.revisionId}
            surveyStepId={step.id}
            expectedInstructions={expectedInstructions}
            onPublished={onPublished}
            onMutationStart={activity.start}
            onMutationEnd={activity.end}
          />
        ) : (
          <DefinitionForm
            lockedTerm={step.term!}
            surveyStepId={step.id}
            expectedInstructions={expectedInstructions}
            replacesDefinitionId={candidate.id}
            onPublished={onPublished}
            onMutationStart={activity.start}
            onMutationEnd={activity.end}
          />
        )}
        <Button
          variant="ghost"
          onClick={() => setMove({ kind: "choose" })}
          disabled={busy}
        >
          Back to the candidates
        </Button>
      </div>
    )
  }

  const draftFirst = candidates.length > 0 && isDraft(candidates[0])

  return (
    <div className="space-y-6">
      {candidates.length === 0 && (
        <p className="text-sm text-muted-foreground">
          This term has no candidate yet.
        </p>
      )}
      {candidates.map((candidate, index) => {
        // A standing upvote on the current text is the position already:
        // the vote path toggles, so Accept records the step against it and
        // casts nothing. Said under the candidate, where the button is.
        const standing = candidate.vote === "up"
        return (
          <div key={candidate.id} className="space-y-3">
            {index === 0 && (
              <Eyebrow>{draftFirst ? "Draft" : "Candidates"}</Eyebrow>
            )}
            {index === 1 && draftFirst && <Eyebrow>Proposed so far</Eyebrow>}
            <Definition
              definition={{
                ...candidate,
                termSlug: step.termSlug!,
                termVocabularySlug: step.termVocabularySlug!
              }}
              voteReadOnly
              voteReadOnlyTitle="Accept a candidate to vote for it"
            />
            <div className="space-y-3 pl-4 sm:pl-8">
              <Suspense fallback={<Skeleton className="h-16 w-full" />}>
                <TermComments
                  id={candidate.id}
                  definitionNumber={candidate.definitionNumber}
                  readOnly
                />
              </Suspense>
              {standing && (
                <p className="text-sm text-muted-foreground">
                  Your upvote on this candidate stands. Accept records it as
                  your position.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (standing) onAccepted()
                    else {
                      activity.start()
                      accept.mutate({
                        definitionId: candidate.id,
                        revisionId: candidate.revisionId,
                        vote: "up",
                        surveyStepId: step.id,
                        expectedInstructions
                      })
                    }
                  }}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setMove({ kind: "revise", candidate })}
                >
                  Suggest a revision
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setMove({ kind: "replace", candidate })}
                >
                  Propose a replacement
                </Button>
              </div>
            </div>
          </div>
        )
      })}
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
  onPublished,
  onContinue,
  onMutationStart,
  onMutationEnd
}: {
  step: Step
  expectedInstructions: string | null
  pending: boolean
  onAccepted: () => void
  onPublished: (published: RouterOutput["definitions"]["create"]) => void
  onContinue: () => void
} & MutationActivityCallbacks) => {
  const settled = step.completed || step.held !== null
  return (
    <div className="space-y-6">
      {step.prompt && !settled && (
        <p className="text-muted-foreground">{step.prompt}</p>
      )}
      <Suspense fallback={<Skeleton className="h-32 w-full" />}>
        {settled ? (
          <HeldPosition step={step} />
        ) : (
          <Candidates
            step={step}
            expectedInstructions={expectedInstructions}
            pending={pending}
            onAccepted={onAccepted}
            onPublished={onPublished}
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
  const [definitions] = trpc.definitions.list.useSuspenseQuery({ termId })

  if (definitions.length <= 1)
    return (
      <div className="space-y-6">
        {definitions.length === 1 ? (
          <>
            <p className="text-muted-foreground">
              This term has one candidate, so there is nothing to compare. It
              stands with the support it has.
            </p>
            <Definition
              definition={{
                ...definitions[0],
                termSlug: step.termSlug!,
                termVocabularySlug: step.termVocabularySlug!
              }}
              voteReadOnly
              voteReadOnlyTitle="The only candidate is not compared"
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            This term has no candidate to review.
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
} & MutationActivityCallbacks) => (
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
        Thank you. Your work here is recorded with the study. The study page
        shows the candidate with the greatest site-wide support for each term.
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

  // A completed step is pressed through without a second completion.
  const press = (step: Step) => {
    if (step.completed) show(step.position + 1)
    else {
      interaction.start()
      complete.mutate({ stepId: step.id, expectedInstructions })
    }
  }

  // The step after this one reads the candidates of its term, so they are
  // fetched before the shell moves on, and the step paints without its
  // skeleton.
  const prefetchNext = (step: Step) => {
    const next = steps[step.position]
    if (next?.termId) utils.definitions.list.prefetch({ termId: next.termId })
  }

  // A step is reachable once the step before it is complete, and the
  // finished state once the last step is.
  const reachable = (at: number) => at === 1 || steps[at - 2].completed

  const step: Step | undefined = steps[position - 1]
  const navigationLocked = complete.isPending || interaction.busy

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
            <Dots
              steps={steps}
              position={position}
              reachable={reachable}
              navigationLocked={navigationLocked}
              onSelect={show}
            />

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
                onAccepted={() => {
                  // The upvote is the position; the score it changed is read
                  // again, and the step completes as a press would.
                  utils.definitions.list.invalidate({ termId: step.termId! })
                  prefetchNext(step)
                  press(step)
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
