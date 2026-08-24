/*
 * The protocol steps the driver can perform, one act per function, every
 * act an ordinary application write through the same lib/ paths the routers
 * call. Simulated acts are marked simulated and stamped. An act taken for a
 * step of the walkthrough names that step and completes it in the
 * transaction of the act, as the pages write it: accepting the draft is an
 * upvote naming the define step, amending it is a definition whose initial
 * revision names the step and the revision it derives from, and a review
 * step, which the pages complete on a separate press, is completed here by
 * its first act or by the press where there is one candidate or none the
 * persona may vote on. The record of the cohort then reads as the
 * walkthrough pages would have written it.
 *
 * Every act is idempotent per persona and step, because --resume re-runs a
 * unit that failed after its first write landed: each act reads the record
 * before it writes, so a position already held is not taken twice, a vote
 * already cast inside a step is not cast again, which with the toggling
 * vote path would withdraw it, and a comment already posted stands.
 */

import { and, asc, eq, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import {
  aiModelsTable,
  commentsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  usersTable,
  voteEventsTable,
  votesTable
} from "../../drizzle"
import { createDefinitionWithInitialRevision } from "../../lib/definition-revisions"
import { lockDefinitionRevisionSource } from "../../lib/definition-source"
import { DefinitionOutput, runLLM } from "../../lib/llm/client"
import { castVote, insertComment } from "../../lib/participation"
import {
  hasPosition,
  instructionPromptOfStudy,
  lockStudy,
  recordResponse,
  responseOf,
  stepWithStudy
} from "../../lib/survey-queries"
import { recordCompletion } from "../../lib/surveys"
import { studyState } from "../../lib/communities"
import type { PilotStep, Walkthrough } from "./db"
import type { PilotTerm } from "./terms"
import {
  amendMessage,
  amendStamp,
  commentMessage,
  commentStamp,
  positionMessage,
  positionPrompt,
  surveyMessage,
  surveyPrompt,
  surveyStamp,
  amendPrompt,
  commentPrompt
} from "./prompts"
import { z } from "zod"

const CommentOutput = z.object({ comment: z.string() })
const AnswerOutput = z.object({ answer: z.string() })
// The position answer, parsed strictly: one of the two moves and a reason,
// nothing else. A draft is accepted or amended; the driver replaces none.
const PositionOutput = z
  .object({ position: z.enum(["accept", "amend"]), reason: z.string().min(1) })
  .strict()

/*
 * One generation against the inference host, with a bounded retry on a
 * transport failure. runLLM propagates a dropped connection and resolves to
 * undefined on a malformed response; only the first is retried, because the
 * second is the model's answer and a second ask is a second act. The delays
 * double from two seconds, and the last failure propagates with what was
 * tried.
 */
const GENERATION_ATTEMPTS = 4
const RETRY_DELAY_MS = 2000
const generate = async <T extends z.ZodTypeAny>(
  messages: Parameters<typeof runLLM>[0],
  systemPrompt: string,
  schema: T
) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runLLM(messages, systemPrompt, schema)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt >= GENERATION_ATTEMPTS)
        throw new Error(
          `Generation failed after ${attempt} attempts: ${message}`,
          { cause: error }
        )
      const delay = RETRY_DELAY_MS * 2 ** (attempt - 1)
      console.log(
        `retry ${attempt} of ${GENERATION_ATTEMPTS - 1} in ${delay / 1000}s: ${message}`
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

// The step an act is taken for: the define step of the term for a
// position, the review step of the term for a comment or a vote.
type StepRef = Pick<PilotStep, "id" | "studyId" | "expectedInstructions">
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

const lockPilotStep = async (tx: DatabaseTransaction, step: StepRef) => {
  const lockedStudy = await lockStudy(tx, step.studyId)
  if (!lockedStudy)
    throw new Error("The study no longer exists. Reload the pilot plan.")
  const found = await stepWithStudy(tx, step.id)
  if (!found || found.study.id !== step.studyId)
    throw new Error("The walkthrough was regenerated. Reload the pilot plan.")
  if (studyState(lockedStudy) !== "open")
    throw new Error("The study is no longer open.")
  if (
    (await instructionPromptOfStudy(tx, step.studyId)) !==
    step.expectedInstructions
  )
    throw new Error("The study instructions changed. Reload the pilot plan.")
  return found
}

/*
 * The draft of a term: its definition under a model identity, an aiModels
 * row, the earliest where there is more than one. The 2025 drafts are the
 * MatBot Gemma 3 definitions; a term without one has no draft to take a
 * position on, and the run stops rather than inventing one.
 */
export const draftOf = async (termId: number) => {
  const [draft] = await db
    .select({
      id: definitionsTable.id,
      currentRevisionId: definitionsTable.currentRevisionId,
      definition: definitionsTable.definition,
      example: definitionsTable.example
    })
    .from(definitionsTable)
    .innerJoin(
      aiModelsTable,
      eq(aiModelsTable.userId, definitionsTable.authorId)
    )
    .where(eq(definitionsTable.termId, termId))
    .orderBy(asc(definitionsTable.createdAt), asc(definitionsTable.id))
    .limit(1)
  return draft ?? null
}

type Draft = NonNullable<Awaited<ReturnType<typeof draftOf>>>

export type PositionDecision = z.infer<typeof PositionOutput>

/*
 * The persona's position on the draft, decided by the persona: one
 * generation in its voice from the text of the draft, answering accept or
 * amend with one sentence of reason. The answer is parsed strictly. A
 * malformed answer is asked for once more, and a second one fails the
 * unit, because the position is the persona's and the driver takes none
 * on its behalf. The decision is not a row of the record; the act it leads
 * to is, and the orchestrator keeps the decision and its stamp in the
 * manifest so a resumed unit acts on the decision it already holds.
 */
export const decidePosition = async (
  persona: { voice: string },
  term: PilotTerm,
  draft: Draft
): Promise<PositionDecision> => {
  const messages: Parameters<typeof runLLM>[0] = [
    {
      role: "user",
      content: positionMessage(
        persona,
        term,
        draft.definition,
        draft.example ?? ""
      )
    }
  ]
  const first = await generate(messages, positionPrompt, PositionOutput)
  if (first) return { ...first, reason: first.reason.trim() }
  console.log(`malformed position answer for ${term.term}; asking once more`)
  const second = await generate(messages, positionPrompt, PositionOutput)
  if (second) return { ...second, reason: second.reason.trim() }
  throw new Error(
    `Position generation failed for ${term.term}: two malformed answers`
  )
}

/*
 * Whether the persona already holds a position on a define step, read
 * before the persona is asked: a unit re-run without its manifest, from a
 * fresh state directory or on another machine, takes no second decision
 * and asks the model nothing. The completion is recorded again, which is
 * not an error.
 */
export const holdsPosition = async (personaUserId: number, step: StepRef) => {
  if (!(await hasPosition(db, step.id, personaUserId))) return false
  await db.transaction(async (tx) => {
    await lockPilotStep(tx, step)
    await recordCompletion(tx, { stepId: step.id, userId: personaUserId })
  })
  return true
}

/*
 * Accept the draft: an upvote naming the define step, which is the
 * position, and the completion of the step in the same transaction, as the
 * position step completes after the vote. A position already held stands,
 * and only the completion is recorded again, which is not an error.
 */
export const acceptAct = async (
  personaUserId: number,
  draft: Draft,
  communityId: number,
  step: StepRef
) => {
  if (await hasPosition(db, step.id, personaUserId)) {
    await db.transaction(async (tx) => {
      await lockPilotStep(tx, step)
      await recordCompletion(tx, { stepId: step.id, userId: personaUserId })
    })
    return { skipped: true as const }
  }
  if (!draft.currentRevisionId)
    throw new Error(`No current revision to accept on definition ${draft.id}`)
  await db.transaction(async (tx) => {
    await lockPilotStep(tx, step)
    await castVote(tx, {
      definitionId: draft.id,
      revisionId: draft.currentRevisionId!,
      userId: personaUserId,
      vote: "up",
      actorKind: "simulated",
      communityId,
      surveyStepId: step.id
    })
    await recordCompletion(tx, { stepId: step.id, userId: personaUserId })
  })
  return { skipped: false as const }
}

/*
 * Amend the draft: generate the amendment in the persona's voice from the
 * text of the draft, then write the ordinary initial definition under the
 * persona account, with the define step and the current revision of the
 * draft on its initial revision and the completion of the step in the same
 * transaction, as definitions.create writes it. The source is ai_generation
 * and the row is stamped, because the text is model output however
 * participant-shaped its role in the protocol is. The term is the one the
 * caller resolved the draft and the step for.
 */
export const amendAct = async (
  persona: { voice: string },
  personaUserId: number,
  termId: number,
  term: PilotTerm,
  draft: Draft,
  step: StepRef
) => {
  if (await hasPosition(db, step.id, personaUserId)) {
    await db.transaction(async (tx) => {
      await lockPilotStep(tx, step)
      await recordCompletion(tx, { stepId: step.id, userId: personaUserId })
    })
    return { skipped: true as const }
  }
  const sourceRevisionId = draft.currentRevisionId
  if (!sourceRevisionId)
    throw new Error(`No current revision to amend on definition ${draft.id}`)

  const result = await generate(
    [
      {
        role: "user",
        content: amendMessage(
          persona,
          term,
          draft.definition,
          draft.example ?? ""
        )
      }
    ],
    amendPrompt,
    DefinitionOutput
  )
  if (!result) throw new Error(`Amend generation failed for ${term.term}`)

  const written = await db.transaction(async (tx) => {
    await lockPilotStep(tx, step)
    // The model answered the exact revision it was shown. Hold the source
    // definition through this write so a concurrent revision either lands
    // before this check (and refuses the stale amendment) or waits until the
    // derivation has committed.
    const currentDraft = await lockDefinitionRevisionSource(
      tx,
      sourceRevisionId
    )
    if (
      !currentDraft ||
      currentDraft.definitionId !== draft.id ||
      !currentDraft.isCurrent
    )
      throw new Error(
        `Definition ${draft.id} changed while its amendment was being generated; retry from the current revision`
      )
    const created = await createDefinitionWithInitialRevision(tx, {
      termId,
      authorId: personaUserId,
      definition: result.definition,
      example: result.example,
      changeNote: "Amendment of the draft, simulated participant",
      source: "ai_generation",
      model: amendStamp.model,
      prompt: amendStamp.promptText,
      derivedFromRevisionId: sourceRevisionId,
      surveyStepId: step.id
    })
    await recordCompletion(tx, { stepId: step.id, userId: personaUserId })
    return created
  })
  return { skipped: false as const, definitionId: written.definition.id }
}

/*
 * The candidates of one term as a reviewer reads them: every definition of
 * the term, with its current revision, the text, its support, and whether
 * the reviewer already has a standing vote on that revision, which a second
 * vote would change or withdraw. Support is read from the votes on the
 * current text, up less down, as the agreed list reads it.
 */
export const candidatesOf = (termId: number, viewerId: number) =>
  db
    .select({
      id: definitionsTable.id,
      currentRevisionId: definitionsTable.currentRevisionId,
      authorId: definitionsTable.authorId,
      authorName: usersTable.name,
      definition: definitionsTable.definition,
      example: definitionsTable.example,
      support: sql<number>`(
        select coalesce(sum(case when v.kind = 'up' then 1 else -1 end), 0)::int
        from ${votesTable} v
        where v."definitionId" = ${definitionsTable.id}
          and v."revisionId" = ${definitionsTable.currentRevisionId}
      )`,
      votedByViewer: sql<boolean>`exists (
        select 1 from ${votesTable} v
        where v."definitionId" = ${definitionsTable.id}
          and v."revisionId" = ${definitionsTable.currentRevisionId}
          and v."userId" = ${viewerId}
      )`
    })
    .from(definitionsTable)
    .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
    .where(eq(definitionsTable.termId, termId))
    .orderBy(asc(definitionsTable.id))

export type Candidate = Awaited<ReturnType<typeof candidatesOf>>[number]

/*
 * The candidate a persona amended from on a term, read from the record: the
 * definition whose revision the initial revision of the persona's own
 * definition of the term derives from. Null where the persona amended
 * nothing there.
 */
export const amendedFromOf = async (termId: number, personaUserId: number) => {
  const source = alias(definitionRevisionsTable, "source")
  const [row] = await db
    .select({ definitionId: source.definitionId })
    .from(definitionRevisionsTable)
    .innerJoin(
      definitionsTable,
      eq(definitionsTable.id, definitionRevisionsTable.definitionId)
    )
    .innerJoin(
      source,
      eq(source.id, definitionRevisionsTable.derivedFromRevisionId)
    )
    .where(
      and(
        eq(definitionsTable.termId, termId),
        eq(definitionsTable.authorId, personaUserId),
        eq(definitionRevisionsTable.version, 1)
      )
    )
    .orderBy(asc(definitionRevisionsTable.id))
    .limit(1)
  return row?.definitionId ?? null
}

// The vote a persona already cast inside a step, if any: the definition it
// was cast on, so a resumed unit comments on the same candidate.
export const stepVoteOf = async (personaUserId: number, step: StepRef) => {
  const [event] = await db
    .select({ definitionId: voteEventsTable.definitionId })
    .from(voteEventsTable)
    .where(
      and(
        eq(voteEventsTable.surveyStepId, step.id),
        eq(voteEventsTable.userId, personaUserId)
      )
    )
    .orderBy(asc(voteEventsTable.id))
    .limit(1)
  return event ?? null
}

/*
 * One review comment by one persona on one candidate: generate in the
 * persona's voice, then post it as a simulated act with the registered
 * stamp, against the candidate's current revision, from the review step of
 * the term. The comment names the step and completes it. A comment the
 * persona already posted inside the step on this candidate stands.
 */
export const commentAct = async (
  persona: { voice: string },
  personaUserId: number,
  termLabel: string,
  target: Candidate,
  step: StepRef
) => {
  if (!target.currentRevisionId)
    throw new Error(`No current revision to comment on for ${termLabel}`)
  const [posted] = await db
    .select({ id: commentsTable.id })
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.surveyStepId, step.id),
        eq(commentsTable.userId, personaUserId),
        eq(commentsTable.definitionId, target.id)
      )
    )
    .limit(1)
  if (posted) return { skipped: true as const }

  const result = await generate(
    [
      {
        role: "user",
        content: commentMessage(
          persona,
          termLabel,
          target.definition,
          target.example ?? ""
        )
      }
    ],
    commentPrompt,
    CommentOutput
  )
  if (!result) throw new Error(`Comment generation failed for ${termLabel}`)

  await db.transaction(async (tx) => {
    await lockPilotStep(tx, step)
    await insertComment(tx, {
      definitionId: target.id,
      revisionId: target.currentRevisionId!,
      userId: personaUserId,
      message: result.comment,
      actorKind: "simulated",
      stamp: commentStamp,
      surveyStepId: step.id
    })
    await recordCompletion(tx, { stepId: step.id, userId: personaUserId })
  })
  return { skipped: false as const }
}

