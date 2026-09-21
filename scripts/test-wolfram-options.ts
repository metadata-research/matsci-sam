import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  buildWolframQuery,
  DEFAULT_WOLFRAM_OPTIONS,
  wolframLookupOptionsSchema,
  type WolframLookupOptions
} from "../lib/wolfram-query"
import {
  retrieveWolframResources,
  wolframRequestFromEndpoint,
  WOLFRAM_RESULTS_ENDPOINT
} from "../lib/wolfram-reference-provider"

async function main() {
  assert.deepEqual(
    wolframLookupOptionsSchema.parse({}),
    DEFAULT_WOLFRAM_OPTIONS
  )
  assert.equal(buildWolframQuery(" Titanium "), "Titanium")
  assert.equal(
    buildWolframQuery(" titanium ", " chemical element "),
    "titanium\nContext: chemical element",
    "The default does not silently add a domain or intended meaning"
  )
  const options: WolframLookupOptions = {
    units: "nonmetric",
    assumptions: ["*C.diamond-_*Material-", "*A.temperature-_Standard-"]
  }
  const input = "Diamond\nContext: crystalline carbon"
  assert.equal(buildWolframQuery("Diamond", "crystalline carbon"), input)
  for (const invalid of [
    { scope: "chemistry" },
    { meaning: "molecule" },
    { units: "SI" },
    { assumptions: [""] },
    { assumptions: ["x".repeat(501)] },
    { assumptions: ["two words"] },
    { assumptions: ["*C.\0invalid"] },
    { assumptions: ["*C.duplicate", "*C.duplicate"] },
    { assumptions: Array.from({ length: 6 }, (_, index) => `*C.${index}`) },
    { unexpected: "option" }
  ])
    assert.equal(wolframLookupOptionsSchema.safeParse(invalid).success, false)

  const raw = "Input interpretation:\ndiamond (material)\nDensity:\n3510 kg/m^3"
  let requestedUrl = ""
  const response = await retrieveWolframResources(
    "Diamond",
    "crystalline carbon",
    "test-secret",
    (async (url, init) => {
      const request = new URL(String(url))
      requestedUrl = request.href
      assert.equal(request.origin + request.pathname, WOLFRAM_RESULTS_ENDPOINT)
      assert.equal(request.searchParams.get("input"), input)
      assert.equal(request.searchParams.get("units"), "nonmetric")
      assert.deepEqual(
        request.searchParams.getAll("assumption"),
        options.assumptions
      )
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "test-secret"
      )
      return new Response(raw)
    }) as typeof fetch,
    options
  )
  assert.equal(response.endpoint, requestedUrl)
  assert.equal(response.endpoint.includes("test-secret"), false)
  assert.deepEqual(response.request, {
    input,
    context: "crystalline carbon",
    options
  })
  assert.equal(response.responseBody, raw)
  assert.equal(
    response.responseHash,
    createHash("sha256").update(raw).digest("hex")
  )
  assert.equal(response.references[0].definition, raw)
  const sourceUrl = new URL(response.references[0].sourceIri)
  assert.equal(sourceUrl.searchParams.get("i"), input)
  assert.equal(sourceUrl.searchParams.get("units"), "nonmetric")
  assert.deepEqual(
    sourceUrl.searchParams.getAll("assumption"),
    options.assumptions
  )
  assert.deepEqual(
    wolframRequestFromEndpoint(
      response.endpoint,
      "diamond",
      "crystalline carbon"
    ),
    response.request,
    "Reopening a receipt reconstructs its exact historical query options"
  )
  assert.equal(
    wolframRequestFromEndpoint(WOLFRAM_RESULTS_ENDPOINT, "diamond", null),
    undefined,
    "Legacy receipts must not invent the units that were sent"
  )
  assert.equal(
    wolframRequestFromEndpoint(
      response.endpoint,
      "graphite",
      "crystalline carbon"
    ),
    undefined,
    "Unrelated inputs cannot be presented as options for this term"
  )
  for (const endpoint of [
    null,
    "malformed",
    "https://unrelated.example/?input=Diamond&units=metric",
    `${WOLFRAM_RESULTS_ENDPOINT}?input=Diamond&units=SI`
  ])
    assert.equal(
      wolframRequestFromEndpoint(endpoint, "diamond", null),
      undefined
    )

  const noResult = await retrieveWolframResources(
    "Diamond",
    "",
    "test-secret",
    (async () =>
      new Response("No Results Found", { status: 501 })) as typeof fetch
  )
  assert.deepEqual(noResult.references, [])
  assert.deepEqual(noResult.request.options, DEFAULT_WOLFRAM_OPTIONS)
  assert.deepEqual(
    wolframRequestFromEndpoint(noResult.endpoint, "diamond", null),
    noResult.request,
    "Empty results still retain the query that was attempted"
  )
  console.log(
    "Wolfram lookup options: defaults, bounded validation, native parameters, immutable raw evidence and request restoration passed."
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
