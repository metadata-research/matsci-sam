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
 * definition cards with their votes, the definition form, the comment box.
 * Each is given the step, so what it writes names the step it was written
 * in, and the router decides whether the step is done.
 *
 * A define step is shown as a position step: the candidates of the term,
 * the draft first, and the three moves. Accepting a candidate is an upvote
 * that names the step; amending one opens the form with its text and names
 * its revision as the source; replacing them opens the form empty. A review
 * step compares the candidates where there is more than one.
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

// The candidate a held position names, as a record: the vote rail keeps the
// score with its buttons disabled, because the position is taken.
const HeldPosition = ({ step }: { step: Step }) => {
  const [definitions] = trpc.definitions.list.useSuspenseQuery({
    termId: step.termId!
  })
  const held = definitions.find(
    (definition) => definition.id === step.held?.definitionId
  )

  if (!held || !step.held)
    return (
      <p className="text-sm text-muted-foreground">
        The candidate you took a position on is no longer in the vocabulary.
      </p>
    )

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {step.held.kind === "accepted"
          ? "You accepted this candidate."
          : "You proposed this candidate."}
      </p>
      <Definition
        definition={{ ...held, termSlug: step.termSlug! }}
        voteReadOnly
        voteReadOnlyTitle="Your position on this term is recorded"
      />
    </div>
  )
}

type Move =
  | { kind: "choose" }
  | { kind: "amend"; candidate: Candidate }
  | { kind: "replace" }

/*
 * The candidates of the term and the three moves. Accepting is an upvote
 * that names the step, and the completion follows it as the press follows a
 * review. Amending and replacing publish through the definition form, which
 * records the completion with the definition.
 */
const Candidates = ({
  step,
  viewerId,
  pending,
  onAccepted,
  onPublished
}: {
  step: Step
  viewerId: number
  pending: boolean
  onAccepted: () => void
  onPublished: (published: RouterOutput["definitions"]["create"]) => void
}) => {
  const termId = step.termId!
  const [definitions] = trpc.definitions.list.useSuspenseQuery({ termId })
  const candidates = orderCandidates(definitions)
  const [move, setMove] = useState<Move>({ kind: "choose" })
  const utils = trpc.useUtils()

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
    }
  })

  // One original definition per person per term: a viewer who already has
  // one here cannot amend or replace, and accepts instead.
  const ownOriginal = candidates.some(
    (candidate) =>
      candidate.authorId === viewerId && candidate.refinedFromId === null
  )
  const busy = pending || accept.isPending

  if (move.kind !== "choose") {
    const candidate = move.kind === "amend" ? move.candidate : null
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {candidate
            ? `Amending definition ${candidate.definitionNumber}. What you publish is a candidate of its own, recorded as derived from it.`
            : "What you publish joins the candidates."}
        </p>
        <DefinitionForm
          key={candidate?.id ?? "replace"}
          interactive={false}
          lockedTerm={step.term!}
          surveyStepId={step.id}
          initialDefinition={candidate?.definition}
          initialExample={candidate?.example}
          derivedFromRevisionId={candidate?.revisionId}
          onPublished={onPublished}
        />
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
        // A standing upvote from outside this round would be withdrawn by a
        // second upvote, so it cannot be re-cast as the position here.
        const standing = candidate.vote === "up"
        return (
          <div key={candidate.id} className="space-y-3">
            {index === 0 && (
              <Eyebrow>{draftFirst ? "Draft" : "Candidates"}</Eyebrow>
            )}
            {index === 1 && draftFirst && <Eyebrow>Proposed so far</Eyebrow>}
            <Definition
              definition={{ ...candidate, termSlug: step.termSlug! }}
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
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy || standing}
                  title={
                    standing
                      ? "Your vote for this candidate stands from before this round. Withdraw it on the term page to accept it here."
                      : undefined
                  }
                  onClick={() =>
                    accept.mutate({
                      definitionId: candidate.id,
                      revisionId: candidate.revisionId,
                      vote: "up",
                      surveyStepId: step.id
                    })
                  }
                >
                  Accept
                </Button>
                {!ownOriginal && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setMove({ kind: "amend", candidate })}
                  >
                    Amend
                  </Button>
                )}
              </div>
            </div>
          </div>
        )
      })}
      {ownOriginal ? (
        <p className="text-sm text-muted-foreground">
          You already have a definition of this term, so the move open to you
          here is to accept a candidate.
        </p>
      ) : (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setMove({ kind: "replace" })}
        >
          None of these work
        </Button>
      )}
      <AiPendingCard termId={termId} />
    </div>
  )
}

