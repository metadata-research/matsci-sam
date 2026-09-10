import { Ollama } from "ollama"
import { z } from "zod"
import zodToJsonSchema from "zod-to-json-schema"
import type { InferenceConfig } from "./config"
import { ClientCredentialsTokens, inferenceTokens } from "./oauth"
import {
  InferenceError,
  type InferenceMessage,
  type InferenceResult
} from "./types"

export const generateStructured = async <T extends z.ZodTypeAny>(
  config: InferenceConfig,
  messages: InferenceMessage[],
  systemPrompt: string,
  schema: T,
  dependencies: {
    fetcher?: typeof fetch
    tokens?: ClientCredentialsTokens
  } = {}
): Promise<InferenceResult<z.infer<T>> | undefined> => {
  const fetcher = dependencies.fetcher ?? fetch
  const tokens = dependencies.tokens ?? inferenceTokens
  const signal = AbortSignal.timeout(config.timeoutMs)
  const conversation = [{ role: "system", content: systemPrompt }, ...messages]
  let content: unknown
  let responseModel: string | undefined
  try {
    if (config.provider === "ollama") {
      const client = new Ollama({
        host: config.baseUrl,
        fetch: (input, init) =>
          fetcher(input, {
            ...init,
            signal,
            redirect: "error",
            cache: "no-store"
          })
      })
      const response = await client.chat({
        model: config.model,
        messages: conversation,
        format: zodToJsonSchema(schema),
        keep_alive: "10m",
        think: false,
        stream: false
      })
      content = response.message.content
      responseModel = response.model
    } else {
      const body = JSON.stringify({
        model: config.model,
        messages: conversation,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "structured_response",
            strict: true,
            schema: zodToJsonSchema(schema)
          }
        },
        max_tokens: config.maxTokens,
        stream: false
      })
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = await tokens.get(config)
        const response = await fetcher(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          signal,
          redirect: "error",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`
          },
          body
        })
        if (response.status === 401 && attempt === 0) {
          tokens.invalidate(config, token)
          continue
        }
        if (!response.ok)
          throw new InferenceError(
            response.status === 401 || response.status === 403
              ? "authentication"
              : response.status === 404
                ? "model_missing"
                : response.status === 400 || response.status === 422
                  ? "unsupported_format"
                  : "unavailable",
            response.status === 429 || response.status >= 500
          )
        const data = await response.json().catch(() => null)
        const choice = data?.choices?.[0]
        if (
          !choice ||
          choice.finish_reason !== "stop" ||
          choice.message?.refusal
        )
          return undefined
        content = choice.message?.content
        responseModel = typeof data.model === "string" ? data.model : undefined
        break
      }
    }
  } catch (error) {
    if (error instanceof InferenceError) throw error
    throw new InferenceError("unavailable", true)
  }
  try {
    if (typeof content !== "string") return undefined
    const output = schema.parse(JSON.parse(content))
    return {
      output,
      inference: {
        ...config.metadata,
        ...(responseModel ? { responseModel } : {})
      }
    }
  } catch {
    // Never log raw model responses; they can contain private contributor input.
    return undefined
  }
}
