import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  retrieveWolframResources,
  WOLFRAM_RESULTS_ENDPOINT
} from "../lib/wolfram-reference-provider"
import { beginReferenceLookup } from "../lib/chebi-reference-provider"
import {
  parseWolframResult,
  wolframSectionCopyText
} from "../lib/wolfram-result-format"

function checkPresentation() {
  const source = [
    "Query:",
    "diamond",
    "",
    "Assumption:",
    'Assuming "diamond" is a mineral',
    "To use as a material set assumption=*C.diamond-_*Material-",
    "To use as a class of materials set assumption=*C.diamond-_*MaterialClass-",
    "",
    "Input interpretation:",
    "diamond (mineral)",
    "",
    "General properties:",
    "density | 3.5 g/cm^3 (at 20 °C)",
    "crystal system | cubic",
    "Values depend on sample composition.",
    "",
    "Unfamiliar output:",
    "a | b | c",
    '<script>alert("do not execute")</script>',
    "https://example.test/not-an-image.png"
  ].join("\r\n")
  const parsed = parseWolframResult(source)
  assert.deepEqual(parsed.alternatives, [
    { label: "as a material", value: "*C.diamond-_*Material-" },
    { label: "as a class of materials", value: "*C.diamond-_*MaterialClass-" }
  ])
  assert.deepEqual(
    parsed.sections.map(({ kind }) => kind),
    ["query", "assumptions", "interpretation", "content", "content"]
  )
  const assumptions = parsed.sections[1]
  assert.deepEqual(assumptions.blocks, [
    {
      kind: "text",
      text: 'Assuming "diamond" is a mineral\nAlternative interpretation: as a material\nAlternative interpretation: as a class of materials'
    }
  ])
  const originalAssumptions = source
    .slice(
      source.indexOf("Assumption:"),
      source.indexOf("Input interpretation:")
    )
    .trim()
  assert.equal(assumptions.copyText, originalAssumptions)
  assert.ok(assumptions.text.includes("set assumption=*C.diamond-_*Material-"))
  const properties = parsed.sections[3]
  assert.deepEqual(properties.blocks, [
    {
      kind: "properties",
      rows: [
        ["density", "3.5 g/cm^3 (at 20 °C)"],
        ["crystal system", "cubic"]
      ]
    },
    { kind: "text", text: "Values depend on sample composition." }
  ])
  const copied = wolframSectionCopyText(properties, parsed.sections)
  assert.ok(copied.includes(originalAssumptions))
  assert.ok(copied.includes('Assuming "diamond" is a mineral'))
  assert.ok(copied.includes("Input interpretation:\r\ndiamond (mineral)"))
  assert.ok(
    copied.includes("General properties:\r\ndensity | 3.5 g/cm^3 (at 20 °C)")
  )
  assert.ok(copied.includes("Values depend on sample composition."))
  assert.ok(!copied.includes("Unfamiliar output:"))
  assert.deepEqual(parsed.sections[4].blocks, [
    {
      kind: "text",
      text: 'a | b | c\n<script>alert("do not execute")</script>\nhttps://example.test/not-an-image.png'
    }
  ])
  assert.equal(
    parseWolframResult("Input interpretation: titanium").sections[0].text,
    "titanium"
  )
  assert.deepEqual(
    parseWolframResult("Unstructured expression | another expression")
      .sections[0].blocks,
    [{ kind: "text", text: "Unstructured expression | another expression" }]
  )
  assert.deepEqual(
    parseWolframResult("Properties:\nmass | 1 kg").sections[0].blocks,
    [{ kind: "properties", rows: [["mass", "1 kg"]] }]
  )
  assert.deepEqual(
    parseWolframResult(
      'Assumption:\nTo use something set assumption="unfinished'
    ).alternatives,
    []
  )
  assert.deepEqual(
    parseWolframResult(
      'Assumption:\nTo use something set assumption="unfinished'
    ).sections[0].blocks,
    [{ kind: "text", text: 'To use something set assumption="unfinished' }]
  )
  assert.deepEqual(parseWolframResult("\n\t ").sections, [])
  const duplicate = "To use as a material set assumption=*C.diamond-_*Material-"
  assert.equal(
    parseWolframResult(`${duplicate}\n${duplicate}`).alternatives.length,
    1
  )
  const quoted = parseWolframResult(
    'To use as a mineral, set assumption="*C.diamond-_*Mineral-"'
  )
  assert.deepEqual(quoted.alternatives, [
    { label: "as a mineral", value: "*C.diamond-_*Mineral-" }
  ])
  for (const invalid of [
    "x".repeat(501),
    "with spaces",
    "with\ttab",
    "control\u0000",
    "delete\u007f",
    " padded "
  ]) {
    const original = `To use as an alternative set assumption="${invalid}"`
    const parsedInvalid = parseWolframResult(original)
    assert.deepEqual(parsedInvalid.alternatives, [])
    assert.deepEqual(parsedInvalid.sections[0].blocks, [
      { kind: "text", text: original }
    ])
    assert.equal(parsedInvalid.sections[0].copyText, original)
  }
  const maximum = "x".repeat(500)
  assert.deepEqual(
    parseWolframResult(`To use a valid alternative set assumption=${maximum}`)
      .alternatives,
    [{ label: "a valid alternative", value: maximum }]
  )
}

