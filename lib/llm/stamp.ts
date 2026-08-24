import { createHash } from "node:crypto"
import { OllamaModel } from "./model"
import {
  LLMSystemPrompt,
  NewTermPromptKey,
  NewTermSystemPrompt,
  RefinePromptKey,
  RefineSystemPrompt,
  RevisionSuggestionPromptKey,
  RevisionSuggestionSystemPrompt
} from "./prompts"

// Provenance stamp written on every AI-generated row (chats, refinement
// rounds) so each generation stays attributable to the exact prompt and model
// that produced it. promptHash covers edits to prompts.json under an
// unchanged key and raw SYSTEM_PROMPT text (where promptKey is null).
export const makeGenerationStamp = (
  promptKey: string | null,
  promptText: string
) => ({
  promptKey,
  promptHash: createHash("sha256")
    .update(promptText)
    .digest("hex")
    .slice(0, 16),
  promptText,
  model: OllamaModel
})

export const generationStamp = makeGenerationStamp(
  process.env.SYSTEM_PROMPT ? null : (process.env.SYSTEM_PROMPT_KEY ?? null),
  LLMSystemPrompt
)

export const refineGenerationStamp = makeGenerationStamp(
  RefinePromptKey,
  RefineSystemPrompt
)

export const newTermGenerationStamp = makeGenerationStamp(
  NewTermPromptKey,
  NewTermSystemPrompt
)

export const revisionSuggestionGenerationStamp = makeGenerationStamp(
  RevisionSuggestionPromptKey,
  RevisionSuggestionSystemPrompt
)
