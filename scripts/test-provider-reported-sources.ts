import assert from "node:assert/strict"
import { Parser } from "n3"
import { providerReportedSources } from "../lib/provider-reported-sources"
import { inferenceProperties, type InferenceMetadata } from "../lib/llm/types"
import { provenanceTurtle } from "../lib/provenance-rdf"
import { applicationMetadataUri } from "../lib/public-identifiers"

const metadata: InferenceMetadata = {
  provider: "wolfram-agent-one",
  profile: "agent-one",
  model: "wolfram-agent-one",
  configHash: "test-config",
  responseId: "provider-response-uuid"
}
const firstUrl = "https://www.wolframalpha.com/input?i=ceric+oxide+properties"
const secondUrl =
  "https://www.wolframalpha.com/input?i=ceric+oxide+chemical+structure"
const answer = String.raw`Ceric oxide is a metal oxide with the formula CeO₂.

---

#### Wolfram Sources

- Wolfram|Alpha: [\[1\]](${firstUrl}) [\[2\]](${secondUrl})`
const reported = [{ url: firstUrl }, { url: secondUrl }]
assert.deepEqual(providerReportedSources(metadata, answer), reported)
assert.deepEqual(providerReportedSources(null, answer), [])
assert.deepEqual(providerReportedSources(undefined, answer), [])
assert.deepEqual(
  providerReportedSources({ ...metadata, provider: "ollama" }, answer),
  [],
  "do not infer returned sources from unrelated model or human text"
)
assert.deepEqual(
  providerReportedSources({ ...metadata, reportedSources: [] }, answer),
  [],
  "explicit empty stored sources must not trigger legacy fallback"
)
assert.deepEqual(
  providerReportedSources({ ...metadata, reportedSources: reported }, ""),
  reported,
  "stored source metadata does not depend on later output edits"
)
assert.deepEqual(
  providerReportedSources(metadata, `[Source](${firstUrl})`),
  [],
  "ordinary answer links are not a Wolfram Sources footer"
)
assert.deepEqual(
  providerReportedSources(metadata, `\`\`\`markdown\n${answer}\n\`\`\``),
  [],
  "a footer quoted inside a code block is not a source declaration"
)
assert.deepEqual(
  providerReportedSources(
    metadata,
    `${answer}\n\n#### Other content\n\n[Unrelated](https://example.test/other)`
  ),
  reported,
  "source extraction ends at the next heading"
)
assert.deepEqual(
  providerReportedSources(
    metadata,
    `${answer}\n\n- [Duplicate](${firstUrl})\n- [Reference documentation](https://reference.wolfram.com/test "Wolfram reference")`
  ),
  [
    ...reported,
    { url: "https://reference.wolfram.com/test", title: "Wolfram reference" }
  ]
)

for (const url of [
  "javascript:alert(1)",
  "data:text/html,unsafe",
  "file:///tmp/source",
  "//example.test/source",
  "https://name:password@example.test/source",
  "https://name@example.test/source",
  "https://example.test/a\nb",
  "https://example.test/a\\b",
  "https://example.test/" + "x".repeat(2048)
])
  assert.deepEqual(
    providerReportedSources(
      { ...metadata, reportedSources: [{ url }] },
      answer
    ),
    [],
    `reject unsafe or oversized stored URL: ${url.slice(0, 55)}`
  )
assert.deepEqual(
  providerReportedSources(
    metadata,
    "#### Wolfram Sources\n\n- [Bad](javascript:alert(1))\n- [Bad](https://name:password@example.test/source)\n- [Good](https://example.test/good)"
  ),
  [{ url: "https://example.test/good", title: "Good" }]
)
assert.deepEqual(
  providerReportedSources(
    {
      ...metadata,
      reportedSources: [
        { url: firstUrl, title: "x".repeat(201) },
        { url: secondUrl, title: "Unsafe\u0000title" }
      ]
    },
    ""
  ),
  reported,
  "unsafe or oversized titles are omitted without discarding safe links"
)
const many = Array.from({ length: 150 }, (_, index) => ({
  url: `https://example.test/${index}`
}))
assert.deepEqual(
  providerReportedSources({ ...metadata, reportedSources: many }, ""),
  many.slice(0, 10)
)
assert.deepEqual(
  providerReportedSources(
    metadata,
    "#### Wolfram Sources\n\n" +
      many.map(({ url }) => `- [Source](${url})`).join("\n")
  ).map(({ url }) => url),
  many.slice(0, 10).map(({ url }) => url),
  "parsed output is bounded to ten sources"
)
assert.deepEqual(
  providerReportedSources(metadata, "x".repeat(10001) + answer),
  [],
  "oversized legacy text is not parsed"
)

const turtle = provenanceTurtle({
  term: {
    id: 1,
    term: "ceric oxide",
    slug: "ceric-oxide",
    vocabularySlug: "id4"
  },
  events: [],
  graph: {
    nodes: [
      {
        id: "generation",
        type: "activity",
        label: "Generate definition",
        meta: {
          ...inferenceProperties(metadata),
          sourceRevisionId: 17,
          outputDefinitionId: 18,
          requestedById: 19
        }
      }
    ],
    edges: []
  }
})
const triples = new Parser().parse(turtle)
assert(
  triples.some(
    ({ predicate, object }) =>
      predicate.value === applicationMetadataUri("inferenceResponseId") &&
      object.value === metadata.responseId
  ),
  "external response UUID is retained in valid RDF"
)
for (const property of [
  "sourceRevisionId",
  "outputDefinitionId",
  "requestedById"
])
  assert(
    !triples.some(
      ({ predicate }) => predicate.value === applicationMetadataUri(property)
    ),
    "database identifiers remain excluded from public RDF"
  )
assert(!turtle.includes("prov:used"))
assert(!turtle.includes("http://purl.org/dc/terms/references"))
console.log(
  "Provider-reported source boundaries and external response UUID RDF checks passed."
)
