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
    return Response.json({
      model: "fixture-resolved-model",
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              definition:
                "A phase of iron with a face-centered cubic structure."
            })
          }
        }
      ]
    })
  }
  try {
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
