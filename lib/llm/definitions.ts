import "server-only"

import {
  chatsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  refinementsTable,
  termsTable,
  usersTable
} from "@yamz/db"
import { and, asc, eq, getTableColumns, isNull, lt, sql } from "drizzle-orm"
import { Message } from "ollama"
import { UpsertAIDefinition } from "../crud"
import { diffToStringSimple } from "../definition-revisions"
import { runLLM } from "./client"
import { OllamaModel } from "./model"
import { LLMSystemPrompt, RefineSystemPrompt } from "./prompts"
import { generationStamp, refineGenerationStamp } from "./stamp"
import {
  buildRevisionMessages,
  needsReconstructedDefinitionContext
} from "./revision-context"

export const reviseDefinition = async (termId: number) => {
  const chats = await db.query.chatsTable.findMany({
    where: eq(chatsTable.termId, termId),
    orderBy: asc(chatsTable.createdAt)
  })

  const lastChat = chats[chats.length - 1]
  if (!lastChat) throw new Error("No user request is waiting for AI generation")
  if (lastChat.role !== "user")
    throw new Error("The latest user request already has an AI response")

  // EGO_SEED_CHAT_FALLBACK: the one-time public seed deliberately removes
  // private term chat transcripts, so a later public feedback thread may
  // begin without the original term context.
  let reconstructedContext
  if (needsReconstructedDefinitionContext(chats)) {
    const [currentAI] = await db
      .select({
        term: termsTable.term,
        definition: definitionsTable.definition,
        example: definitionsTable.example
      })
      .from(termsTable)
      .innerJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
      .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
      .where(
        and(
          eq(termsTable.id, termId),
          eq(usersTable.isAi, true),
          isNull(usersTable.name),
          isNull(definitionsTable.refinedFromId)
        )
      )
      .orderBy(asc(definitionsTable.id))
      .limit(1)

    reconstructedContext = currentAI
  }

  const result = await runLLM(
    buildRevisionMessages(chats, reconstructedContext)
  )
  if (!result) throw new Error("Something went wrong")

  await UpsertAIDefinition(termId, result, {
    model: OllamaModel,
    prompt: LLMSystemPrompt
  })

  const [insertedChat] = await db
    .insert(chatsTable)
    .values({
      role: "system",
      message: `<definition>\n${result?.definition}\n\n<example>\n${result.example}`,
      termId,
      ...generationStamp
    })
    .returning()

  return { result, insertedChat }
}

// Drives one interactive refinement round from "pending" to "suggested" (or
// "failed"). Context is rebuilt per call from the round's definition and the
// prior rounds of that definition — deliberately NOT from chatsTable, which
// belongs to the term-level AI definition thread.
export const runRefinementRound = async (refinementId: number) => {
  const [round] = await db
    .select({
      ...getTableColumns(refinementsTable),
      term: termsTable.term,
      currentDefinition: definitionsTable.definition,
      currentExample: definitionsTable.example,
      sourceDefinition: definitionRevisionsTable.definitionDiff,
      sourceExample: definitionRevisionsTable.exampleDiff
    })
    .from(refinementsTable)
    .innerJoin(
      definitionsTable,
      eq(definitionsTable.id, refinementsTable.definitionId)
    )
    .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .leftJoin(
      definitionRevisionsTable,
      eq(definitionRevisionsTable.id, refinementsTable.sourceRevisionId)
    )
    .where(eq(refinementsTable.id, refinementId))

  if (!round) throw new Error(`Refinement ${refinementId} doesn't exist`)
  if (round.status !== "pending")
    throw new Error(
      `Refinement ${refinementId} is "${round.status}", expected "pending"`
    )

  try {
    const priorRounds = await db.query.refinementsTable.findMany({
      where: and(
        eq(refinementsTable.definitionId, round.definitionId),
        lt(refinementsTable.round, round.round)
      ),
      orderBy: asc(refinementsTable.round)
    })

    const sourceDefinition = diffToStringSimple(round.sourceDefinition ?? [])
    const sourceExample = diffToStringSimple(round.sourceExample ?? [])
    const messages: Message[] = [
      {
        role: "user",
        content: `<term>\n${round.term}\n\n<definition>\n${sourceDefinition == "" ? round.currentDefinition : sourceDefinition}\n\n<example>\n${sourceExample == "" ? round.currentExample : sourceExample}`
      }
    ]

    // Replay the negotiation in order: each round's feedback comment came
    // before its suggestion, and failed rounds contribute their feedback but
    // no assistant turn.
    for (const r of [...priorRounds, round]) {
      if (r.userComment)
        messages.push({ role: "user", content: `<feedback>\n${r.userComment}` })

      if (r.id !== round.id && r.suggestedDefinition)
        messages.push({
          role: "assistant",
          content: `<definition>\n${r.suggestedDefinition}\n\n<example>\n${r.suggestedExample}`
        })
    }

    const result = await runLLM(messages, RefineSystemPrompt)
    if (!result) throw new Error("Model returned an invalid response")

    const [updated] = await db
      .update(refinementsTable)
      .set({
        status: "suggested",
        suggestedDefinition: result.definition,
        suggestedExample: result.example,
        suggestedAt: sql`now()`,
        ...refineGenerationStamp
      })
      .where(eq(refinementsTable.id, refinementId))
      .returning()

    return updated
  } catch (err) {
    // Persist the failure so the UI can show it explicitly (no silent
    // fallback), then rethrow for the server log.
    await db
      .update(refinementsTable)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        suggestedAt: sql`now()`
      })
      .where(eq(refinementsTable.id, refinementId))

    throw err
  }
}
