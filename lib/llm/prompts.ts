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

// Prompt for the interactive refine flow; REFINE_PROMPT_KEY overrides the
// default "refine" entry in lib/prompts.json.
export const RefinePromptKey = process.env.REFINE_PROMPT_KEY ?? "refine"
export const RefineSystemPrompt = resolvePromptKey(RefinePromptKey)
