// Explicitly opted-in integration checks. The test temporarily owns the single
// assistant policy row, restores it exactly, and removes only its own fixtures.
// Run with no simultaneous administration of assistant settings.
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { eq, inArray } from "drizzle-orm"
import {
  db,
  usersTable,
  aiContributionSuggestionsTable,
  definitionAssistantSettingsTable
} from "../drizzle"
import { definitionAssistantsRouter } from "../trpc/routers/definition-assistants"
import { aiAssistRouter } from "../trpc/routers/ai-assist"
import { definitionsRouter } from "../trpc/routers/definitions"
import { createCallerFactory } from "../trpc/init"
import { AGENT_ONE_ENDPOINT } from "../lib/llm/agent-one"

async function main() {
  assert.equal(
    process.env.ALLOW_ASSISTANT_POLICY_TEST,
    "true",
    "Explicitly enable this temporary assistant-policy test"
  )
  const originalEnv = { ...process.env }
  const originalFetch = globalThis.fetch
  const originalPolicy =
    await db.query.definitionAssistantSettingsTable.findFirst({
      where: eq(definitionAssistantSettingsTable.id, 1)
    })
  const fixtureUsers: number[] = []
  let calls = 0
  let lastAgentOneInstructions = ""
  let failure = false
  let hold: ((response: Response) => void) | undefined
  let holdNext = false
  const response = () =>
    Response.json({
      model: "AgentOne",
      uuid: "test-response",
      success: true,
      code: 200,
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: failure ? "" : "A synthetic phase of iron."
          }
        }
      ]
    })
  const waitForHeldRequest = async () => {
    const end = Date.now() + 3000
    while (!hold) {
      if (Date.now() > end) throw new Error("Request did not reach mock")
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  try {
    Object.assign(process.env, {
      WOLFRAM_AGENT_ONE_API_KEY: "fixture-agent-key",
      INFERENCE_PROVIDER: "ollama",
      INFERENCE_PROFILE: "fixture-default",
      INFERENCE_MODEL: "gemma4:26b",
      OLLAMA_HOST: "http://fixture.invalid:11434",
      GRAPH_PROJECTION_ENABLED: "false"
    })
    globalThis.fetch = async (url, init) => {
      calls++
      if (String(url).endsWith("/api/chat"))
        return Response.json({
          model: "gemma4:26b",
          done: true,
          message: {
            role: "assistant",
            content: '{"definition":"A synthetic deployment definition."}'
          }
        })
      assert.equal(
        String(url),
        AGENT_ONE_ENDPOINT,
        "No uncontrolled provider traffic"
      )
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "fixture-agent-key"
      )
      const body = JSON.parse(String(init?.body))
      assert.deepEqual(Object.keys(body).sort(), ["messages", "stream"])
      lastAgentOneInstructions = body.messages[0].content
      assert(/plain[ -]text/i.test(lastAgentOneInstructions))
      assert(!lastAgentOneInstructions.includes("response schema"))
      assert(!String(init?.body).includes("$schema"))
      if (holdNext) {
        holdNext = false
        return new Promise<Response>((resolve) => {
          hold = resolve
        })
      }
      return response()
    }
    const rows = await db
      .insert(usersTable)
      .values([
        {
          name: `Assistant policy test administrator ${process.pid}`,
          role: "admin"
        },
        { name: `Assistant policy test contributor ${process.pid}` }
      ])
      .returning({ id: usersTable.id })
    fixtureUsers.push(...rows.map((row) => row.id))
    const context = (id?: number) => ({ session: { id } }) as never
    const admin = createCallerFactory(definitionAssistantsRouter)(
      context(fixtureUsers[0])
    )
    const contributor = createCallerFactory(definitionAssistantsRouter)(
      context(fixtureUsers[1])
    )
    const anonymous = createCallerFactory(definitionAssistantsRouter)(context())
    const ai = createCallerFactory(aiAssistRouter)(context(fixtureUsers[1]))
    const definitions = createCallerFactory(definitionsRouter)(
      context(fixtureUsers[1])
    )
    await db
      .insert(definitionAssistantSettingsTable)
      .values({ id: 1 })
      .onConflictDoUpdate({
        target: definitionAssistantSettingsTable.id,
        set: {
          agentOneEnabled: false,
          defaultProfile: "default",
          agentOneTestedAt: null,
          agentOneValidationHash: null,
          agentOneValidatedAt: null
        }
      })
    for (const [caller, code] of [
      [anonymous, "UNAUTHORIZED"],
      [contributor, "FORBIDDEN"]
    ] as const) {
      await assert.rejects(caller.settings(), { code })
      await assert.rejects(
        caller.updateSettings({
          agentOneEnabled: true,
          defaultProfile: "agent-one"
        }),
        { code }
      )
      await assert.rejects(caller.testAgentOne(), { code })
    }
    await assert.rejects(anonymous.setPreference({ profile: "default" }), {
      code: "UNAUTHORIZED"
    })
    assert.equal(calls, 0)
    await assert.rejects(
      admin.updateSettings({
        agentOneEnabled: true,
        defaultProfile: "agent-one"
      }),
      { code: "PRECONDITION_FAILED" }
    )
    await assert.rejects(contributor.setPreference({ profile: "agent-one" }), {
      code: "PRECONDITION_FAILED"
    })
    await assert.rejects(
      ai.suggestNewTerm({
        term: `unavailable fixture ${process.pid}`,
        assistantProfile: "agent-one"
      }),
      { code: "PRECONDITION_FAILED" }
    )
    assert.equal(calls, 0)
    assert.equal((await admin.testAgentOne()).status, "passed")
    await admin.updateSettings({
      agentOneEnabled: true,
      defaultProfile: "default"
    })
    await contributor.setPreference({ profile: "agent-one" })
    assert.equal((await contributor.catalog()).preferredProfile, "agent-one")
    const term = `agent fixture ${process.pid} ${Date.now()}`
    const suggestion = await ai.suggestNewTerm({
      term,
      context: "My exact draft.",
      example: "My exact example."
    })
    assert.equal(suggestion.assistantProfile, "agent-one")
    assert.equal(suggestion.model, "wolfram-agent-one")
    assert.equal(suggestion.definition, "A synthetic phase of iron.")
    const stored = await db.query.aiContributionSuggestionsTable.findFirst({
      where: eq(aiContributionSuggestionsTable.id, suggestion.suggestionId)
    })
    assert.equal(stored?.inference?.responseId, "test-response")
    assert.equal(stored?.inputDefinition, "My exact draft.")
    assert.equal(stored?.inputExample, "My exact example.")
    assert.equal(stored?.suggestedDefinition, suggestion.definition)
    assert.equal(
      stored?.promptText,
      lastAgentOneInstructions,
      "provenance must record the plain-text instructions actually sent"
    )
    assert(!JSON.stringify(stored).includes("fixture-agent-key"))
    await assert.rejects(
      definitions.create({
        term,
        definition: suggestion.definition,
        aiSuggestionId: suggestion.suggestionId,
        surveyStepId: 999999999,
        expectedInstructions: null
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("study uses the deployment assistant")
    )
    await assert.rejects(
      ai.suggestRevision({
        definitionId: 999999999,
        sourceRevisionId: 999999999,
        feedback: "Clarify.",
        surveyStepId: 999999999,
        assistantProfile: "agent-one"
      }),
      { code: "BAD_REQUEST" }
    )
    const defaultSuggestion = await ai.suggestNewTerm({
      term: `${term} default`,
      assistantProfile: "default"
    })
    assert.equal(
      defaultSuggestion.model,
      "gemma4:26b",
      "explicit selection overrides saved preference"
    )
    const beforeRotation = calls
    process.env.WOLFRAM_AGENT_ONE_API_KEY = "rotated-key"
    assert.equal((await contributor.catalog()).agentOne.validated, false)
    await assert.rejects(ai.suggestNewTerm({ term: `${term} rotated` }), {
      code: "PRECONDITION_FAILED"
    })
    assert.equal(
      calls,
      beforeRotation,
      "unavailable saved preference must not silently call another provider"
    )
    process.env.WOLFRAM_AGENT_ONE_API_KEY = "fixture-agent-key"

    // Newer failure must win over a successful test started earlier.
    holdNext = true
    const olderSuccess = admin.testAgentOne()
    await waitForHeldRequest()
    await new Promise((resolve) => setTimeout(resolve, 10))
    failure = true
    assert.equal((await admin.testAgentOne()).status, "failed")
    failure = false
    hold!(response())
    hold = undefined
    assert.equal((await olderSuccess).status, "passed")
    assert.equal(
      (await admin.settings()).agentOne.validated,
      false,
      "older success must not restore readiness after a newer failure"
    )

    // Newer success must likewise win over an older failed request.
    holdNext = true
    const olderFailure = admin.testAgentOne()
    await waitForHeldRequest()
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal((await admin.testAgentOne()).status, "passed")
    failure = true
    hold!(response())
    hold = undefined
    failure = false
    assert.equal((await olderFailure).status, "failed")
    assert.equal((await admin.settings()).agentOne.validated, true)
    console.log(
      "Agent One router authorization, opt-in readiness, preference, attribution, study guards, key rotation and overlapping test ordering passed."
    )
  } finally {
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env))
      if (!(key in originalEnv)) delete process.env[key]
    Object.assign(process.env, originalEnv)
    await db.transaction(async (tx) => {
      if (fixtureUsers.length) {
        await tx
          .delete(aiContributionSuggestionsTable)
          .where(
            inArray(aiContributionSuggestionsTable.requestedById, fixtureUsers)
          )
        await tx.delete(usersTable).where(inArray(usersTable.id, fixtureUsers))
      }
      if (originalPolicy)
        await tx
          .insert(definitionAssistantSettingsTable)
          .values(originalPolicy)
          .onConflictDoUpdate({
            target: definitionAssistantSettingsTable.id,
            set: originalPolicy
          })
      else
        await tx
          .delete(definitionAssistantSettingsTable)
          .where(eq(definitionAssistantSettingsTable.id, 1))
    })
    assert.deepEqual(
      await db.query.definitionAssistantSettingsTable.findFirst({
        where: eq(definitionAssistantSettingsTable.id, 1)
      }),
      originalPolicy,
      "assistant policy restored exactly"
    )
    console.log(
      "Temporary assistant fixtures removed and original settings restored."
    )
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
