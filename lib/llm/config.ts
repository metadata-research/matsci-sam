import { createHash } from "node:crypto"
import { OllamaModel } from "./model"
import {
  InferenceError,
  type InferenceMetadata,
  type InferenceProvider
} from "./types"

export type InferenceConfig = Readonly<{
  provider: InferenceProvider
  profile: string
  model: string
  baseUrl: string
  tokenUrl?: string
  clientId?: string
  clientSecret?: string
  timeoutMs: number
  maxTokens: number
  metadata: Readonly<InferenceMetadata>
}>

const endpoint = (value: string | undefined, httpAllowed = false) => {
  try {
    const url = new URL(value ?? "")
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && !(httpAllowed && url.protocol === "http:"))
    )
      throw new Error()
    return url.toString().replace(/\/$/, "")
  } catch {
    throw new InferenceError("configuration")
  }
}

export const getInferenceConfig = (
  env: Record<string, string | undefined> = process.env
): InferenceConfig => {
  const provider = env.INFERENCE_PROVIDER?.trim() || "ollama"
  if (provider !== "ollama" && provider !== "openai-compatible")
    throw new InferenceError("configuration")
  const profile = env.INFERENCE_PROFILE?.trim() || provider
  const model =
    env.INFERENCE_MODEL?.trim() || (provider === "ollama" ? OllamaModel : "")
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(profile) || !model)
    throw new InferenceError("configuration")
  const timeoutMs = Number(env.INFERENCE_TIMEOUT_MS || 90000)
  const maxTokens = Number(env.INFERENCE_MAX_TOKENS || 2048)
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 300000 ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 64 ||
    maxTokens > 32768
  )
    throw new InferenceError("configuration")
  const baseUrl =
    provider === "ollama"
      ? endpoint(env.OLLAMA_HOST?.trim() || "http://127.0.0.1:11434", true)
      : endpoint(env.INFERENCE_BASE_URL?.trim())
  const tokenUrl =
    provider === "openai-compatible"
      ? endpoint(env.INFERENCE_TOKEN_URL?.trim())
      : undefined
  const clientId =
    provider === "openai-compatible"
      ? env.INFERENCE_CLIENT_ID?.trim()
      : undefined
  const clientSecret =
    provider === "openai-compatible" ? env.INFERENCE_CLIENT_SECRET : undefined
  if (provider === "openai-compatible" && (!clientId || !clientSecret?.trim()))
    throw new InferenceError("configuration")
  // Include transport/model behavior, but not rotating credentials. This also
  // prevents a resumed pilot from changing endpoint or generation options.
  const configHash = createHash("sha256")
    .update(
      JSON.stringify({
        provider,
        profile,
        model,
        baseUrl,
        tokenUrl,
        timeoutMs,
        options:
          provider === "ollama"
            ? { keep_alive: "10m", think: false }
            : {
                max_tokens: maxTokens,
                response_format: "json_schema",
                strict: true,
                stream: false
              }
      })
    )
    .digest("hex")
  return Object.freeze({
    provider,
    profile,
    model,
    baseUrl,
    tokenUrl,
    clientId,
    clientSecret,
    timeoutMs,
    maxTokens,
    metadata: Object.freeze({ provider, profile, model, configHash })
  })
}

export const assertSameInference = (
  recorded: InferenceMetadata | undefined,
  current: InferenceMetadata
) => {
  if (!recorded || recorded.configHash !== current.configHash)
    throw new Error(
      "This pilot has no matching inference configuration. Use a new rehearsal suffix; do not resume it with a different provider or model."
    )
}
