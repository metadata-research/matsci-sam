import { createHash } from "node:crypto"
import { providerReportedSources } from "../provider-reported-sources"
import type { InferenceConfig } from "./config"
import {
  InferenceError,
  type InferenceFailureDiagnostic,
  type InferenceMessage,
  type InferenceMetadata,
  type InferenceResult
} from "./types"

export const AGENT_ONE_ENDPOINT =
  "https://services.wolfram.com/api/agent-one/v1/chat/completions"
const ADAPTER_VERSION = "definition-text-v1"
const MAX_RESPONSE_BYTES = 1_048_576

export function getAgentOneConfig(
  env: Record<string, string | undefined> = process.env
): InferenceConfig {
  const apiKey = env.WOLFRAM_AGENT_ONE_API_KEY?.trim()
  const timeoutMs = Number(env.WOLFRAM_AGENT_ONE_TIMEOUT_MS || 90000)
  if (
    !apiKey ||
    /[\r\n]/.test(apiKey) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 300000
  )
    throw new InferenceError("configuration")
  const provider = "wolfram-agent-one" as const
  const profile = "agent-one"
  // This identifies the producing service, not an undisclosed underlying LLM.
  const model = "wolfram-agent-one"
  const configHash = createHash("sha256")
    .update(
      JSON.stringify({
        provider,
        profile,
        model,
        endpoint: AGENT_ONE_ENDPOINT,
        timeoutMs,
        adapter: ADAPTER_VERSION
      })
    )
    .digest("hex")
  return Object.freeze({
    provider,
    profile,
    model,
    baseUrl: AGENT_ONE_ENDPOINT,
    apiKey,
    timeoutMs,
    maxTokens: 0,
    metadata: Object.freeze({ provider, profile, model, configHash })
  })
}

/** Server-private readiness token. Never return this credential-bound digest. */
export function agentOneValidationHash(config: InferenceConfig) {
  return createHash("sha256")
    .update(JSON.stringify([config.metadata.configHash, config.apiKey]))
    .digest("hex")
}

/** Use the same provider-specific instructions for generation and provenance. */
export function agentOneDefinitionPrompt(systemPrompt: string) {
  return (
    systemPrompt.replaceAll(
      "Return only the definition field requested by the response schema.",
      "Return only the definition text."
    ) +
    "\n\nReturn the final definition as plain text, not JSON. Do not wrap it in a code block."
  )
}

/** Preserve the final answer, including source links. Exclude provider reasoning. */
export function agentOneFinalAnswer(content: string): string | undefined {
  let text = content.trim()
  if (text.startsWith("<think>")) {
    const end = text.indexOf("</think>")
    if (end < 0) return undefined
    text = text.slice(end + "</think>".length).trim()
  }
  // An incomplete or repeated reasoning block must not become contributor text.
  if (!text || text.length > 10000 || /<\/?think>/i.test(text)) return undefined
  return text
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
const identity = (value: unknown) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.: -]{0,199}$/.test(value)
    ? value
    : undefined

/** Retain only identity evidence, not thoughts, tool arguments or tool payloads. */
export function agentOneEvidence(
  data: Record<string, unknown>,
  message: Record<string, unknown>
): Partial<InferenceMetadata> {
  const toolEvidence: NonNullable<InferenceMetadata["toolEvidence"]> = []
  if (Array.isArray(message.annotations)) {
    for (const raw of message.annotations.slice(0, 100)) {
      const annotation = record(raw)
      if (
        !annotation ||
        !["wolfram_tool_request", "wolfram_tool_response"].includes(
          String(annotation.type)
        )
      )
        continue
      const detail = record(annotation[String(annotation.type)])
      if (!detail) continue
      const request = record(detail.Request)
      const tool = identity(detail.Name ?? detail.Tool ?? request?.Name)
      const requestId = identity(detail.RequestID ?? request?.RequestID)
      toolEvidence.push({
        type: String(annotation.type),
        ...(tool ? { tool } : {}),
        ...(requestId ? { requestId } : {})
      })
    }
  }
  const responseModel = identity(data.model)
  const responseId = identity(data.uuid)
  return {
    ...(responseModel ? { responseModel } : {}),
    ...(responseId ? { responseId } : {}),
    ...(toolEvidence.length ? { toolEvidence } : {})
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new InferenceError("unsupported_format")
  }
  const reader = response.body?.getReader()
  if (!reader) throw new InferenceError("unsupported_format")
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new InferenceError("unsupported_format")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
}

export async function generateAgentOne(
  config: InferenceConfig,
  messages: InferenceMessage[],
  systemPrompt: string,
  fetcher: typeof fetch = fetch
): Promise<InferenceResult<string>> {
  if (
    config.provider !== "wolfram-agent-one" ||
    !config.apiKey ||
    config.baseUrl !== AGENT_ONE_ENDPOINT
  )
    throw new InferenceError("configuration")
  const started = performance.now()
  const signal = AbortSignal.timeout(config.timeoutMs)
  let httpStatus: number | undefined
  try {
    const response = await fetcher(config.baseUrl, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: config.apiKey
      },
      body: JSON.stringify({
        messages: [
          { role: "user", content: systemPrompt },
          ...messages.map((message) => ({
            ...message,
            role: message.role === "system" ? "user" : message.role
          }))
        ],
        stream: false
      })
    })
    if (!response.ok) {
      httpStatus = response.status
      await response.body?.cancel()
      throw new InferenceError(
        response.status === 401 || response.status === 403
          ? "authentication"
          : response.status === 400 || response.status === 422
            ? "unsupported_format"
            : "unavailable",
        response.status === 429 || response.status >= 500
      )
    }
    const data = record(await readBoundedJson(response))
    if (
      !data ||
      data.success === false ||
      (typeof data.code === "number" && data.code !== 200)
    )
      throw new InferenceError("unsupported_format")
    const choices = data.choices
    if (!Array.isArray(choices) || choices.length !== 1)
      throw new InferenceError("unsupported_format")
    const choice = record(choices[0])
    const message = record(choice?.message)
    if (
      choice?.finish_reason !== "stop" ||
      !message ||
      message.refusal ||
      message.role !== "assistant" ||
      typeof message.content !== "string"
    )
      throw new InferenceError("unsupported_format")
    const answer = agentOneFinalAnswer(message.content)
    if (answer === undefined) throw new InferenceError("unsupported_format")
    return {
      output: answer,
      inference: {
        ...config.metadata,
        ...agentOneEvidence(data, message),
        reportedSources: providerReportedSources(config.metadata, answer)
      }
    }
  } catch (error) {
    const failure =
      error instanceof InferenceError
        ? error
        : new InferenceError("unavailable", true)
    const diagnostic: InferenceFailureDiagnostic = {
      provider: "wolfram-agent-one",
      category:
        httpStatus !== undefined
          ? "http"
          : signal.aborted
            ? "timeout"
            : error instanceof InferenceError
              ? "invalid_response"
              : "transport",
      elapsedMs: Math.round(performance.now() - started),
      timeoutMs: config.timeoutMs,
      ...(httpStatus !== undefined ? { httpStatus } : {})
    }
    // Log only our allowlisted fields. Provider error bodies and exception
    // messages may contain credentials, request inputs or private reasoning.
    console.warn("Agent One request failed", diagnostic)
    throw new InferenceError(failure.code, failure.retryable, diagnostic)
  }
}
