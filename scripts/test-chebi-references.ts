import assert from "node:assert/strict"
import {
  referenceIdentifier,
  referenceLicenseUrl,
  referenceText
} from "../lib/reference-text"
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
// Another cleared source, with the licence the store states for it.
const mdoEntry = {
  term: "water",
  definition: "A molecule of two hydrogen atoms and one oxygen atom.",
  source: "Materials Design Ontology",
  sourceIri: "https://w3id.org/mdo/core/Water",
  sourceKey: "mdo",
  version: "1.1",
  license: "MIT"
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
  // Formula formatting stays keyed on ChEBI. Other sources show as stored.
  assert.equal(
    referenceText({ ...formula, sourceKey: "emmo" }),
    formula.definition
  )
  assert.equal(referenceIdentifier(entry), "CHEBI:15377")
  assert.equal(referenceIdentifier(mdoEntry), "Water")
  assert.equal(
    referenceIdentifier({
      sourceKey: "nist-imrr",
      sourceIri: "https://data.nist.gov/od/dm/nmrr/vocab/?tema=725"
    }),
    "?tema=725"
  )
  assert.equal(
    referenceLicenseUrl("CC-BY-4.0"),
    "https://creativecommons.org/licenses/by/4.0/"
  )
  assert.equal(referenceLicenseUrl("MIT"), "https://opensource.org/license/mit")
  assert.equal(referenceLicenseUrl("NIST-PD"), undefined)
  assert.equal(referenceLicenseUrl(null), undefined)
  let sent: URL | undefined
  const results = await retrieveChebiDefinitions(
    " water ",
    "http://localhost:3100",
    (async (url, init) => {
      sent = new URL(String(url))
      assert.equal(init?.redirect, "error")
      assert.ok(init?.signal)
      return reply([entry, entry, mdoEntry])
    }) as typeof fetch
  )
  assert.equal(sent!.pathname, "/grounding")
  assert.equal(sent!.searchParams.get("q"), "water")
  assert.equal(
    sent!.searchParams.get("sources"),
    null,
    "every cleared source answers"
  )
  assert.equal(sent!.searchParams.get("limit"), "8")
  assert.equal(results.length, 2)
  assert.match(results[0].contentHash, /^[a-f0-9]{64}$/)
  assert.deepEqual(
    { ...results[1], contentHash: undefined },
    { ...mdoEntry, contentHash: undefined },
    "an entry keeps the source, release and licence the store states"
  )
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
  for (const accepted of [
    { ...entry, sourceKey: "pmdco" },
    { ...entry, sourceKey: "nist-imrr", license: "NIST-PD" },
    { ...entry, sourceIri: "https://w3id.org/emmo#EMMO_9900d51c" },
    { ...entry, license: "unknown" }
  ])
    assert.equal(
      (
        await retrieveChebiDefinitions(
          "water",
          "http://local",
          fetcher(() => reply([accepted]))
        )
      ).length,
      1
    )
  for (const invalid of [
    { ...entry, sourceIri: "javascript:alert(1)" },
    { ...entry, sourceIri: "http://user:secret@example.org/CHEBI_1" },
    { ...entry, sourceIri: "http://example.org/a b" },
    { ...entry, definition: "" },
    { ...entry, sourceKey: "Not A Key" },
    { ...entry, license: "" },
    { ...entry, license: "x".repeat(201) },
    { ...entry, license: undefined }
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
    () => reply(Array(9).fill(entry)),
    () => new Response("x".repeat(128 * 1024 + 1))
  ])
    await assert.rejects(
      retrieveChebiDefinitions("water", "http://local", fetcher(response)),
      /reference lookup is unavailable/
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
    /reference lookup is unavailable/
  )
  const finish = beginReferenceLookup(90000001, 1000)
  assert.throws(() => beginReferenceLookup(90000001, 1001), /Please wait/)
  finish()
  for (let i = 0; i < 4; i++) beginReferenceLookup(90000001, 1002 + i)()
  assert.throws(() => beginReferenceLookup(90000001, 1010), /Please wait/)
  beginReferenceLookup(90000001, 62000)()
  console.log(
    "Reference provider: every source, bounds, metadata, safe links, deduplication, empty/error/timeout and request limits passed."
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
