import assert from "node:assert/strict"
import { z } from "zod"
import { assertSameInference, getInferenceConfig } from "../lib/llm/config"
import { generateStructured } from "../lib/llm/generate"
import { ClientCredentialsTokens } from "../lib/llm/oauth"
import { InferenceError } from "../lib/llm/types"
import {
  newTermPromptInputs,
  revisionUserPrompt
} from "../lib/model-prompt-inputs"
import { ollamaResponseSchema } from "../lib/llm/ollama-response-schema"
import zodToJsonSchema from "zod-to-json-schema"

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
        assert.equal(body.options.num_predict, local.maxTokens)
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

  // Exercise the actual strict schema shared by new-term and revision actions,
  // rather than a looser administrator probe or a test-only output shape.
  const { DefinitionTextOutput } = await import("../lib/llm/client")
  const { NewTermSystemPrompt, RevisionSuggestionSystemPrompt } = await import(
    "../lib/llm/prompts"
  )
  const originalDefinitionSchema = zodToJsonSchema(DefinitionTextOutput)
  const expectedOllamaSchema = {
    type: "object",
    properties: { definition: { type: "string" } },
    required: ["definition"],
    additionalProperties: false,
    $schema: "http://json-schema.org/draft-07/schema#"
  }
  for (const workflow of [
    {
      name: "new term",
      system: NewTermSystemPrompt,
      prompt: newTermPromptInputs({
        term: "austenite",
        context: "An iron phase."
      }).userPrompt
    },
    {
      name: "revision",
      system: RevisionSuggestionSystemPrompt,
      prompt: revisionUserPrompt({
        term: "austenite",
        definition: "An iron phase.",
        feedback: "Specify its crystal structure."
      })
    }
  ]) {
    for (const [output, expected] of [
      [
        { definition: " A crystalline iron phase. " },
        "A crystalline iron phase."
      ],
      [{ definition: "x".repeat(10000) }, "x".repeat(10000)],
      [{ definition: "" }, undefined],
      [{ definition: " \t\n " }, undefined],
      [{ definition: "x".repeat(10001) }, undefined],
      [{ definition: "Valid text", example: "Unrequested output" }, undefined],
      [{ definition: 123 }, undefined],
      [{ example: "Missing definition" }, undefined]
    ] as const) {
      let workflowCalls = 0
      const generated = await generateStructured(
        local,
        [{ role: "user", content: workflow.prompt }],
        workflow.system,
        DefinitionTextOutput,
        {
          fetcher: async (_url, init) => {
            workflowCalls++
            const body = JSON.parse(init?.body as string)
            assert.deepEqual(body.format, expectedOllamaSchema)
            assert.deepEqual(body.messages, [
              { role: "system", content: workflow.system },
              { role: "user", content: workflow.prompt }
            ])
            return json({
              model: "gemma4:26b",
              message: { role: "assistant", content: JSON.stringify(output) },
              done: true
            })
          }
        }
      )
      assert.equal(workflowCalls, 1, "Invalid output is never retried loosely")
      assert.equal(
        generated?.output.definition,
        expected,
        `${workflow.name} retains the complete application output contract`
      )
      if (expected === undefined) assert.equal(generated, undefined)
    }
  }
  assert.deepEqual(
    zodToJsonSchema(DefinitionTextOutput),
    originalDefinitionSchema,
    "Transport compatibility does not mutate application validation"
  )
  await generateStructured(config, messages, "test", DefinitionTextOutput, {
    tokens,
    fetcher: async (_url, init) => {
      const wireSchema = JSON.parse(init?.body as string).response_format
        .json_schema.schema
      assert.equal(wireSchema.properties.definition.minLength, 1)
      assert.equal(wireSchema.properties.definition.maxLength, 10000)
      assert.deepEqual(wireSchema, originalDefinitionSchema)
      return completion()
    }
  })
  const nestedSchema = z
    .object({
      minLength: z.string().min(2),
      evidence: z
        .array(
          z
            .object({
              text: z
                .string()
                .max(500)
                .regex(/^Source:/),
              score: z.number().min(1).max(10)
            })
            .strict()
        )
        .min(1)
    })
    .strict()
  const originalNested = zodToJsonSchema(nestedSchema)
  const nestedWire = ollamaResponseSchema(nestedSchema)
  assert.deepEqual(nestedWire, {
    type: "object",
    properties: {
      minLength: { type: "string" },
      evidence: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            text: { type: "string", pattern: "^Source:" },
            score: { type: "number", minimum: 1, maximum: 10 }
          },
          required: ["text", "score"],
          additionalProperties: false
        }
      }
    },
    required: ["minLength", "evidence"],
    additionalProperties: false,
    $schema: "http://json-schema.org/draft-07/schema#"
  })
  assert.deepEqual(zodToJsonSchema(nestedSchema), originalNested)

  const previousWarn = console.warn
  try {
    const logs: unknown[][] = []
    console.warn = (...args) => logs.push(args)
    for (const [status, code] of [
      [400, "unsupported_format"],
      [401, "authentication"],
      [403, "authentication"],
      [404, "model_missing"],
      [422, "unsupported_format"],
      [429, "unavailable"],
      [503, "unavailable"]
    ] as const) {
      let failures = 0
      logs.length = 0
      await assert.rejects(
        generateStructured(local, messages, "test", DefinitionTextOutput, {
          fetcher: async () => {
            failures++
            return new Response("dummy-secret and private source text", {
              status
            })
          }
        }),
        (error: unknown) => {
          failureCode(code)(error)
          assert(error instanceof InferenceError)
          assert.equal(error.retryable, status === 429 || status >= 500)
          assert.equal(error.diagnostic?.provider, "ollama")
          assert.equal(error.diagnostic?.category, "http")
          assert.equal(error.diagnostic?.httpStatus, status)
          assert((error.diagnostic?.elapsedMs ?? -1) >= 0)
          assert.equal(error.diagnostic?.timeoutMs, local.timeoutMs)
          assert.deepEqual(logs, [["Ollama request failed", error.diagnostic]])
          assert.deepEqual(Object.keys(error.diagnostic!).sort(), [
            "category",
            "elapsedMs",
            "httpStatus",
            "provider",
            "timeoutMs"
          ])
          return true
        }
      )
      assert.equal(failures, 1, "No format fallback or provider retry")
      assert(!JSON.stringify(logs).includes("dummy-secret"))
      assert(!JSON.stringify(logs).includes("private source text"))
    }
    logs.length = 0
    await assert.rejects(
      generateStructured(local, messages, "test", DefinitionTextOutput, {
        fetcher: async () => {
          throw new Error("dummy-secret and private source text")
        }
      }),
      (error: unknown) => {
        failureCode("unavailable")(error)
        assert(error instanceof InferenceError)
        assert.equal(error.diagnostic?.category, "transport")
        assert.equal(error.diagnostic?.httpStatus, undefined)
        return true
      }
    )
    assert(!JSON.stringify(logs).includes("dummy-secret"))
    assert(!JSON.stringify(logs).includes("private source text"))
  } finally {
    console.warn = previousWarn
  }
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
