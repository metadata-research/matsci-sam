import { Ollama } from "ollama"
import { getInferenceConfig } from "./config"
import { inferenceTokens } from "./oauth"
import { InferenceError } from "./types"

export type InferenceHealth = {
  status:
    | "ready"
    | "not_configured"
    | "misconfigured"
    | "unreachable"
    | "authentication_failed"
    | "model_missing"
  checkedAt: string
  profile?: string
  provider?: string
  model?: { name: string; family?: string; parameterSize?: string }
}

export const getInferenceHealth = async (
  timeoutMs = 3000,
  env: Record<string, string | undefined> = process.env
): Promise<InferenceHealth> => {
  const checkedAt = new Date().toISOString()
  const provider = env.INFERENCE_PROVIDER?.trim() || "ollama"
  if (provider === "ollama" && !env.OLLAMA_HOST?.trim())
    return { status: "not_configured", checkedAt, provider }
  let config
  try {
    config = getInferenceConfig(env)
  } catch {
    return { status: "misconfigured", checkedAt }
  }
  const base = {
    checkedAt,
    profile: config.profile,
    provider: config.provider,
    model: { name: config.model }
  }
  try {
    const signal = AbortSignal.timeout(timeoutMs)
    if (config.provider === "ollama") {
      const client = new Ollama({
        host: config.baseUrl,
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal,
            redirect: "error",
            cache: "no-store"
          })
      })
      const model = await client.show({ model: config.model })
      return {
        ...base,
        status: "ready",
        model: {
          name: config.model,
          family: model.details.family,
          parameterSize: model.details.parameter_size
        }
      }
    }
    const token = await inferenceTokens.get({ ...config, timeoutMs })
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
      redirect: "error",
      cache: "no-store"
    })
    if (response.status === 401 || response.status === 403) {
      inferenceTokens.invalidate(config, token)
      return { ...base, status: "authentication_failed" }
    }
    if (!response.ok) return { ...base, status: "unreachable" }
    const data = await response.json()
    if (
      !Array.isArray(data?.data) ||
      !data.data.some((model: { id?: string }) => model?.id === config.model)
    )
      return { ...base, status: "model_missing" }
    return { ...base, status: "ready", model: { name: config.model } }
  } catch (error) {
    return {
      ...base,
      status:
        error instanceof InferenceError && error.code === "authentication"
          ? "authentication_failed"
          : "unreachable"
    }
  }
}

// The alternate has its own settings: never borrow the active model, transport,
// or credentials, and never mutate process.env to perform a readiness check.
const alternateSettings = [
  "PROVIDER",
  "PROFILE",
  "MODEL",
  "BASE_URL",
  "TOKEN_URL",
  "CLIENT_ID",
  "CLIENT_SECRET",
  "TIMEOUT_MS",
  "MAX_TOKENS",
  "OLLAMA_HOST"
] as const

const getAlternateInferenceHealth = (
  timeoutMs: number,
  env: Record<string, string | undefined>
): Promise<InferenceHealth> => {
  const checkedAt = new Date().toISOString()
  if (
    !alternateSettings.some((key) => env[`INFERENCE_ALTERNATE_${key}`]?.trim())
  )
    return Promise.resolve({ status: "not_configured", checkedAt })
  if (!env.INFERENCE_ALTERNATE_PROVIDER?.trim())
    return Promise.resolve({ status: "misconfigured", checkedAt })
  const alternateEnv = Object.fromEntries(
    alternateSettings.map((key) => [
      key === "OLLAMA_HOST" ? key : `INFERENCE_${key}`,
      env[`INFERENCE_ALTERNATE_${key}`]
    ])
  )
  return getInferenceHealth(timeoutMs, alternateEnv)
}

export const getInferenceEndpointsHealth = async (
  timeoutMs = 3000,
  env: Record<string, string | undefined> = process.env
) => {
  const snapshot = { ...env }
  const [active, alternate] = await Promise.all([
    getInferenceHealth(timeoutMs, snapshot),
    getAlternateInferenceHealth(timeoutMs, snapshot)
  ])
  return { active, alternate }
}