/*
 * The review vote: an upvote by one persona on the candidate it prefers
 * among those it did not write and did not amend, in the pilot community's
 * context and from the review step of the term, which the act names and
 * completes. The choice arrives from the orchestrator, which reads the
 * persona's position. A vote the persona already cast inside the step
 * stands, whatever candidate it was on: the vote path toggles, and a
 * second cast would withdraw it.
 */
export const voteAct = async (
  personaUserId: number,
  target: Candidate,
  communityId: number,
  step: StepRef
) => {
  const prior = await stepVoteOf(personaUserId, step)
  if (prior) return { skipped: true as const, definitionId: prior.definitionId }
  if (!target.currentRevisionId)
    throw new Error(
      `No current revision to vote on for definition ${target.id}`
    )
  await db.transaction(async (tx) => {
    await lockPilotStep(tx, step)
    await castVote(tx, {
      definitionId: target.id,
      revisionId: target.currentRevisionId!,
      userId: personaUserId,
      vote: "up",
      actorKind: "simulated",
      communityId,
      surveyStepId: step.id
    })
    await recordCompletion(tx, { stepId: step.id, userId: personaUserId })
  })
  return { skipped: false as const, definitionId: target.id }
}

// The press: a review step completed without an act, where the term has
// one candidate or none the persona may vote on, as the page completes it.
export const pressStep = (personaUserId: number, step: StepRef) =>
  db.transaction(async (tx) => {
    await lockPilotStep(tx, step)
    return recordCompletion(tx, { stepId: step.id, userId: personaUserId })
  })

