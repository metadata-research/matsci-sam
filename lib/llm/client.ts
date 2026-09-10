import { z } from "zod"
import { getInferenceConfig, type InferenceConfig } from "./config"
import { generateStructured } from "./generate"
import { LLMSystemPrompt } from "./prompts"
import type { InferenceMessage } from "./types"

export type DefinitionOutput = z.infer<typeof DefinitionOutput>
export const DefinitionOutput = z.object({
  definition: z.string(),
  example: z.string()
})
export type DefinitionTextOutput = z.infer<typeof DefinitionTextOutput>
export const DefinitionTextOutput = z.object({ definition: z.string() })

// Snapshot configuration before awaiting I/O. Output and provenance come from
// the same request, including when the configured default changes meanwhile.
export const runLLM = <T extends z.ZodTypeAny = typeof DefinitionOutput>(
  messages: InferenceMessage[],
  systemPrompt: string = LLMSystemPrompt,
  schema: T = DefinitionOutput as unknown as T,
  config: InferenceConfig = getInferenceConfig()
) => generateStructured(config, messages, systemPrompt, schema)
