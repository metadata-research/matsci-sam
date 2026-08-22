/*
 * The protocol steps the driver can perform, one act per function, every
 * act an ordinary application write through the same lib/ paths the routers
 * call. Simulated acts are marked simulated and stamped; the AI alternate
 * definition stays a model act under the registered identity, as in the
 * 2025 study. An act taken for a step of the walkthrough names that step
 * and completes it in the transaction of the act, as the routers do, so the
 * record of the cohort reads as the walkthrough pages would have written it.
 */

import { and, asc, eq, isNull, ne } from "drizzle-orm"
import { commentsTable, db, definitionsTable, usersTable } from "../../drizzle"
import { upsertAIDefinitionRecord } from "../../lib/crud"
import { createDefinitionWithInitialRevision } from "../../lib/definition-revisions"
import { DefinitionOutput, runLLM } from "../../lib/llm/client"
import { LLMSystemPrompt } from "../../lib/llm/prompts"
import { castVote, insertComment } from "../../lib/participation"
import { recordResponse, responseOf } from "../../lib/survey-queries"
import { recordCompletion } from "../../lib/surveys"
import type { Walkthrough } from "./db"
import type { PilotTerm } from "./terms"
import {
  commentMessage,
  commentPrompt,
  commentStamp,
  defineMessage,
  definePrompt,
  defineStamp,
  rebuttalMessage,
  rebuttalPrompt,
  rebuttalStamp,
  surveyMessage,
  surveyPrompt,
  surveyStamp
} from "./prompts"
import { z } from "zod"

const CommentOutput = z.object({ comment: z.string() })
const AnswerOutput = z.object({ answer: z.string() })

// The step an act is taken for: the define step of the term for a
// definition, the review step of the term for a comment or a vote.
type StepRef = { id: number }

const originalDefinition = (authorId: number, termId: number) =>
  db.query.definitionsTable.findFirst({
    where: and(
      eq(definitionsTable.authorId, authorId),
      eq(definitionsTable.termId, termId),
      isNull(definitionsTable.refinedFromId)
    )
  })

/*
 * One persona defines one assigned term: generate in the persona's voice,
 * then write the ordinary initial definition under the persona account,
 * with the define step of the term on its initial revision and the
 * completion of that step in the same transaction, as definitions.create
 * writes it. The source is ai_generation and the row is stamped, because
 * the text is model output however participant-shaped its role in the
 * protocol is.
 */
export const defineStep = async (
  persona: { voice: string },
  personaUserId: number,
  termId: number,
  term: PilotTerm,
  step: StepRef
) => {
  const existing = await originalDefinition(personaUserId, termId)
  if (existing) {
    // The definition stands, which is the gate of the step, so the
    // completion stands with it; recording it again is not an error.
    await recordCompletion(db, { stepId: step.id, userId: personaUserId })
    return { skipped: true as const }
  }

  const result = await runLLM(
    [{ role: "user", content: defineMessage(persona, term) }],
    definePrompt
  )
  if (!result) throw new Error(`Define generation failed for ${term.term}`)

  const written = await db.transaction(async (tx) => {
    const created = await createDefinitionWithInitialRevision(tx, {
      termId,
      authorId: personaUserId,
      definition: result.definition,
      example: result.example,
      changeNote: "Initial definition, simulated participant",
      source: "ai_generation",
      model: defineStamp.model,
      prompt: defineStamp.promptText,
      surveyStepId: step.id
    })
    await recordCompletion(tx, { stepId: step.id, userId: personaUserId })
    return created
  })
  return { skipped: false as const, definitionId: written.definition.id }
}

/*
 * The AI alternate definition, as the 2025 protocol ran it: one definition
 * per term, generated from the participant's definition and example, under
 * the registered model identity. Mirrors the term-creation flow, which never
 * fires for pre-seeded study terms.
 */
export const aiDefinitionStep = async (
  termId: number,
  termLabel: string
) => {
  const [participant] = await db
    .select({
      definition: definitionsTable.definition,
      example: definitionsTable.example
    })
    .from(definitionsTable)
    .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
    .where(
      and(
        eq(definitionsTable.termId, termId),
        eq(usersTable.isAi, true),
        isNull(definitionsTable.refinedFromId)
      )
    )
    .limit(1)
  if (!participant)
    throw new Error(`No participant definition to generate from for ${termLabel}`)

  const result = await runLLM(
    [
      {
        role: "user",
        content: `<term>\n${termLabel}\n\n<definition>\n${participant.definition}\n\n<example>\n${participant.example}`
      }
    ],
    LLMSystemPrompt,
    DefinitionOutput
  )
  if (!result) throw new Error(`AI generation failed for ${termLabel}`)

  const written = await upsertAIDefinitionRecord(termId, result, {
    model: defineStamp.model,
    prompt: LLMSystemPrompt
  })
  return { definitionId: written.definition.id }
}

// The definitions of one term as review targets: id, current revision, and
// the text a reviewer reads.
export const reviewTargets = (termId: number) =>
  db
    .select({
      id: definitionsTable.id,
      currentRevisionId: definitionsTable.currentRevisionId,
      authorId: definitionsTable.authorId,
      authorName: usersTable.name,
      definition: definitionsTable.definition,
      example: definitionsTable.example
    })
    .from(definitionsTable)
    .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
    .where(
      and(eq(definitionsTable.termId, termId), isNull(definitionsTable.refinedFromId))
    )
    .orderBy(asc(definitionsTable.id))

