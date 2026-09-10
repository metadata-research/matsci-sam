import { z } from "zod"
import { getInferenceConfig } from "./config"
import { generateStructured } from "./generate"
import { LLMSystemPrompt } from "./prompts"
import { InferenceError, type InferenceMetadata } from "./types"
import type { InferenceTestInput } from "./test-options"

export function getInferenceTestConfiguration() {
  try {
    const config = getInferenceConfig()
    return {
      status: "configured" as const,
      inference: config.metadata,
      timeoutMs: config.timeoutMs
    }
  } catch {
    return { status: "misconfigured" as const }
  }
}

// The browser supplies only a bounded prompt and a schema preset. Provider,
// endpoints, credentials, and generation options always come from the server.
// This diagnostic deliberately writes no contribution or graph records.
export async function testInference(input: InferenceTestInput) {
  const started = performance.now()
  const testedAt = new Date().toISOString()
  let inference: InferenceMetadata | undefined
  const context = () => ({
    ...input,
    testedAt,
    elapsedMs: Math.round(performance.now() - started),
    inference
  })
  try {
    const config = getInferenceConfig()
    inference = config.metadata
    const messages = [{ role: "user" as const, content: input.prompt }]
    const result =
      input.mode === "definition"
        ? await generateStructured(
            config,
            messages,
            LLMSystemPrompt,
            z.object({
              definition: z.string().min(1),
              example: z.string().min(1)
            })
          )
        : await generateStructured(
            config,
            messages,
            'Answer the user concisely. Return JSON with one nonempty string field named "answer".',
            z.object({ answer: z.string().min(1) })
          )
    if (!result)
      return {
        ...context(),
        status: "failed" as const,
        message:
          "The model did not return a complete response matching the selected JSON schema. Try a shorter prompt or review the model's structured-output support."
      }
    return {
      ...context(),
      status: "passed" as const,
      inference: result.inference,
      output: result.output
    }
  } catch (error) {
    return {
      ...context(),
      status: "failed" as const,
      message:
        error instanceof InferenceError
          ? error.message
          : "The inference test could not complete. Check service health and try again."
    }
  }
}
