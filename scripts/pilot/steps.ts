/*
 * The protocol steps the driver can perform, one act per function, every
 * act an ordinary application write through the same lib/ paths the routers
 * call. Simulated acts are marked simulated and stamped; the AI alternate
 * definition stays a model act under the registered identity, as in the
 * 2025 study. The walkthrough-progress step still waits on migration 0041.
 */

import { and, asc, eq, isNull, ne } from "drizzle-orm"
import { commentsTable, db, definitionsTable, usersTable } from "../../drizzle"
import { upsertAIDefinitionRecord } from "../../lib/crud"
import { createDefinitionWithInitialRevision } from "../../lib/definition-revisions"
import { DefinitionOutput, runLLM } from "../../lib/llm/client"
import { LLMSystemPrompt } from "../../lib/llm/prompts"
import { castVote, insertComment } from "../../lib/participation"
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
  rebuttalStamp
} from "./prompts"
import { z } from "zod"

const CommentOutput = z.object({ comment: z.string() })

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
 * then write the ordinary initial definition under the persona account. The
 * source is ai_generation and the row is stamped, because the text is model
 * output however participant-shaped its role in the protocol is.
 */
export const defineStep = async (
  persona: { voice: string },
  personaUserId: number,
  termId: number,
  term: PilotTerm
) => {
  const existing = await originalDefinition(personaUserId, termId)
  if (existing) return { skipped: true as const }

  const result = await runLLM(
    [{ role: "user", content: defineMessage(persona, term) }],
    definePrompt
  )
  if (!result) throw new Error(`Define generation failed for ${term.term}`)

  const written = await db.transaction((tx) =>
    createDefinitionWithInitialRevision(tx, {
      termId,
      authorId: personaUserId,
      definition: result.definition,
      example: result.example,
      changeNote: "Initial definition, simulated participant",
      source: "ai_generation",
      model: defineStamp.model,
      prompt: defineStamp.promptText
    })
  )
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
 * stamp, against the definition's current revision.
 */
export const commentAct = async (
  persona: { voice: string },
  personaUserId: number,
  termLabel: string,
  target: ReviewTarget
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

  return await db.transaction((tx) =>
    insertComment(tx, {
      definitionId: target.id,
      revisionId: target.currentRevisionId!,
      userId: personaUserId,
      message: result.comment,
      actorKind: "simulated",
      stamp: commentStamp
    })
  )
}

/*
 * One voting act by one persona, in the pilot community's context. The
 * choice arrives from the seeded structure in the orchestrator, so a
 * rehearsal repeats its shape.
 */
export const voteAct = async (
  personaUserId: number,
  target: ReviewTarget,
  vote: "up" | "down",
  communityId: number
) => {
  if (!target.currentRevisionId)
    throw new Error(`No current revision to vote on for definition ${target.id}`)
  return await db.transaction((tx) =>
    castVote(tx, {
      definitionId: target.id,
      revisionId: target.currentRevisionId!,
      userId: personaUserId,
      vote,
      actorKind: "simulated",
      communityId
    })
  )
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

export const walkthroughProgressStep = async () => {
  throw new Error(
    "The walkthrough-progress step needs migration 0041 (survey steps and completions)."
  )
}
