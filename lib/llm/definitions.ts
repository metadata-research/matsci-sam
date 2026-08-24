import "server-only"

import {
  chatsTable,
  db,
  definitionsTable,
  termsTable,
  usersTable
} from "@yamz/db"
import { and, asc, eq, isNull } from "drizzle-orm"
import { UpsertAIDefinition } from "../crud"
import { runLLM } from "./client"
import { OllamaModel } from "./model"
import { LLMSystemPrompt } from "./prompts"
import { generationStamp } from "./stamp"
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
