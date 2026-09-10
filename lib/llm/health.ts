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
  timeoutMs = 3000
): Promise<InferenceHealth> => {
  const checkedAt = new Date().toISOString()
  if (
    (!process.env.INFERENCE_PROVIDER ||
      process.env.INFERENCE_PROVIDER === "ollama") &&
    !process.env.OLLAMA_HOST?.trim()
  )
    return { status: "not_configured", checkedAt }
  let config
  try {
    config = getInferenceConfig()
  } catch {
    return { status: "misconfigured", checkedAt }
  }
  const base = { checkedAt, profile: config.profile, provider: config.provider }
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
