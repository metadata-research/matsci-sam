import assert from "node:assert/strict"
import { z } from "zod"
import { assertSameInference, getInferenceConfig } from "../lib/llm/config"
import { generateStructured } from "../lib/llm/generate"
import { ClientCredentialsTokens } from "../lib/llm/oauth"
import { InferenceError } from "../lib/llm/types"

const env = {
  INFERENCE_PROVIDER: "openai-compatible",
  INFERENCE_PROFILE: "research-cluster",
  INFERENCE_MODEL: "example-model",
  INFERENCE_BASE_URL: "https://inference.example.test/v1",
  INFERENCE_TOKEN_URL: "https://identity.example.test/token",
  INFERENCE_CLIENT_ID: "test-client",
  INFERENCE_CLIENT_SECRET: "dummy-secret"
}
const schema = z.object({ definition: z.string().min(1) }).strict()
const messages = [{ role: "user" as const, content: "Define austenite." }]
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
const completion = (
  content = '{"definition":"An iron phase."}',
  finish_reason = "stop"
) =>
  json({
    model: "resolved-model",
    choices: [{ finish_reason, message: { content } }]
  })
const failureCode = (code: string) => (error: unknown) => {
  assert(error instanceof InferenceError)
  assert.equal(error.code, code)
  assert(!String(error).includes("dummy-secret"))
  return true
}

