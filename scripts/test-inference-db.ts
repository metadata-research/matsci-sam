// Synthetic data only: verifies the actual suggestion/publication router path
// across a provider change, plus historical provenance after a human edit.
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external"
import { eq, sql } from "drizzle-orm"
import {
  db,
  usersTable,
  definitionsTable,
  definitionRevisionsTable,
  aiContributionSuggestionsTable
} from "../drizzle"
import { aiAssistRouter } from "../trpc/routers/ai-assist"
import { adminRouter } from "../trpc/routers/admin"
import { definitionsRouter } from "../trpc/routers/definitions"
import { createCallerFactory } from "../trpc/init"
import { publishDefinitionRevision } from "../lib/definition-revisions"
import { buildTermProvenance } from "../lib/provenance"
import { provenanceTurtle } from "../lib/provenance-rdf"

async function main() {
  const [count] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(usersTable)
  assert.equal(
    count.value,
    0,
    "This test requires an empty migrated scratch database"
  )
  const [user] = await db
    .insert(usersTable)
    .values({ name: "Inference test contributor" })
    .returning()
  const ai = createCallerFactory(aiAssistRouter)({
    session: { id: user.id }
  } as never)
  const definitions = createCallerFactory(definitionsRouter)({
    session: { id: user.id }
  } as never)
  const originalFetch = globalThis.fetch
  let tokenCalls = 0
  let modelCalls = 0
  let failure: "schema" | "authentication" | "network" | undefined
  Object.assign(process.env, {
    INFERENCE_PROVIDER: "openai-compatible",
    INFERENCE_PROFILE: "test-cluster",
    INFERENCE_MODEL: "gemma-test-26b",
    INFERENCE_BASE_URL: "https://inference.example.test/v1",
    INFERENCE_TOKEN_URL: "https://identity.example.test/token",
    INFERENCE_CLIENT_ID: "fixture",
    INFERENCE_CLIENT_SECRET: "fixture-secret"
  })
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/token")) {
      tokenCalls++
      return Response.json({ access_token: "fixture-token", expires_in: 300 })
    }
    modelCalls++
    const request = JSON.parse(init?.body as string)
    assert.equal(request.model, "gemma-test-26b")
    if (String(url).endsWith("/api/chat")) {
      assert.equal(request.format.properties.answer.type, "string")
      return Response.json({
        model: "ollama-resolved-model",
        message: {
          role: "assistant",
          content: '{"answer":"A synthetic Ollama answer."}'
        },
        done: true
      })
    }
    if (failure === "network")
      throw new Error("fixture-secret upstream details")
    if (failure === "authentication")
      return new Response("fixture-secret upstream details", { status: 403 })
    const fields = request.response_format.json_schema.schema.properties
    return Response.json({
      model: "fixture-resolved-model",
      choices: [
        {
          finish_reason: "stop",
          message: {
            content:
              failure === "schema"
                ? "not valid JSON"
                : JSON.stringify(
                    fields.answer
                      ? { answer: "A synthetic answer." }
                      : {
                          definition:
                            "A phase of iron with a face-centered cubic structure.",
                          ...(fields.example
                            ? { example: "A synthetic example." }
                            : {})
                        }
                  )
          }
        }
      ]
    })
  }
  try {
    const anonymousAdmin = createCallerFactory(adminRouter)({
      session: {}
    } as never)
    const admin = createCallerFactory(adminRouter)({
      session: { id: user.id }
    } as never)
    const testInput = {
      mode: "answer" as const,
      prompt: "Explain transfer learning."
    }
    for (const [caller, code] of [
      [anonymousAdmin, "UNAUTHORIZED"],
      [admin, "FORBIDDEN"]
    ] as const) {
      await assert.rejects(caller.inferenceTestConfiguration(), { code })
      await assert.rejects(caller.inferenceTest(testInput), { code })
    }
    assert.equal(
      tokenCalls + modelCalls,
      0,
      "denied tests must not call inference"
    )
    await db
      .update(usersTable)
      .set({ role: "admin" })
      .where(eq(usersTable.id, user.id))
    const rowCounts = async () =>
      (
        await db.execute(sql`
      SELECT
        (SELECT count(*) FROM terms) AS terms,
        (SELECT count(*) FROM definitions) AS definitions,
        (SELECT count(*) FROM "definitionRevisions") AS revisions,
        (SELECT count(*) FROM "definitionExamples") AS examples,
        (SELECT count(*) FROM chats) AS chats,
        (SELECT count(*) FROM comments) AS comments,
        (SELECT count(*) FROM "aiContributionSuggestions") AS suggestions,
        (SELECT count(*) FROM "surveyResponses") AS responses
    `)
      ).rows
    const beforeTests = await rowCounts()
    process.env.INFERENCE_CLIENT_ID = "admin-diagnostic-fixture"
    const configured = await admin.inferenceTestConfiguration()
    assert.equal(configured.status, "configured")
    for (const input of [
      { ...testInput, prompt: " " },
      { ...testInput, prompt: "x".repeat(4001) },
      { ...testInput, mode: "unknown" },
      { ...testInput, baseUrl: "https://unselected.example.test" }
    ]) {
      await assert.rejects(admin.inferenceTest(input as never), {
        code: "BAD_REQUEST"
      })
    }
    assert.equal(
      tokenCalls + modelCalls,
      0,
      "invalid tests must not call inference"
    )
    for (const mode of ["answer", "definition"] as const) {
      const result = await admin.inferenceTest({ ...testInput, mode })
      assert.equal(result.status, "passed")
      assert(result.elapsedMs >= 0)
      assert.equal(result.inference?.provider, "openai-compatible")
      assert.equal(result.inference?.model, "gemma-test-26b")
      assert.equal(result.inference?.responseModel, "fixture-resolved-model")
      assert.equal(result.prompt, testInput.prompt)
      assert(!JSON.stringify(result).includes("fixture-secret"))
      assert(!JSON.stringify(result).includes("https://"))
      if (result.status === "passed")
        assert.deepEqual(
          Object.keys(result.output).sort(),
          mode === "answer" ? ["answer"] : ["definition", "example"]
        )
    }
    for (const rejected of ["schema", "authentication", "network"] as const) {
      failure = rejected
      const result = await admin.inferenceTest(testInput)
      assert.equal(result.status, "failed")
      assert(!JSON.stringify(result).includes("fixture-secret"))
      assert.equal(result.inference?.profile, "test-cluster")
    }
    failure = undefined
    assert.equal(modelCalls, 5, "each diagnostic makes exactly one model call")
    delete process.env.INFERENCE_CLIENT_SECRET
    assert.equal(
      (await admin.inferenceTestConfiguration()).status,
      "misconfigured"
    )
    assert.equal((await admin.inferenceTest(testInput)).status, "failed")
    assert.equal(modelCalls, 5, "invalid configuration must not call inference")
    process.env.INFERENCE_CLIENT_SECRET = "fixture-secret"
    assert.deepEqual(
      await admin.inferenceTestConfiguration(),
      configured,
      "tests must not change the selected provider"
    )
    process.env.INFERENCE_PROVIDER = "ollama"
    process.env.OLLAMA_HOST = "http://ollama.example.test:11434"
    const ollamaResult = await admin.inferenceTest(testInput)
    assert.equal(ollamaResult.status, "passed")
    assert.equal(ollamaResult.inference?.provider, "ollama")
    assert.equal(ollamaResult.inference?.responseModel, "ollama-resolved-model")
    process.env.INFERENCE_PROVIDER = "openai-compatible"
    assert.deepEqual(
      await rowCounts(),
      beforeTests,
      "diagnostics must not publish or save records"
    )
    console.log(
      "Admin inference test access, input bounds, both formats, safe errors, configuration, and no-write checks passed."
    )
    process.env.INFERENCE_CLIENT_ID = "fixture"
    tokenCalls = 0
    modelCalls = 0
    const draft = await ai.suggestNewTerm({
      term: "Inference fixture austenite"
    })
    const [suggestion] = await db
      .select()
      .from(aiContributionSuggestionsTable)
      .where(eq(aiContributionSuggestionsTable.id, draft.suggestionId))
    assert.equal(suggestion.inference?.provider, "openai-compatible")
    assert.equal(suggestion.model, "gemma-test-26b")
    // Publishing is independent of the default at publication time.
    process.env.INFERENCE_PROVIDER = "ollama"
    process.env.INFERENCE_PROFILE = "local"
    delete process.env.INFERENCE_MODEL
    await definitions.create({
      term: "Inference fixture austenite",
      definition: draft.definition,
      aiSuggestionId: draft.suggestionId
    })
    assert.equal(modelCalls, 1)
    assert.equal(tokenCalls, 1)
    const [accepted] = await db
      .select()
      .from(aiContributionSuggestionsTable)
      .where(eq(aiContributionSuggestionsTable.id, draft.suggestionId))
    assert.equal(accepted.status, "accepted")
    const [published] = await db
      .select()
      .from(definitionsTable)
      .where(eq(definitionsTable.id, accepted.outputDefinitionId!))
    assert.deepEqual(published.inference, suggestion.inference)
    const [first] = await db
      .select()
      .from(definitionRevisionsTable)
      .where(eq(definitionRevisionsTable.id, published.currentRevisionId!))
    assert.deepEqual(first.inference, suggestion.inference)
    await db.transaction((tx) =>
      publishDefinitionRevision(tx, {
        definitionId: published.id,
        editorId: user.id,
        definition: "A human correction to the test definition.",
        example: "",
        source: "author_edit",
        changeNote: "Human correction",
        expectedRevisionId: first.id
      })
    )
    const historic = await definitions.get({
      definitionId: published.id,
      version: 1
    })
    assert.deepEqual(historic?.inference, suggestion.inference)
    const current = await definitions.get({ definitionId: published.id })
    assert.equal(current?.inference, null)
    assert.equal(current?.model, null)
    const graph = await buildTermProvenance(published.termId)
    assert(graph)
    const rdf = provenanceTurtle(graph)
    assert(rdf.includes("inferenceProvider"))
    assert(rdf.includes("openai-compatible"))
    assert(!rdf.includes("fixture-secret"))
    assert(!rdf.includes("identity.example.test"))
    console.log(
      "Inference suggestion, publication after switching, historical revision, human edit, and RDF provenance checks passed."
    )
  } finally {
    globalThis.fetch = originalFetch
  }
}
workAsyncStorage
  .run(
    { route: "/api/trpc", incrementalCache: {} } as unknown as Parameters<
      typeof workAsyncStorage.run
    >[0],
    main
  )
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
