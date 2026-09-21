import assert from "node:assert/strict"
import { z } from "zod"
import {
  AGENT_ONE_ENDPOINT,
  agentOneDefinitionPrompt,
  agentOneValidationHash,
  generateAgentOne,
  getAgentOneConfig
} from "../lib/llm/agent-one"
import {
  assistantCatalog,
  chooseAssistantProfile,
  initialAssistantPolicy,
  snapshotAssistantConfigs
} from "../lib/llm/assistant-profiles"
import { generateStructured } from "../lib/llm/generate"
import { InferenceError, inferenceProperties } from "../lib/llm/types"
import { modelIdentity } from "../lib/llm/model-identity"
import { newTermPromptInputs } from "../lib/model-prompt-inputs"

const secret = "test-key-private"
const config = getAgentOneConfig({ WOLFRAM_AGENT_ONE_API_KEY: secret })
const schema = z
  .object({ definition: z.string().trim().min(1).max(10000) })
  .strict()
const messages = [{ role: "user" as const, content: "Define austenite." }]
const envelope = (
  content: unknown = "An iron phase.",
  extra: Record<string, unknown> = {},
  annotations?: unknown[]
) => ({
  success: true,
  code: 200,
  model: "AgentOne",
  uuid: "f39a2eda-ab15-4d92-bc3c-6a3f539a91b3",
  choices: [
    {
      finish_reason: "stop",
      message: {
        role: "assistant",
        content,
        annotations: annotations ?? [
          {
            type: "wolfram_tool_response",
            wolfram_tool_response: {
              Tool: "wolfram_alpha",
              RequestID: "source-1",
              ResponseString: "Private full response",
              Request: { ParameterValues: { key: secret } }
            }
          },
          { type: "unknown", value: secret }
        ]
      }
    }
  ],
  ...extra
})
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
const generate = (data: unknown, status = 200) =>
  generateStructured(
    config,
    messages,
    agentOneDefinitionPrompt("Definition instructions"),
    schema,
    { fetcher: async () => json(data, status) }
  )
const errorCode = (code: string) => (error: unknown) =>
  error instanceof InferenceError &&
  error.code === code &&
  !String(error).includes(secret)
const sourceUri = "https://www.wolframalpha.com/input?i=austenite"
const documentationUri =
  "https://reference.wolfram.com/language/ref/entity/Chemical#982511436"
const sourceFooter = `\n\n---\n\n#### Wolfram Sources\n\n* Wolfram\\|Alpha: [[1]](${sourceUri})\n* Wolfram Language Documentation: [[1]](${documentationUri})`
const sourceAnnotation = {
  type: "sources",
  sources: [
    { ShortID: "WA-1", Type: "WolframAlpha", URI: sourceUri },
    {
      ShortID: "Chemical-2",
      Type: "Documentation",
      URI: "paclet:ref/entity/Chemical#982511436"
    }
  ]
}

