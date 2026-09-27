// What a stored citation shows on a definition page: the source, identifier,
// release and licence of a reference entry, or the prototype status of a
// Wolfram entry. Rendered without a browser or a database.
import assert from "node:assert/strict"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ReferenceSnapshot } from "../components/definition/reference-snapshot"

type Reference = Parameters<typeof ReferenceSnapshot>[0]["reference"]

const retrievedAt = "2026-09-27T10:00:00Z"
const entry = (overrides: Partial<Reference>): Reference => ({
  term: "water",
  definition: "An oxygen hydride.",
  sourceKey: "mdo",
  source: "Materials Design Ontology",
  sourceIri: "https://w3id.org/mdo/core/Water",
  version: "1.1",
  license: "MIT",
  usageStatus: "open",
  retrievedAt,
  ...overrides
})

/** The metadata line's text, with its link targets. */
function metadataLine(reference: Reference) {
  const html = renderToStaticMarkup(
    createElement(ReferenceSnapshot, { reference })
  )
  const lines = [
    ...html.matchAll(
      /<p class="break-words \[overflow-wrap:anywhere\]">(.*?)<\/p>/g
    )
  ]
  assert.equal(lines.length, 1, `one metadata line in ${html}`)
  const line = lines[0][1]
  return {
    text: line.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'"),
    links: [...line.matchAll(/href="([^"]*)"/g)].map((match) => match[1])
  }
}

// A known licence links to its text.
assert.deepEqual(metadataLine(entry({})), {
  text: "Materials Design Ontology · Water · release 1.1 · licence MIT",
  links: ["https://opensource.org/license/mit"]
})

// A licence without a known text is shown as stated.
assert.deepEqual(
  metadataLine(
    entry({
      term: "annealing",
      sourceKey: "nist-imrr",
      source: "Materials Data Vocabulary",
      sourceIri: "https://data.nist.gov/od/dm/nmrr/vocab/?tema=725",
      version: "1.1.0",
      license: "NIST-PD"
    })
  ),
  {
    text: "Materials Data Vocabulary · ?tema=725 · release 1.1.0 · licence NIST-PD",
    links: []
  }
)

// A ChEBI identifier keeps the publisher's form.
assert.deepEqual(
  metadataLine(
    entry({
      sourceKey: "chebi",
      source: "ChEBI CORE",
      sourceIri: "http://purl.obolibrary.org/obo/CHEBI_15377",
      version: "254",
      license: "CC-BY-4.0"
    })
  ),
  {
    text: "ChEBI CORE · CHEBI:15377 · release 254 · licence CC-BY-4.0",
    links: ["https://creativecommons.org/licenses/by/4.0/"]
  }
)

// An entry stored without a licence says so, and is not a prototype.
assert.deepEqual(metadataLine(entry({ license: null })), {
  text: "Materials Design Ontology · Water · release 1.1 · licence not stated",
  links: []
})

// A prototype source has no licence line. Its summary already names it.
assert.deepEqual(
  metadataLine(
    entry({
      sourceKey: "wolfram",
      source: "Wolfram|Alpha",
      sourceIri: "https://www.wolframalpha.com/input?i=water",
      version: "cag-v1",
      license: null,
      usageStatus: "prototype",
      query: "water"
    })
  ),
  { text: "Prototype use", links: [] }
)

console.log(
  "Reference snapshot: known and unknown licences, identifiers, an unstated licence and prototype use passed."
)