async function main() {
  const original = { ...process.env }
  const config = getInferenceConfig(env)
  assert.equal(getInferenceConfig({}).model, "gemma4:26b")
  assert.equal(
    getInferenceConfig({ INFERENCE_CLIENT_SECRET: "unused" }).provider,
    "ollama"
  )
  for (const bad of [
    { INFERENCE_PROVIDER: "typo" },
    { ...env, INFERENCE_MODEL: "" },
    { ...env, INFERENCE_BASE_URL: "http://inference.example.test/v1" },
    {
      ...env,
      INFERENCE_BASE_URL: "https://user:password@inference.example.test/v1"
    },
    {
      ...env,
      INFERENCE_TOKEN_URL: "https://identity.example.test/token?secret=x"
    },
    { ...env, INFERENCE_CLIENT_SECRET: "" },
    { ...env, INFERENCE_MAX_TOKENS: "NaN" }
  ])
    assert.throws(() => getInferenceConfig(bad), failureCode("configuration"))
  assert.equal(
    config.metadata.configHash,
    getInferenceConfig({ ...env, INFERENCE_CLIENT_SECRET: "rotated" }).metadata
      .configHash
  )
  assert.notEqual(
    config.metadata.configHash,
    getInferenceConfig({ ...env, INFERENCE_MODEL: "another-model" }).metadata
      .configHash
  )
  assertSameInference(config.metadata, config.metadata)
  assert.throws(() => assertSameInference(undefined, config.metadata))
  assert.throws(() =>
    assertSameInference(getInferenceConfig({}).metadata, config.metadata)
  )

  let now = 0
  let tokenCalls = 0
  let gate: (() => void) | undefined
  const tokenFetch: typeof fetch = async (_url, init) => {
    tokenCalls++
    assert.equal(init?.redirect, "error")
    const body = init?.body as URLSearchParams
    assert.equal(body.get("grant_type"), "client_credentials")
    assert.equal(body.get("client_secret"), "dummy-secret")
    if (tokenCalls === 1)
      await new Promise<void>((resolve) => {
        gate = resolve
      })
    return json({
      access_token: `token-${tokenCalls}`,
      expires_in: 300,
      token_type: "Bearer"
    })
  }
  const tokens = new ClientCredentialsTokens(tokenFetch, () => now)
  const requests = [tokens.get(config), tokens.get(config), tokens.get(config)]
  assert.equal(tokenCalls, 1)
  gate!()
  assert.deepEqual(await Promise.all(requests), [
    "token-1",
    "token-1",
    "token-1"
  ])
  now = 269000
  assert.equal(await tokens.get(config), "token-1")
  now = 270000
  assert.equal(await tokens.get(config), "token-2")
  tokens.invalidate(config, "token-1")
  assert.equal(
    await tokens.get(config),
    "token-2",
    "a late rejection must not invalidate a newer token"
  )
  tokens.invalidate(config, "token-2")
  assert.equal(await tokens.get(config), "token-3")

  let calls = 0
  const fetcher: typeof fetch = async (url, init) => {
    calls++
    assert.equal(String(url), `${config.baseUrl}/chat/completions`)
    assert.equal(init?.redirect, "error")
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer token-3"
    )
    const body = JSON.parse(init?.body as string)
    assert.equal(body.model, "example-model")
    assert.equal(body.messages[0].role, "system")
    assert.equal(body.response_format.type, "json_schema")
    assert.equal(
      body.response_format.json_schema.schema.additionalProperties,
      false
    )
    assert.equal(body.stream, false)
    assert.equal(body.keep_alive, undefined)
    assert.equal(body.think, undefined)
    assert(!String(init?.body).includes("dummy-secret"))
    process.env.INFERENCE_MODEL = "changed-during-request"
    return completion()
  }
  const result = await generateStructured(
    config,
    messages,
    "Return a JSON definition.",
    schema,
    { fetcher, tokens }
  )
  assert.equal(calls, 1)
  assert.deepEqual(result?.output, { definition: "An iron phase." })
  assert.equal(result?.inference.model, "example-model")
  assert.equal(result?.inference.responseModel, "resolved-model")
  assert.equal(result?.inference.provider, "openai-compatible")
  assert(!JSON.stringify(result).includes("dummy-secret"))
  assert(!JSON.stringify(result).includes("https://"))
  process.env.SYSTEM_PROMPT_KEY ??= "materials-reference"
  const { makeGenerationStamp } = await import("../lib/llm/stamp")
  const stamp = makeGenerationStamp(
    "test",
    "Return a JSON definition.",
    result!.inference
  )
  assert.equal(
    stamp.model,
    "example-model",
    "publication must use the generating request's model"
  )
  assert.equal(stamp.inference?.configHash, config.metadata.configHash)

  for (const response of [
    new Response("malformed envelope"),
    completion("not-json"),
    completion('{"example":"wrong schema"}'),
    completion('{"definition":"ok"}', "length"),
    json({ choices: [{ finish_reason: "stop", message: { refusal: "No" } }] })
  ]) {
    assert.equal(
      await generateStructured(config, messages, "test", schema, {
        tokens,
        fetcher: async () => response
      }),
      undefined
    )
  }
  for (const [status, code] of [
    [400, "unsupported_format"],
    [403, "authentication"],
    [404, "model_missing"],
    [429, "unavailable"],
    [503, "unavailable"]
  ] as const) {
    await assert.rejects(
      generateStructured(config, messages, "test", schema, {
        tokens,
        fetcher: async () => new Response("dummy-secret", { status })
      }),
      failureCode(code)
    )
  }
  let retries = 0
  const before401 = tokenCalls
  const recovered = await generateStructured(config, messages, "test", schema, {
    tokens,
    fetcher: async () => (++retries === 1 ? json({}, 401) : completion())
  })
  assert(recovered)
  assert.equal(retries, 2)
  assert.equal(tokenCalls, before401 + 1)
  retries = 0
  await assert.rejects(
    generateStructured(config, messages, "test", schema, {
      tokens,
      fetcher: async () => {
        retries++
        return json({}, 401)
      }
    }),
    failureCode("authentication")
  )
  assert.equal(retries, 2, "authentication retry must be bounded")
  await assert.rejects(
    new ClientCredentialsTokens(
      async () => new Response("dummy-secret", { status: 401 })
    ).get(config),
    failureCode("authentication")
  )
  await assert.rejects(
    new ClientCredentialsTokens(async () =>
      json({ access_token: "token", expires_in: -1 })
    ).get(config),
    failureCode("authentication")
  )
  await assert.rejects(
    generateStructured(config, messages, "test", schema, {
      tokens,
      fetcher: async () => {
        throw new Error("dummy-secret")
      }
    }),
    failureCode("unavailable")
  )

  let ollamaCalls = 0
  const local = getInferenceConfig({ OLLAMA_HOST: "http://localhost:11434" })
  const localResult = await generateStructured(
    local,
    messages,
    "test",
    schema,
    {
      fetcher: async (_url, init) => {
        ollamaCalls++
        const body = JSON.parse(init?.body as string)
        assert.equal(body.model, "gemma4:26b")
        assert.equal(body.keep_alive, "10m")
        assert.equal(body.think, false)
        assert.equal(body.format.type, "object")
        assert.equal(new Headers(init?.headers).get("Authorization"), null)
        return json({
          model: "gemma4:26b",
          message: {
            role: "assistant",
            content: '{"definition":"Local result."}'
          },
          done: true
        })
      }
    }
  )
  assert.equal(ollamaCalls, 1)
  assert.equal(localResult?.output.definition, "Local result.")
  assert.equal(localResult?.inference.provider, "ollama")
  for (const key of Object.keys(process.env))
    if (!(key in original)) delete process.env[key]
  Object.assign(process.env, original)
  console.log(
    "Inference provider, schema, provenance, token lifecycle, retry, and pilot pin checks passed."
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