async function main() {
  assert.throws(
    () => getAgentOneConfig({ WOLFRAM_API_KEY: secret }),
    errorCode("configuration"),
    "CAG must never provide an Agent One credential"
  )
  assert.throws(
    () =>
      getAgentOneConfig({
        WOLFRAM_AGENT_ONE_API_KEY: secret,
        WOLFRAM_AGENT_ONE_TIMEOUT_MS: "Infinity"
      }),
    errorCode("configuration")
  )
  const rotated = getAgentOneConfig({ WOLFRAM_AGENT_ONE_API_KEY: "rotated" })
  assert.equal(
    rotated.metadata.configHash,
    config.metadata.configHash,
    "public inference config hash excludes secrets"
  )
  assert.notEqual(
    agentOneValidationHash(rotated),
    agentOneValidationHash(config),
    "rotation invalidates readiness"
  )
  assert.equal(config.baseUrl, AGENT_ONE_ENDPOINT)
  assert(Object.isFrozen(config) && Object.isFrozen(config.metadata))

  const sharedInstructions =
    "Define the requested material. Return only the definition field requested by the response schema. Preserve the contributor's context."
  const instructions = agentOneDefinitionPrompt(sharedInstructions)
  assert(instructions.includes("Return only the definition text."))
  assert(instructions.includes("Preserve the contributor's context."))
  assert(!instructions.includes("response schema"))
  assert(/plain[ -]text/i.test(instructions))
  assert(/(?:not|no|do not)[^\n]*JSON/i.test(instructions))

  const finalText =
    "**Austenite** is an iron phase.\n\nIts crystal structure is face-centered cubic."
  let requests = 0
  const result = await generateStructured(
    config,
    messages,
    instructions,
    schema,
    {
      fetcher: async (url, init) => {
        requests++
        assert.equal(url, AGENT_ONE_ENDPOINT)
        assert.equal(new Headers(init?.headers).get("Authorization"), secret)
        assert.equal(init?.redirect, "error")
        assert.equal(init?.cache, "no-store")
        assert(init?.signal)
        const body = JSON.parse(String(init?.body))
        assert.deepEqual(Object.keys(body).sort(), ["messages", "stream"])
        assert.equal(body.stream, false)
        assert.equal(body.messages[0].role, "user")
        assert.equal(body.messages[0].content, instructions)
        assert.equal(body.messages[1].content, messages[0].content)
        assert(
          !body.messages.some(
            (entry: { role: string }) => entry.role === "system"
          )
        )
        assert.equal(body.model, undefined)
        assert.equal(body.response_format, undefined)
        assert(!String(init?.body).includes('"additionalProperties"'))
        assert(!String(init?.body).includes("$schema"))
        assert(!String(init?.body).includes(secret))
        return json(envelope(` <think>Private analysis</think>\n${finalText} `))
      }
    }
  )
  assert.equal(requests, 1)
  assert.equal(result?.output.definition, finalText)
  assert.equal(result?.inference.model, "wolfram-agent-one")
  assert.equal(result?.inference.responseModel, "AgentOne")
  assert.equal(
    result?.inference.responseId,
    "f39a2eda-ab15-4d92-bc3c-6a3f539a91b3"
  )
  assert.deepEqual(result?.inference.toolEvidence, [
    {
      type: "wolfram_tool_response",
      tool: "wolfram_alpha",
      requestId: "source-1"
    }
  ])
  for (const unsafe of [secret, "Private analysis", "Private full response"])
    assert(!JSON.stringify(result).includes(unsafe))
  assert(!JSON.stringify(result?.inference).includes("https://"))
  assert.deepEqual(result?.inference.reportedSources, [])
  assert.equal(
    inferenceProperties(result?.inference).inferenceResponseId,
    result?.inference.responseId
  )
  assert.equal(modelIdentity("wolfram-agent-one").vendor, "Wolfram")
  assert.equal(modelIdentity("wolfram-agent-one").parameterSize, null)

  for (const body of [
    "An iron phase.",
    finalText,
    '{"definition":"An iron phase."}',
    '```json\n{"definition":"An iron phase."}\n```',
    "```text\nAn iron phase.\n```",
    'An explanation before {"definition":"An iron phase."} and after.',
    'A JSON example with an incomplete field: {"definition":"phase'
  ]) {
    for (const prefix of ["", "<think>Private analysis</think>\n"]) {
      const direct = await generate(envelope(` \n${prefix}${body}\n `))
      assert.equal(
        direct?.output.definition,
        body,
        "final text must not be parsed, extracted from prose, or unwrapped"
      )
      for (const annotations of [undefined, [sourceAnnotation]]) {
        const sourced = await generate(
          envelope(prefix + body + sourceFooter, {}, annotations)
        )
        assert.equal(sourced?.output.definition, body + sourceFooter)
        assert.equal(
          sourced?.inference.responseId,
          result?.inference.responseId
        )
        assert.deepEqual(sourced?.inference.reportedSources, [
          { url: sourceUri },
          { url: documentationUri }
        ])
        for (const unsafe of [
          secret,
          "Private analysis",
          "Private full response"
        ])
          assert(!JSON.stringify(sourced).includes(unsafe))
      }
    }
  }
  const direct = await generateAgentOne(
    config,
    messages,
    instructions,
    async () => json(envelope(finalText + sourceFooter))
  )
  assert.equal(direct?.output, finalText + sourceFooter)
  assert.deepEqual(direct?.inference, {
    ...result?.inference,
    reportedSources: [{ url: sourceUri }, { url: documentationUri }]
  })

  const suppliedSource = "https://example.test/source-supplied-in-the-prompt"
  const distinctSources = await generateAgentOne(
    config,
    [{ role: "user", content: `Use this source: ${suppliedSource}` }],
    instructions,
    async () => json(envelope(finalText + sourceFooter))
  )
  assert.deepEqual(distinctSources?.inference.reportedSources, [
    { url: sourceUri },
    { url: documentationUri }
  ])
  assert(
    !JSON.stringify(distinctSources?.inference.reportedSources).includes(
      suppliedSource
    ),
    "provider-reported response sources are separate from prompt inputs"
  )
  const escapedFooterAnswer = String.raw`Ceric oxide has formula CeO₂.

---

#### Wolfram Sources

- Wolfram|Alpha: [\[1\]](${sourceUri}) [\[2\]](${documentationUri})`
  const escapedFooterResult = await generate(envelope(escapedFooterAnswer))
  assert.equal(escapedFooterResult?.output.definition, escapedFooterAnswer)
  assert.deepEqual(escapedFooterResult?.inference.reportedSources, [
    { url: sourceUri },
    { url: documentationUri }
  ])
  const unsafeFooterAnswer =
    finalText +
    "\n\n#### Wolfram Sources\n\n- [Unsafe](javascript:alert(1))\n- [Private](https://user:password@example.test/source)"
  const unsafeFooterResult = await generate(envelope(unsafeFooterAnswer))
  assert.equal(unsafeFooterResult?.output.definition, unsafeFooterAnswer)
  assert.deepEqual(unsafeFooterResult?.inference.reportedSources, [])

  // Source annotations never gate or rewrite the final answer.
  for (const annotation of [
    { type: "sources", sources: [] },
    { type: "sources", sources: "invalid" },
    {
      type: "sources",
      sources: [
        { ...sourceAnnotation.sources[0], URI: "paclet:ref/ChemicalData" }
      ]
    },
    {
      type: "sources",
      sources: [{ ...sourceAnnotation.sources[0], Type: "Unknown" }]
    },
    {
      type: "sources",
      sources: [{ ...sourceAnnotation.sources[0], ShortID: "WA-2" }]
    }
  ])
    assert.equal(
      (await generate(envelope(finalText + sourceFooter, {}, [annotation])))
        ?.output.definition,
      finalText + sourceFooter,
      "source text must be preserved independently of annotation format"
    )

  const cericDraft =
    "A metal oxide with formula CeO₂. It is used for polishing glass, in coatings for infra-red filters to prevent reflection, and as an oxidant and catalyst in organic synthesis."
  const cericInputs = newTermPromptInputs({
    term: "ceric oxide",
    context: cericDraft
  })
  const cericAnswer =
    "Ceric oxide (CeO₂) is a metal oxide used in materials science for polishing glass, as a coating for infrared filters to reduce reflection, and as an oxidant and catalyst in organic synthesis." +
    sourceFooter
  const cericResult = await generateStructured(
    config,
    [{ role: "user", content: cericInputs.userPrompt }],
    instructions,
    schema,
    {
      fetcher: async (_url, init) => {
        const body = JSON.parse(String(init?.body))
        assert.equal(body.messages[0].content, instructions)
        assert.equal(
          body.messages[1].content,
          `<term>\nceric oxide\n\n<contributor-notes>\n${cericDraft}`,
          "the contributor's ChEBI draft must reach Agent One unchanged"
        )
        return json(envelope(cericAnswer, {}, [sourceAnnotation]))
      }
    }
  )
  assert.equal(cericInputs.definition, cericDraft)
  assert.equal(cericResult?.output.definition, cericAnswer)

  assert.equal(
    (await generate(envelope("x".repeat(10000))))?.output.definition.length,
    10000
  )
  for (const content of [
    "",
    " \n\t ",
    "x".repeat(10001),
    "<think>unclosed private analysis",
    "<think>Private analysis</think>",
    "<think>Private analysis</think> \n\t",
    "<think>Private analysis</think><think>more private analysis</think>Answer",
    "Answer <think>Private analysis</think>",
    "Answer </think>",
    "Answer <THINK>Private analysis</THINK>"
  ])
    assert.equal(
      await generate(envelope(content)),
      undefined,
      "empty, oversized or exposed reasoning responses must be rejected"
    )
  for (const data of [
    null,
    [],
    envelope(null),
    envelope({ definition: "An iron phase." }),
    envelope("An iron phase.", { success: false }),
    envelope("An iron phase.", { code: 501 }),
    envelope("An iron phase.", { choices: [] }),
    envelope("An iron phase.", {
      choices: [...envelope().choices, ...envelope().choices]
    }),
    envelope("An iron phase.", {
      choices: [
        {
          finish_reason: "length",
          message: { role: "assistant", content: "A partial definition" }
        }
      ]
    }),
    envelope("An iron phase.", {
      choices: [
        {
          finish_reason: "stop",
          message: { role: "user", content: "An iron phase." }
        }
      ]
    }),
    envelope("An iron phase.", {
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            refusal: "blocked",
            content: "A refusal"
          }
        }
      ]
    })
  ])
    assert.equal(await generate(data), undefined)
  for (const [status, code] of [
    [401, "authentication"],
    [403, "authentication"],
    [400, "unsupported_format"],
    [422, "unsupported_format"],
    [429, "unavailable"],
    [500, "unavailable"]
  ] as const)
    await assert.rejects(generate({ error: secret }, status), errorCode(code))
  await assert.rejects(
    generate(envelope("x".repeat(1_048_577))),
    errorCode("unsupported_format")
  )
  await assert.rejects(
    generateStructured(config, messages, "test", schema, {
      fetcher: async () => {
        throw new Error(secret)
      }
    }),
    errorCode("unavailable")
  )

  const env = { WOLFRAM_AGENT_ONE_API_KEY: secret }
  const configs = snapshotAssistantConfigs(env)
  env.WOLFRAM_AGENT_ONE_API_KEY = "changed"
  assert.equal(
    configs.agentOneConfig?.apiKey,
    secret,
    "in-flight credential/config snapshot must remain fixed"
  )
  const policy = {
    ...initialAssistantPolicy,
    agentOneEnabled: true,
    agentOneValidationHash: agentOneValidationHash(config),
    agentOneValidatedAt: "2026-09-20T12:00:00.000Z"
  }
  assert.equal(assistantCatalog(configs, policy).profiles[1].available, true)
  assert.equal(
    assistantCatalog(snapshotAssistantConfigs(env), policy).profiles[1]
      .available,
    false
  )
  assert.equal(
    assistantCatalog(configs, initialAssistantPolicy).profiles[1].available,
    false
  )
  assert.equal(
    assistantCatalog(configs, { ...policy, agentOneEnabled: false }).profiles[1]
      .available,
    false
  )
  assert.equal(assistantCatalog(configs, policy).profiles[0].label, "Gemma 4")
  const flame = snapshotAssistantConfigs({
    INFERENCE_PROVIDER: "openai-compatible",
    INFERENCE_MODEL: "cluster-model",
    INFERENCE_BASE_URL: "https://example.test/v1",
    INFERENCE_TOKEN_URL: "https://example.test/token",
    INFERENCE_CLIENT_ID: "id",
    INFERENCE_CLIENT_SECRET: "private"
  })
  assert.equal(
    assistantCatalog(flame, initialAssistantPolicy).profiles[0].label,
    "cluster-model",
    "FLAME must never be called Gemma unless that is its configured model"
  )
  assert.equal(
    chooseAssistantProfile({
      requested: "agent-one",
      preferred: "default",
      defaultProfile: "default",
      study: false
    }),
    "agent-one"
  )
  assert.equal(
    chooseAssistantProfile({
      preferred: "agent-one",
      defaultProfile: "default",
      study: false
    }),
    "agent-one"
  )
  assert.equal(
    chooseAssistantProfile({
      preferred: "agent-one",
      defaultProfile: "agent-one",
      study: true
    }),
    "default"
  )
  assert.throws(() =>
    chooseAssistantProfile({
      requested: "agent-one",
      preferred: null,
      defaultProfile: "default",
      study: true
    })
  )
  assert(
    !JSON.stringify(assistantCatalog(configs, policy)).includes(
      agentOneValidationHash(config)
    )
  )
  console.log(
    "Agent One direct text, source preservation, request/auth, bounded response, safe identity evidence, credential readiness, profile choice and study pin checks passed."
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
