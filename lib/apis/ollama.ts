import { chatsTable, db } from "@yamz/db"
import { asc, eq } from "drizzle-orm"
import { createHash } from "node:crypto"
import { Message, Ollama } from "ollama"
import { z } from "zod"
import zodToJsonSchema from "zod-to-json-schema"
import { UpsertAIDefinition } from "../crud"
import prompts from "@/lib/prompts.json"

export type DefinitionOutput = z.infer<typeof DefinitionOutput>
export const DefinitionOutput = z.object({
  definition: z.string(),
  example: z.string()
})

// System prompt selection: SYSTEM_PROMPT_KEY picks a named prompt from
// lib/prompts.json; SYSTEM_PROMPT (raw text) still works and takes precedence
// so existing deployments are unaffected.
const resolveSystemPrompt = () => {
  if (process.env.SYSTEM_PROMPT) return process.env.SYSTEM_PROMPT

  const key = process.env.SYSTEM_PROMPT_KEY
  if (!key)
    throw new Error("Set SYSTEM_PROMPT or SYSTEM_PROMPT_KEY in the environment")

  const entry = (prompts as Record<string, { prompt: string }>)[key]
  if (!entry)
    throw new Error(
      `Unknown SYSTEM_PROMPT_KEY "${key}" — available prompts: ${Object.keys(prompts).join(", ")}`
    )

  return entry.prompt
}

export const LLMSystemPrompt = resolveSystemPrompt()

export const OllamaModel = "gemma4:26b"

// Provenance stamp written on every AI chat row so each generation stays
// attributable to the exact prompt and model that produced it. promptHash
// covers edits to prompts.json under an unchanged key and raw SYSTEM_PROMPT
// text (where promptKey is null).
export const generationStamp = {
  promptKey: process.env.SYSTEM_PROMPT
    ? null
    : (process.env.SYSTEM_PROMPT_KEY ?? null),
  promptHash: createHash("sha256")
    .update(LLMSystemPrompt)
    .digest("hex")
    .slice(0, 16),
  promptText: LLMSystemPrompt,
  model: OllamaModel
}

export const ollama = new Ollama({
  host: process.env.OLLAMA_HOST
})

export const runLLM = async (messages: Message[]) => {
  const res = await ollama.chat({
    model: OllamaModel,
    messages: [{ role: "system", content: LLMSystemPrompt }, ...messages],
    format: zodToJsonSchema(DefinitionOutput),
    // Keep the model loaded between requests — reloading gemma4:26b (~18 GB)
    // costs ~22s, which users see as the AI definition hanging
    keep_alive: "10m",
    think: false
  })

  try {
    const raw = JSON.parse(res.message.content)
    const data = DefinitionOutput.parse(raw)

    return data
  } catch (err) {
    console.log(JSON.stringify(res, null, 2))
    console.error("Model returned an invalid response", err)
  }
}

export const reviseDefinition = async (termId: number) => {
  const chats = await db.query.chatsTable.findMany({
    where: eq(chatsTable.termId, termId),
    orderBy: asc(chatsTable.createdAt)
  })

  const lastChat = chats[chats.length - 1]
  if (lastChat.role !== "user")
    throw new Error("Last message was not created by the AI") // dont run if last message was from ai

  const result = await runLLM(
    chats.map((chat) => ({ role: chat.role, content: chat.message }))
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
