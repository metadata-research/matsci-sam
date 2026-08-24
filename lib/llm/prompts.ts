import prompts from "@/lib/prompts.json"

const resolvePromptKey = (key: string) => {
  const entry = (prompts as Record<string, { prompt: string }>)[key]
  if (!entry)
    throw new Error(
      `Unknown prompt key "${key}" — available prompts: ${Object.keys(prompts).join(", ")}`
    )

  return entry.prompt
}

// System prompt selection: SYSTEM_PROMPT_KEY picks a named prompt from
// lib/prompts.json; SYSTEM_PROMPT (raw text) still works and takes precedence
// so existing deployments are unaffected.
const resolveSystemPrompt = () => {
  if (process.env.SYSTEM_PROMPT) return process.env.SYSTEM_PROMPT

  const key = process.env.SYSTEM_PROMPT_KEY
  if (!key)
    throw new Error("Set SYSTEM_PROMPT or SYSTEM_PROMPT_KEY in the environment")

  return resolvePromptKey(key)
}

export const LLMSystemPrompt = resolveSystemPrompt()

// The explicit pre-publication suggestion in the canonical New term action.
// It deliberately returns definition text only: examples have their own
// contribution lifecycle and are never smuggled in through this action.
export const NewTermPromptKey =
  process.env.NEW_TERM_PROMPT_KEY ?? "new-term-suggestion"
export const NewTermSystemPrompt = resolvePromptKey(NewTermPromptKey)

// The explicit critique-driven suggestion in the canonical Revise action.
// Like New term, it returns definition text only; examples are independent.
export const RevisionSuggestionPromptKey =
  process.env.REVISION_SUGGESTION_PROMPT_KEY ?? "revision-suggestion"
export const RevisionSuggestionSystemPrompt = resolvePromptKey(
  RevisionSuggestionPromptKey
)