type ReviewTarget = Awaited<ReturnType<typeof reviewTargets>>[number]

// What others said about one definition, for the rebuttal.
export const commentsByOthers = (definitionId: number, notUserId: number) =>
  db
    .select({ message: commentsTable.message })
    .from(commentsTable)
    .where(
      and(
        eq(commentsTable.definitionId, definitionId),
        ne(commentsTable.userId, notUserId)
      )
    )
    .orderBy(asc(commentsTable.id))

/*
 * One review comment by one persona on one definition: generate in the
 * persona's voice, then post it as a simulated act with the registered
 * stamp, against the definition's current revision, from the review step
 * of the term. The comment names the step and completes it; a review step
 * completes on the press, so the first act in it is the press.
 */
export const commentAct = async (
  persona: { voice: string },
  personaUserId: number,
  termLabel: string,
  target: ReviewTarget,
  step: StepRef
) => {
  if (!target.currentRevisionId)
    throw new Error(`No current revision to comment on for ${termLabel}`)
  const result = await runLLM(
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

  return await db.transaction(async (tx) => {
    const posted = await insertComment(tx, {
      definitionId: target.id,
      revisionId: target.currentRevisionId!,
      userId: personaUserId,
      message: result.comment,
      actorKind: "simulated",
      stamp: commentStamp,
      surveyStepId: step.id
    })
    await recordCompletion(tx, { stepId: step.id, userId: personaUserId })
    return posted
  })
}

/*
 * One voting act by one persona, in the pilot community's context and from
 * the review step of the term, which the act names and completes. The
 * choice arrives from the seeded structure in the orchestrator, so a
 * rehearsal repeats its shape.
 */
export const voteAct = async (
  personaUserId: number,
  target: ReviewTarget,
  vote: "up" | "down",
  communityId: number,
  step: StepRef
) => {
  if (!target.currentRevisionId)
    throw new Error(`No current revision to vote on for definition ${target.id}`)
  return await db.transaction(async (tx) => {
    const tallied = await castVote(tx, {
      definitionId: target.id,
      revisionId: target.currentRevisionId!,
      userId: personaUserId,
      vote,
      actorKind: "simulated",
      communityId,
      surveyStepId: step.id
    })
    await recordCompletion(tx, { stepId: step.id, userId: personaUserId })
    return tallied
  })
}

/*
 * The rebuttal, as the 2024 protocol ran it: the author answers the
 * comments others left on their definition, once, as one reply comment on
 * their own definition.
 */
export const rebuttalAct = async (
  persona: { voice: string },
  personaUserId: number,
  termLabel: string,
  own: ReviewTarget,
  commentsByOthers: string[]
) => {
  if (!own.currentRevisionId)
    throw new Error(`No current revision for the rebuttal on ${termLabel}`)
  if (commentsByOthers.length === 0) return { skipped: true as const }

  const result = await runLLM(
    [
      {
        role: "user",
        content: rebuttalMessage(
          persona,
          termLabel,
          own.definition,
          commentsByOthers
        )
      }
    ],
    rebuttalPrompt,
    CommentOutput
  )
  if (!result) throw new Error(`Rebuttal generation failed for ${termLabel}`)

  await db.transaction((tx) =>
    insertComment(tx, {
      definitionId: own.id,
      revisionId: own.currentRevisionId!,
      userId: personaUserId,
      message: result.comment,
      actorKind: "simulated",
      stamp: rebuttalStamp
    })
  )
  return { skipped: false as const }
}

/*
 * One persona walks the steps no act of the protocol completes: the
 * instructions, pressed through, and each closing question, answered as a
 * simulated act. A scale answer arrives from the seeded structure; a text
 * answer is generated in the persona's voice under the survey prompt. The
 * answer and the completion are one transaction, the pairing the invariants
 * require of a response. The define steps of the terms the persona was not
 * assigned stay open: their gate is the persona's own definition, which the
 * protocol does not ask for.
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
    await recordCompletion(db, { stepId: step.id, userId: personaUserId })

  let answered = 0
  let skipped = 0
  for (const step of walkthrough.questions) {
    if (await responseOf(db, step.id, personaUserId)) {
      skipped++
      continue
    }
    if (!step.prompt)
      throw new Error(`Question step ${step.position} has no prompt`)

    let value: { valueScale: number } | { valueText: string }
    if (step.responseKind === "scale") {
      const drawn = scaleAnswers.get(step.id)
      if (drawn === undefined)
        throw new Error(`No seeded answer for question step ${step.position}`)
      value = { valueScale: drawn }
    } else {
      const result = await runLLM(
        [{ role: "user", content: surveyMessage(persona, step.prompt) }],
        surveyPrompt,
        AnswerOutput
      )
      if (!result?.answer.trim())
        throw new Error(
          `Answer generation failed for question step ${step.position}`
        )
      value = { valueText: result.answer.trim() }
    }

    await db.transaction((tx) =>
      recordResponse(tx, {
        stepId: step.id,
        userId: personaUserId,
        authorKind: "simulated",
        ...value
      })
    )
    answered++
  }
  return { answered, skipped, stamp: surveyStamp }
}