/*
 * One persona walks the steps no act of the protocol completes: the
 * instructions, pressed through, and each closing question, answered as a
 * simulated act. A scale answer arrives from the seeded structure and is a
 * drawn number, so it has no stamp; a text answer is generated in the
 * persona's voice under the survey prompt and is stamped on the row, as a
 * simulated comment is. The answer and the completion are one transaction,
 * the pairing the invariants require of a response.
 *
 * Idempotent per question, because a question is answered once: a persona
 * resumed after a transport failure skips what it already answered.
 */
export const walkthroughProgressStep = async (
  persona: { voice: string },
  personaUserId: number,
  walkthrough: Pick<Walkthrough, "instructions" | "questions">,
  scaleAnswers: Map<number, number>
) => {
  for (const step of walkthrough.instructions)
    await db.transaction(async (tx) => {
      await lockPilotStep(tx, step)
      await recordCompletion(tx, { stepId: step.id, userId: personaUserId })
    })

  let answered = 0
  let skipped = 0
  for (const step of walkthrough.questions) {
    if (await responseOf(db, step.id, personaUserId)) {
      skipped++
      continue
    }
    if (!step.prompt)
      throw new Error(`Question step ${step.position} has no prompt`)

    let value:
      | { valueScale: number }
      | { valueText: string; stamp: typeof surveyStamp }
    if (step.responseKind === "scale") {
      const drawn = scaleAnswers.get(step.id)
      if (drawn === undefined)
        throw new Error(`No seeded answer for question step ${step.position}`)
      value = { valueScale: drawn }
    } else {
      const result = await generate(
        [{ role: "user", content: surveyMessage(persona, step.prompt) }],
        surveyPrompt,
        AnswerOutput
      )
      if (!result?.answer.trim())
        throw new Error(
          `Answer generation failed for question step ${step.position}`
        )
      value = { valueText: result.answer.trim(), stamp: surveyStamp }
    }

    await db.transaction(async (tx) => {
      await lockPilotStep(tx, step)
      await recordResponse(tx, {
        stepId: step.id,
        userId: personaUserId,
        authorKind: "simulated",
        ...value
      })
    })
    answered++
  }
  return { answered, skipped }
}
