import { Message, Ollama } from "ollama"
import { z } from "zod"
import zodToJsonSchema from "zod-to-json-schema"
import { OllamaModel } from "./model"
import { LLMSystemPrompt } from "./prompts"

export type DefinitionOutput = z.infer<typeof DefinitionOutput>
export const DefinitionOutput = z.object({
  definition: z.string(),
  example: z.string()
})

export const ollama = new Ollama({
  host: process.env.OLLAMA_HOST
})

// One structured-output call. The schema is a parameter so a caller can ask
// for something other than a definition; it defaults to DefinitionOutput, so
// the existing callers are unchanged. A malformed response resolves to
// undefined and every caller raises its own error; a transport failure
// propagates, deliberately, because a retry belongs to the caller that knows
// whether the work is resumable.
export const runLLM = async <T extends z.ZodTypeAny = typeof DefinitionOutput>(
  messages: Message[],
  systemPrompt: string = LLMSystemPrompt,
  schema: T = DefinitionOutput as unknown as T
): Promise<z.infer<T> | undefined> => {
  const res = await ollama.chat({
    model: OllamaModel,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    format: zodToJsonSchema(schema),
    // Keep the model loaded between requests — reloading gemma4:26b (~18 GB)
    // costs ~22s, which users see as the AI definition hanging
    keep_alive: "10m",
    think: false
  })

  try {
    const raw = JSON.parse(res.message.content)
    const data = schema.parse(raw)

    return data
  } catch (err) {
    console.log(JSON.stringify(res, null, 2))
    console.error("Model returned an invalid response", err)
  }
}
