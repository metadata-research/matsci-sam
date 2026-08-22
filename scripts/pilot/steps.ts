/*
 * The protocol steps the driver can perform.
 *
 * Implemented now: the persona define step and the AI-definition step, which
 * need nothing beyond what the application already exposes. The comment,
 * vote, rebuttal and walkthrough-progress steps depend on the service-layer
 * contract frozen with migrations 0040 and 0041 (an explicit actor kind on a
 * comment insert and a vote cast, and step completions); each throws until
 * that lands, so a rehearsal cannot silently run a protocol the record
 * cannot yet express.
 */

import { and, eq, isNull } from "drizzle-orm"
import { db, definitionsTable, usersTable } from "../../drizzle"
import { upsertAIDefinitionRecord } from "../../lib/crud"
import { createDefinitionWithInitialRevision } from "../../lib/definition-revisions"
import { DefinitionOutput, runLLM } from "../../lib/llm/client"
import { LLMSystemPrompt } from "../../lib/llm/prompts"
import type { PilotTerm } from "./terms"
import { defineMessage, definePrompt, defineStamp } from "./prompts"

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

const contractPending = (step: string) => {
  throw new Error(
    `The ${step} step needs the 0040/0041 service-layer contract (comment and vote writes with an explicit actor kind, and step completions). Frozen 2026-08-26 per MTSR-PILOT-PLAN.md.`
  )
}

export const commentStep = async () => contractPending("comment")
export const voteStep = async () => contractPending("vote")
export const rebuttalStep = async () => contractPending("rebuttal")
export const walkthroughProgressStep = async () =>
  contractPending("walkthrough-progress")