const Position = ({
  step,
  viewerId,
  pending,
  onAccepted,
  onPublished,
  onContinue
}: {
  step: Step
  viewerId: number
  pending: boolean
  onAccepted: () => void
  onPublished: (published: RouterOutput["definitions"]["create"]) => void
  onContinue: () => void
}) => (
  <div className="space-y-6">
    {step.prompt && !step.hasPosition && (
      <p className="text-muted-foreground">{step.prompt}</p>
    )}
    <Suspense fallback={<Skeleton className="h-32 w-full" />}>
      {step.hasPosition ? (
        <HeldPosition step={step} />
      ) : (
        <Candidates
          step={step}
          viewerId={viewerId}
          pending={pending}
          onAccepted={onAccepted}
          onPublished={onPublished}
        />
      )}
    </Suspense>
    {step.hasPosition && (
      <Button onClick={onContinue} disabled={pending}>
        Continue
      </Button>
    )}
  </div>
)

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
  readOnly,
  pending,
  onDone
}: {
  step: Step
  readOnly: boolean
  pending: boolean
  onDone: () => void
}) => {
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
              definition={{ ...definitions[0], termSlug: step.termSlug! }}
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
            definition={{ ...definition, termSlug: step.termSlug! }}
            // As on the term page: the leading candidate is marked.
            isDefault={index === 0}
            surveyStepId={step.id}
            voteReadOnly={readOnly}
            voteReadOnlyTitle="This step is complete"
          />
          <div className="space-y-3 pl-4 sm:pl-8">
            <Suspense fallback={<Skeleton className="h-16 w-full" />}>
              <TermComments
                id={definition.id}
                definitionNumber={definition.definitionNumber}
                readOnly={readOnly}
              />
            </Suspense>
            {!readOnly && (
              <TermCommentBox
                id={definition.id}
                revisionId={definition.revisionId}
                feedsModelRevision={definition.authorModelSlug !== null}
                surveyStepId={step.id}
              />
            )}
          </div>
        </div>
      ))}
      <AiPendingCard termId={termId} />
      <Button onClick={onDone} disabled={pending}>
        {step.completed ? "Continue" : "Done with this term"}
      </Button>
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
  <Suspense fallback={<Skeleton className="h-32 w-full" />}>
    <ReviewList
      step={step}
      readOnly={step.completed}
      pending={pending}
      onDone={onDone}
    />
  </Suspense>
)

const SCALE = [1, 2, 3, 4, 5] as const

// A question and its answer. Answered once: the answer stays on show,
// with its controls disabled, when the step is read again.
const Question = ({
  step,
  onAnswered,
  onFailed,
  onContinue
}: {
  step: Step
  onAnswered: (nextPosition: number | null) => void
  onFailed: () => void
  onContinue: () => void
}) => {
  const answered = step.response !== null
  const [text, setText] = useState(step.response?.valueText ?? "")
  const [scale, setScale] = useState<number | null>(
    step.response?.valueScale ?? null
  )

  const answer = trpc.surveys.answerQuestion.useMutation({
    onSuccess: ({ nextPosition }) => onAnswered(nextPosition),
    onError: (error) => {
      toast.error(error.message)
      onFailed()
    }
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
      stay open to read. The study page shows the agreed definition of each
      term so far.
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

  // A refusal means the facts the shell holds are behind the record: the
  // candidate a position named was removed, or the steps were regenerated.
  // The walkthrough is read again so the step shows what the router sees.
  const reread = () => utils.surveys.get.invalidate({ studySlug })

  const complete = trpc.surveys.completeStep.useMutation({
    onSuccess: ({ nextPosition }) => advance(nextPosition),
    onError: (error) => {
      toast.error(error.message)
      reread()
    }
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
              <Position
                key={step.id}
                step={step}
                viewerId={viewerId}
                pending={complete.isPending}
                onAccepted={() => {
                  // The upvote is the position; the score it changed is read
                  // again, and the step completes as a press would.
                  utils.definitions.list.invalidate({ termId: step.termId! })
                  press(step)
                }}
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
                onFailed={reread}
                onContinue={() => show(step.position + 1)}
              />
            )}
          </>
        )}
      </section>
    </main>
  )
}
