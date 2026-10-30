import "server-only"
import { z } from "zod"
import { withInferenceBudget } from "../inference-admission"
import type { InferenceConfig } from "./config"
import type { InferenceMessage } from "./types"
import { generateStructured } from "./generate"

// Web requests pass the authenticated actor, never an ID supplied in input.
// Operator-only CLI diagnostics/pilots use the raw transport separately.
export const generateForUser = <T extends z.ZodTypeAny>(
  userId: number,
  config: InferenceConfig,
  messages: InferenceMessage[],
  systemPrompt: string,
  schema: T
) =>
  withInferenceBudget(userId, config.timeoutMs, () =>
    generateStructured(config, messages, systemPrompt, schema)
  )
