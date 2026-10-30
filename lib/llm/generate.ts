import { generateAgentOne } from "./agent-one"
import { Ollama } from "ollama"
import { z } from "zod"
import zodToJsonSchema from "zod-to-json-schema"
import type { InferenceConfig } from "./config"
import { ClientCredentialsTokens, inferenceTokens } from "./oauth"
import { ollamaResponseSchema } from "./ollama-response-schema"
import {
  InferenceError,
  type InferenceFailureDiagnostic,
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
  if (config.provider === "wolfram-agent-one") {
    const result = await generateAgentOne(
      config,
      messages,
      systemPrompt,
      fetcher
    )
    if (!result) return undefined
    // SAM uses a definition field internally. Agent One returns ordinary text.
    const parsed = schema.safeParse({ definition: result.output })
    return parsed.success
      ? { output: parsed.data, inference: result.inference }
      : undefined
  }
  const tokens = dependencies.tokens ?? inferenceTokens
  const started = performance.now()
  const signal = AbortSignal.timeout(config.timeoutMs)
  const conversation = [{ role: "system", content: systemPrompt }, ...messages]
  let content: unknown
  let responseModel: string | undefined
  let httpStatus: number | undefined
  try {
    if (config.provider === "ollama") {
      const client = new Ollama({
        host: config.baseUrl,
        fetch: async (input, init) => {
          const response = await fetcher(input, {
            ...init,
            signal,
            redirect: "error",
            cache: "no-store"
          })
          if (!response.ok) {
            httpStatus = response.status
            await response.body?.cancel()
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
          }
          return response
        }
      })
      const response = await client.chat({
        model: config.model,
        messages: conversation,
        format: ollamaResponseSchema(schema),
        keep_alive: "10m",
        think: false,
        options: { num_predict: config.maxTokens },
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
    const failure =
      error instanceof InferenceError
        ? error
        : new InferenceError("unavailable", true)
    if (config.provider === "ollama") {
      const diagnostic: InferenceFailureDiagnostic = {
        provider: "ollama",
        category:
          httpStatus !== undefined
            ? "http"
            : signal.aborted
              ? "timeout"
              : "transport",
        elapsedMs: Math.round(performance.now() - started),
        timeoutMs: config.timeoutMs,
        ...(httpStatus !== undefined ? { httpStatus } : {})
      }
      // Provider bodies, prompts and raw errors may contain private source text.
      console.warn("Ollama request failed", diagnostic)
      throw new InferenceError(failure.code, failure.retryable, diagnostic)
    }
    throw failure
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
    // Never log raw model responses. They can contain private contributor input.
    return undefined
  }
}
