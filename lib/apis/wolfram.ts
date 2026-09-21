import "server-only"
import { generateAgentOne, getAgentOneConfig } from "../llm/agent-one"
import { InferenceError } from "../llm/types"

// The Agent One credential is deliberately distinct from the CAG lookup key.
export const wolframConfigured = () =>
  Boolean(process.env.WOLFRAM_AGENT_ONE_API_KEY?.trim())
export const wolframMaskedKey = () => {
  const key = process.env.WOLFRAM_AGENT_ONE_API_KEY?.trim()
  return key ? `****${key.slice(-4)}` : null
}
export type WolframMessage = { role: "user" | "assistant"; content: string }

// Legacy administrative sandbox. Readiness for contribution requests is tested
// separately against the actual definition contract in definitionAssistants.
export const wolframQuery = async (
  message: string,
  history: WolframMessage[] = []
) => {
  const config = getAgentOneConfig()
  const result = await generateAgentOne(
    config,
    [...history, { role: "user", content: message }],
    "Answer the user concisely in plain text. Do not wrap the answer in JSON or a code block."
  )
  if (!result) throw new InferenceError("unsupported_format")
  return result.output
}
