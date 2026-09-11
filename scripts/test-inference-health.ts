import assert from "node:assert/strict"
import { getInferenceConfig } from "../lib/llm/config"
import { getInferenceEndpointsHealth } from "../lib/llm/health"

const active = {
  OLLAMA_HOST: "http://ollama.example.test:11434",
  INFERENCE_PROFILE: "local",
  INFERENCE_MODEL: "ollama-model"
}
const alternate = {
  INFERENCE_ALTERNATE_PROVIDER: "openai-compatible",
  INFERENCE_ALTERNATE_PROFILE: "research-cluster",
  INFERENCE_ALTERNATE_MODEL: "cluster-model",
  INFERENCE_ALTERNATE_BASE_URL: "https://inference.example.test/v1",
  INFERENCE_ALTERNATE_TOKEN_URL: "https://identity.example.test/token",
  INFERENCE_ALTERNATE_CLIENT_ID: "health-fixture",
  INFERENCE_ALTERNATE_CLIENT_SECRET: "health-fixture-secret"
}

async function main() {
  const originalFetch = globalThis.fetch
  const originalEnv = { ...process.env }
  const calls: string[] = []
  let failure: "network" | "authentication" | "model" | undefined
  let releaseActive: (() => void) | undefined
  let holdActive = false
  globalThis.fetch = async (url, init) => {
    const path = String(url)
    calls.push(path)
    assert.equal(init?.redirect, "error")
    assert.equal(init?.cache, "no-store")
    assert(init?.signal)
    if (path.endsWith("/api/show")) {
      assert.equal(JSON.parse(init?.body as string).model, "ollama-model")
      assert.equal(new Headers(init?.headers).get("Authorization"), null)
      if (holdActive)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("The alternate did not start concurrently")),
            1000
          )
          releaseActive = () => {
            clearTimeout(timer)
            resolve()
          }
        })
      return Response.json({
        details: { family: "fixture", parameter_size: "26B" }
      })
    }
    if (path.endsWith("/token")) {
      assert.equal(
        (init?.body as URLSearchParams).get("client_secret"),
        "health-fixture-secret"
      )
      return Response.json({
        access_token: "health-fixture-token",
        expires_in: 300
      })
    }
    assert.equal(path, "https://inference.example.test/v1/models")
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer health-fixture-token"
    )
    // Proves the alternate starts while the active request remains pending.
    releaseActive?.()
    if (failure === "network")
      throw new Error("health-fixture-secret private failure")
    if (failure === "authentication")
      return new Response("private failure", { status: 403 })
    return Response.json({
      data: [{ id: failure === "model" ? "other-model" : "cluster-model" }]
    })
  }
  try {
    const empty = await getInferenceEndpointsHealth(1000, {})
    assert.equal(empty.active.status, "not_configured")
    assert.equal(empty.alternate.status, "not_configured")
    assert.equal(calls.length, 0)
    const unconfigured = await getInferenceEndpointsHealth(1000, active)
    assert.equal(unconfigured.active.status, "ready")
    assert.equal(unconfigured.alternate.status, "not_configured")
    assert.equal(calls.length, 1)
    for (const partial of [
      { INFERENCE_ALTERNATE_CLIENT_SECRET: "health-fixture-secret" },
      { ...alternate, INFERENCE_ALTERNATE_CLIENT_SECRET: "" },
      {
        ...alternate,
        INFERENCE_ALTERNATE_BASE_URL: "http://inference.example.test"
      },
      { ...alternate, INFERENCE_ALTERNATE_PROVIDER: "typo" }
    ]) {
      const count: number = calls.length
      const health = await getInferenceEndpointsHealth(1000, {
        ...active,
        ...partial
      })
      assert.equal(health.active.status, "ready")
      assert.equal(health.alternate.status, "misconfigured")
      assert.equal(
        calls.length,
        count + 1,
        "invalid alternate must not contact any service"
      )
    }
    holdActive = true
    const configured = { ...active, ...alternate }
    const configBefore = getInferenceConfig(configured)
    const health = await getInferenceEndpointsHealth(1000, configured)
    holdActive = false
    assert.equal(health.active.status, "ready")
    assert.equal(health.alternate.status, "ready")
    assert.equal(health.active.model?.name, "ollama-model")
    assert.equal(health.alternate.model?.name, "cluster-model")
    assert.equal(health.alternate.profile, "research-cluster")
    assert.deepEqual(getInferenceConfig(configured), configBefore)
    for (const value of [
      "health-fixture-secret",
      "health-fixture-token",
      "https://",
      "http://",
      "clientId",
      "clientSecret"
    ])
      assert(
        !JSON.stringify(health).includes(value),
        "health must contain only safe metadata"
      )
    for (const [problem, status] of [
      ["network", "unreachable"],
      ["authentication", "authentication_failed"],
      ["model", "model_missing"]
    ] as const) {
      failure = problem
      const failed = await getInferenceEndpointsHealth(1000, configured)
      assert.equal(failed.active.status, "ready")
      assert.equal(failed.alternate.status, status)
      assert.equal(failed.alternate.model?.name, "cluster-model")
      assert(!JSON.stringify(failed).includes("private failure"))
    }
    failure = undefined
    // Reverse roles: independent alternate Ollama model, no inherited cluster model.
    const reversed = await getInferenceEndpointsHealth(1000, {
      ...Object.fromEntries(
        Object.entries(alternate).map(([key, value]) => [
          key.replace("INFERENCE_ALTERNATE_", "INFERENCE_"),
          value
        ])
      ),
      INFERENCE_ALTERNATE_PROVIDER: "ollama",
      INFERENCE_ALTERNATE_PROFILE: "local",
      INFERENCE_ALTERNATE_MODEL: "ollama-model",
      INFERENCE_ALTERNATE_OLLAMA_HOST: active.OLLAMA_HOST
    })
    assert.equal(reversed.active.model?.name, "cluster-model")
    assert.equal(reversed.alternate.model?.name, "ollama-model")
    assert.equal(reversed.alternate.status, "ready")
    assert.equal(
      JSON.stringify({ ...process.env }) === JSON.stringify(originalEnv),
      true,
      "health checks must not mutate global provider selection"
    )
    assert(
      calls.every(
        (url) => !url.includes("completions") && !url.includes("/chat")
      )
    )
    console.log(
      "Independent endpoint health, parallel checks, isolation, safe errors, missing configuration, and role reversal passed."
    )
  } finally {
    globalThis.fetch = originalFetch
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
