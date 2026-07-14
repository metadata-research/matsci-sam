import { chatsTable, db } from "@yamz/db"
import { asc, eq } from "drizzle-orm"
import { Message, Ollama } from "ollama"
import { z } from "zod"
import zodToJsonSchema from "zod-to-json-schema"
import { UpsertAIDefinition } from "../crud"

type DefinitionOutput = z.infer<typeof DefinitionOutput>
const DefinitionOutput = z.object({
  definition: z.string(),
  example: z.string()
})

export const LLMSystemPrompt = process.env.SYSTEM_PROMPT!

export const OllamaModel = "gemma4:26b"

export const ollama = new Ollama({
  host: process.env.OLLAMA_HOST
})

export const runLLM = async (messages: Message[]) => {
  const res = await ollama.chat({
    model: OllamaModel,
    messages: [{ role: "system", content: LLMSystemPrompt }, ...messages],
    format: zodToJsonSchema(DefinitionOutput),
    // Make's sure model doesn't stop running until 5 seconds after our last request
    keep_alive: 5,
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

  await UpsertAIDefinition(termId, result)

  const [insertedChat] = await db
    .insert(chatsTable)
    .values({
      role: "system",
      message: `<definition>\n${result?.definition}\n\n<example>\n${result.example}`,
      termId
    })
    .returning()

  return { result, insertedChat }
}
