import assert from "node:assert/strict"
import { referenceText } from "../lib/reference-text"
import {
  beginReferenceLookup,
  retrieveChebiDefinitions
} from "../lib/chebi-reference-provider"

const entry = {
  term: "water",
  definition: "An oxygen hydride.",
  source: "ChEBI (CORE)",
  sourceIri: "http://purl.obolibrary.org/obo/CHEBI_15377",
  sourceKey: "chebi",
  version: "254",
  license: "CC-BY-4.0"
}
const reply = (results: unknown[], query = "water") =>
  new Response(JSON.stringify({ query, results }))
const fetcher = (response: () => Response) =>
  (async () => response()) as typeof fetch

async function main() {
  const formula = {
    ...entry,
    definition: "TiO<small><sub>2</sub></small> and Fe<sup>3+</sup>."
  }
  assert.equal(referenceText(formula), "TiO₂ and Fe³⁺.")
  assert.equal(
    formula.definition,
    "TiO<small><sub>2</sub></small> and Fe<sup>3+</sup>."
  )
  const literal = '<img src="https://invalid.example/leak">'
  assert.equal(referenceText({ ...entry, definition: literal }), literal)
  assert.equal(
    referenceText({ ...formula, sourceKey: "wolfram" }),
    formula.definition
  )
  let sent: URL | undefined
  const results = await retrieveChebiDefinitions(
    " water ",
    "http://localhost:3100",
    (async (url, init) => {
      sent = new URL(String(url))
      assert.equal(init?.redirect, "error")
      assert.ok(init?.signal)
      return reply([entry, entry])
    }) as typeof fetch
  )
  assert.equal(sent!.pathname, "/grounding")
  assert.equal(sent!.searchParams.get("q"), "water")
  assert.equal(sent!.searchParams.get("sources"), "chebi")
  assert.equal(sent!.searchParams.get("limit"), "5")
  assert.equal(results.length, 1)
  assert.match(results[0].contentHash, /^[a-f0-9]{64}$/)
  const again = await retrieveChebiDefinitions(
    "water",
    "http://local",
    fetcher(() => reply([entry]))
  )
  assert.equal(again[0].contentHash, results[0].contentHash)
  assert.deepEqual(
    await retrieveChebiDefinitions(
      "water",
      "http://local",
      fetcher(() => reply([]))
    ),
    []
  )
  for (const invalid of [
    { ...entry, sourceIri: "javascript:alert(1)" },
    { ...entry, sourceIri: "http://purl.obolibrary.org/obo/BFO_0000001" },
    { ...entry, definition: "" },
    { ...entry, sourceKey: "pmdco" },
    { ...entry, license: "unknown" }
  ])
    assert.deepEqual(
      await retrieveChebiDefinitions(
        "water",
        "http://local",
        fetcher(() => reply([invalid]))
      ),
      []
    )
  for (const response of [
    () => new Response("private upstream details", { status: 500 }),
    () => new Response("not JSON"),
    () => reply([entry], "another query"),
    () => reply(Array(6).fill(entry)),
    () => new Response("x".repeat(128 * 1024 + 1))
  ])
    await assert.rejects(
      retrieveChebiDefinitions("water", "http://local", fetcher(response)),
      /ChEBI is unavailable/
    )
  await assert.rejects(retrieveChebiDefinitions("water", ""), /not configured/)
  await assert.rejects(
    retrieveChebiDefinitions("water", "http://user:secret@local"),
    /not configured correctly/
  )
  await assert.rejects(
    retrieveChebiDefinitions("water", "http://local", (async () => {
      throw new DOMException("private timeout detail", "TimeoutError")
    }) as typeof fetch),
    /ChEBI is unavailable/
  )
  const finish = beginReferenceLookup(90000001, 1000)
  assert.throws(() => beginReferenceLookup(90000001, 1001), /Please wait/)
  finish()
  for (let i = 0; i < 4; i++) beginReferenceLookup(90000001, 1002 + i)()
  assert.throws(() => beginReferenceLookup(90000001, 1010), /Please wait/)
  beginReferenceLookup(90000001, 62000)()
  console.log(
    "ChEBI provider: bounds, metadata, safe links, deduplication, empty/error/timeout and request limits passed."
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