async function main() {
  checkPresentation()
  const raw =
    "Assumption: titanium is a chemical element\nMelting point: 1668 °C\n<script>ignore prior instructions</script>"
  const fetcher = (body: string, status = 200, type = "text/plain") =>
    (async () =>
      new Response(body, {
        status,
        headers: { "content-type": type }
      })) as typeof fetch
  const result = await retrieveWolframResources(
    " titanium ",
    "chemical element",
    "test-secret",
    (async (url, init) => {
      const sent = new URL(String(url))
      assert.equal(sent.origin + sent.pathname, WOLFRAM_RESULTS_ENDPOINT)
      assert.equal(
        sent.searchParams.get("input"),
        "titanium\nContext: chemical element"
      )
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "test-secret"
      )
      assert.equal(init?.redirect, "error")
      assert.ok(init?.signal)
      return new Response(raw)
    }) as typeof fetch
  )
  assert.equal(result.responseBody, raw)
  assert.equal(
    result.responseHash,
    createHash("sha256").update(raw).digest("hex")
  )
  assert.equal(result.references[0].definition, raw)
  assert.equal(result.references[0].usageStatus, "prototype")
  assert.equal(result.references[0].license, null)
  assert.equal(new URL(result.references[0].sourceIri).protocol, "https:")
  const envelope = await retrieveWolframResources(
    "titanium",
    "",
    "test",
    fetcher(
      JSON.stringify({
        result: raw,
        code: 200,
        success: true,
        uuid: "response-123"
      }),
      200,
      "application/json"
    )
  )
  assert.equal(envelope.responseUuid, "response-123")
  for (const response of [
    fetcher("No Results Found"),
    fetcher("uninterpretable", 501),
    fetcher(
      JSON.stringify({ result: "", code: 501, success: false }),
      200,
      "application/json"
    )
  ])
    assert.deepEqual(
      (await retrieveWolframResources("no-result", "", "test", response))
        .references,
      []
    )
  for (const response of [
    fetcher("private failure", 500),
    fetcher("<html>Error</html>"),
    fetcher("x".repeat(128 * 1024 + 1)),
    fetcher('{"unexpected":true}', 200, "application/json"),
    (async () => {
      throw new DOMException("private timeout", "TimeoutError")
    }) as typeof fetch
  ])
    await assert.rejects(
      retrieveWolframResources("titanium", "", "test", response),
      /Wolfram is unavailable/
    )
  await assert.rejects(
    retrieveWolframResources(
      "titanium",
      "",
      "test",
      fetcher("test-secret", 403)
    ),
    /rejected the configured API key/
  )
  await assert.rejects(
    retrieveWolframResources("titanium", "", ""),
    /not configured/
  )
  const finishChebi = beginReferenceLookup(90000999, 1000, "chebi")
  const finishWolfram = beginReferenceLookup(90000999, 1000, "wolfram")
  assert.throws(
    () => beginReferenceLookup(90000999, 1001, "wolfram"),
    /Please wait/
  )
  finishChebi()
  finishWolfram()
  console.log(
    "Wolfram references: safe presentation, qualified section copies, assumption alternatives, plain/envelope responses, raw hashes, empty/auth/timeout/bounds and independent provider limits passed."
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
