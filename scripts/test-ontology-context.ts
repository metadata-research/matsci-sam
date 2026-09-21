import assert from "node:assert/strict"
import {
  fetchOntologyCandidates,
  fetchOntologyHierarchy,
  ontologyCandidatesInput,
  ontologyHierarchyInput,
  OntologyContextError
} from "../lib/ontology-context"

const privateBase = "http://private-service.test/ontology"
const publicBase = "https://public.example/ont"
const entityIri = "http://purl.obolibrary.org/obo/CHEBI_15377"
const parentIri = "http://purl.obolibrary.org/obo/CHEBI_33693"
const source = {
  key: "chebi",
  title: "ChEBI CORE",
  version: "254",
  license: "CC-BY-4.0"
}
const candidate = { iri: entityIri, label: "water", match: "exact" }
const candidateResponse = {
  query: "water",
  mode: "exact",
  sources: [{ source, candidates: [candidate], truncated: false }]
}
const hierarchyResponse = {
  source,
  entity: { iri: entityIri, label: "water" },
  parents: [
    {
      iri: parentIri,
      label: "oxygen hydride",
      predicate: "http://www.w3.org/2000/01/rdf-schema#subClassOf",
      direction: "outgoing"
    }
  ],
  truncated: false,
  hasAnonymousSuperclasses: false
}
const selection = { source: "chebi", iri: entityIri }
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  })
const safeError = (error: unknown) =>
  error instanceof OntologyContextError &&
  !String(error).includes("private-service") &&
  !String(error).includes("upstream-secret")
const candidatesFrom = (value: unknown, mode?: "exact" | "similar") =>
  fetchOntologyCandidates("water", {
    baseUrl: privateBase,
    mode,
    fetcher: async () => reply(value)
  })
const hierarchyFrom = (value: unknown, publicUrl = "") =>
  fetchOntologyHierarchy(selection, {
    baseUrl: privateBase,
    publicUrl,
    fetcher: async () => reply(value)
  })

async function main() {
  let calls = 0
  const candidates = await fetchOntologyCandidates(" water ", {
    baseUrl: privateBase,
    fetcher: async (input, init) => {
      calls++
      const url = new URL(String(input))
      assert.equal(url.origin + url.pathname, `${privateBase}/candidates`)
      assert.equal(url.searchParams.get("q"), "water")
      assert.equal(url.searchParams.get("mode"), "exact")
      assert.equal(url.searchParams.get("limitPerSource"), "5")
      assert.equal(init?.redirect, "error")
      assert.equal(init?.cache, "no-store")
      assert(init?.signal)
      assert.equal(new Headers(init?.headers).get("authorization"), null)
      return reply({ ...candidateResponse, endpoint: "upstream-secret" })
    }
  })
  assert.equal(calls, 1)
  assert.deepEqual(candidates, candidateResponse)
  assert(!JSON.stringify(candidates).includes("upstream-secret"))
  assert.deepEqual(
    await candidatesFrom({ ...candidateResponse, sources: [] }),
    {
      ...candidateResponse,
      sources: []
    }
  )
  const sources = Array.from({ length: 32 }, (_, index) => ({
    ...candidateResponse.sources[0],
    source: { ...source, key: `source-${index}` }
  }))
  assert.equal(
    (await candidatesFrom({ ...candidateResponse, sources })).sources.length,
    32
  )
  for (const invalid of [
    { ...candidateResponse, query: "another term" },
    { ...candidateResponse, sources: [...sources, sources[0]] },
    { ...candidateResponse, sources: [sources[0], sources[0]] },
    {
      ...candidateResponse,
      sources: [{ source, candidates: [], truncated: false }]
    },
    {
      ...candidateResponse,
      sources: [
        { source, candidates: Array(6).fill(candidate), truncated: true }
      ]
    },
    {
      ...candidateResponse,
      sources: [
        { source, candidates: [candidate, candidate], truncated: false }
      ]
    },
    {
      ...candidateResponse,
      sources: [
        {
          source,
          candidates: [{ ...candidate, iri: "javascript:alert(1)" }],
          truncated: false
        }
      ]
    },
    {
      ...candidateResponse,
      sources: [
        {
          source,
          candidates: [{ ...candidate, match: "definition" }],
          truncated: false
        }
      ]
    }
  ])
    await assert.rejects(candidatesFrom(invalid), safeError)

  const similarCandidate = {
    iri: "http://purl.obolibrary.org/obo/CHEBI_41981",
    label: "heavy water",
    match: "label"
  }
  const similarResponse = {
    query: "water",
    mode: "similar",
    sources: [{ source, candidates: [similarCandidate], truncated: false }]
  }
  const similar = await fetchOntologyCandidates("water", {
    baseUrl: privateBase,
    mode: "similar",
    fetcher: async (input) => {
      const url = new URL(String(input))
      assert.equal(url.searchParams.get("mode"), "similar")
      assert.equal(url.searchParams.get("q"), "water")
      assert.equal(url.searchParams.get("limitPerSource"), "5")
      return reply(similarResponse)
    }
  })
  assert.deepEqual(similar, similarResponse)
  assert.deepEqual(
    await candidatesFrom({ ...similarResponse, sources: [] }, "similar"),
    { ...similarResponse, sources: [] }
  )
  const trimmed = await fetchOntologyCandidates(" Water ", {
    baseUrl: privateBase,
    fetcher: async () =>
      reply({
        ...candidateResponse,
        query: " WATER ",
        sources: [
          {
            source,
            candidates: [{ ...candidate, label: "\u00a0WATER\ufeff" }],
            truncated: false
          }
        ]
      })
  })
  assert.equal(trimmed.sources[0].candidates[0].label, "WATER")
  for (const invalid of [
    { ...candidateResponse, mode: undefined },
    { ...candidateResponse, mode: "all" },
    { ...candidateResponse, mode: "similar" },
    similarResponse,
    { ...similarResponse, mode: "exact" },
    {
      ...candidateResponse,
      sources: [
        {
          source,
          candidates: [{ ...candidate, label: "heavy water" }],
          truncated: false
        }
      ]
    },
    {
      ...candidateResponse,
      sources: [
        {
          source,
          candidates: [{ ...candidate, label: "(water)" }],
          truncated: false
        }
      ]
    },
    {
      ...candidateResponse,
      sources: [
        { source, candidates: [candidate, similarCandidate], truncated: false }
      ]
    }
  ])
    await assert.rejects(candidatesFrom(invalid), safeError)
  for (const invalid of [
    candidateResponse,
    { ...similarResponse, mode: "exact" },
    { ...candidateResponse, mode: "similar" },
    {
      ...similarResponse,
      sources: [
        {
          source,
          candidates: [{ ...candidate, match: "label", label: " Water " }],
          truncated: false
        }
      ]
    },
    {
      ...similarResponse,
      sources: [
        {
          source,
          candidates: [{ ...similarCandidate, match: "exact" }],
          truncated: false
        }
      ]
    },
    {
      ...similarResponse,
      sources: [
        { source, candidates: [candidate, similarCandidate], truncated: false }
      ]
    }
  ])
    await assert.rejects(candidatesFrom(invalid, "similar"), safeError)

  const hierarchy = await fetchOntologyHierarchy(selection, {
    baseUrl: privateBase,
    publicUrl: publicBase,
    fetcher: async (input) => {
      const url = new URL(String(input))
      assert.equal(url.origin + url.pathname, `${privateBase}/hierarchy`)
      assert.equal(url.searchParams.get("source"), "chebi")
      assert.equal(url.searchParams.get("iri"), entityIri)
      return reply({
        ...hierarchyResponse,
        browseUrl: "https://untrusted.example/"
      })
    }
  })
  const browse = new URL(hierarchy.browseUrl!)
  assert.equal(browse.origin + browse.pathname, `${publicBase}/entity`)
  assert.equal(browse.searchParams.get("source"), "chebi")
  assert.equal(browse.searchParams.get("iri"), entityIri)
  assert.deepEqual(hierarchy.parents, hierarchyResponse.parents)
  assert(!JSON.stringify(hierarchy).includes("private-service"))
  assert(!JSON.stringify(hierarchy).includes("untrusted.example"))
  const incoming = {
    ...hierarchyResponse,
    parents: [
      {
        iri: parentIri,
        predicate: "http://www.w3.org/2004/02/skos/core#narrower",
        direction: "incoming"
      }
    ],
    hasAnonymousSuperclasses: true,
    truncated: true
  }
  assert.deepEqual(await hierarchyFrom(incoming), incoming)
  const broader = {
    ...hierarchyResponse,
    parents: [
      {
        ...hierarchyResponse.parents[0],
        predicate: "http://www.w3.org/2004/02/skos/core#broader"
      }
    ]
  }
  assert.deepEqual(await hierarchyFrom(broader), broader)
  assert.deepEqual(await hierarchyFrom({ ...hierarchyResponse, parents: [] }), {
    ...hierarchyResponse,
    parents: []
  })
  for (const invalid of [
    { ...hierarchyResponse, source: { ...source, key: "another" } },
    { ...hierarchyResponse, entity: { iri: parentIri, label: "different" } },
    {
      ...hierarchyResponse,
      parents: Array(51).fill(hierarchyResponse.parents[0])
    },
    {
      ...hierarchyResponse,
      parents: [{ ...hierarchyResponse.parents[0], iri: "file:///etc/passwd" }]
    },
    {
      ...hierarchyResponse,
      parents: [{ ...hierarchyResponse.parents[0], direction: "sideways" }]
    },
    {
      ...hierarchyResponse,
      parents: [{ ...hierarchyResponse.parents[0], direction: "incoming" }]
    },
    {
      ...broader,
      parents: [{ ...broader.parents[0], direction: "incoming" }]
    },
    {
      ...incoming,
      parents: [{ ...incoming.parents[0], direction: "outgoing" }]
    },
    {
      ...hierarchyResponse,
      parents: [
        {
          ...hierarchyResponse.parents[0],
          predicate: "http://www.w3.org/2004/02/skos/core#related"
        }
      ]
    }
  ])
    await assert.rejects(hierarchyFrom(invalid), safeError)
  for (const invalidPublicUrl of [
    "",
    "file:///private",
    "https://user:upstream-secret@public.example",
    "https://public.example/?token=upstream-secret",
    "https://public.example/#fragment"
  ])
    assert.equal(
      (await hierarchyFrom(hierarchyResponse, invalidPublicUrl)).browseUrl,
      undefined
    )

  for (const invalidBase of [
    "",
    "upstream-secret",
    "file:///private",
    "https://user:upstream-secret@private-service.test/",
    "https://private-service.test/?token=upstream-secret",
    "https://private-service.test/#fragment"
  ])
    await assert.rejects(
      fetchOntologyCandidates("water", {
        baseUrl: invalidBase,
        fetcher: async () => {
          throw new Error("Must not fetch")
        }
      }),
      safeError
    )
  for (const response of [
    () => new Response("upstream-secret", { status: 500 }),
    () => new Response("upstream-secret"),
    () => new Response("x".repeat(128 * 1024 + 1)),
    () => new Response(null)
  ])
    await assert.rejects(
      fetchOntologyCandidates("water", {
        baseUrl: privateBase,
        fetcher: async () => response()
      }),
      safeError
    )
  await assert.rejects(
    fetchOntologyHierarchy(selection, {
      baseUrl: privateBase,
      fetcher: async () => {
        throw new DOMException("upstream-secret", "TimeoutError")
      }
    }),
    safeError
  )
  let cancelled = false
  await assert.rejects(
    fetchOntologyHierarchy(selection, {
      baseUrl: privateBase,
      fetcher: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(65 * 1024))
              controller.enqueue(new Uint8Array(65 * 1024))
            },
            cancel() {
              cancelled = true
            }
          })
        )
    }),
    safeError
  )
  assert.equal(cancelled, true, "oversized provider streams are cancelled")

  assert.deepEqual(ontologyCandidatesInput.parse({ term: " water " }), {
    term: "water",
    mode: "exact"
  })
  assert.deepEqual(
    ontologyCandidatesInput.parse({ term: "water", mode: "similar" }),
    {
      term: "water",
      mode: "similar"
    }
  )
  for (const invalid of [
    { term: "" },
    { term: "x".repeat(201) },
    { term: "water", mode: "all" },
    { term: "water", mode: "EXACT" },
    { term: "water", mode: null },
    { term: "water", mode: true },
    { term: "water", endpoint: "https://untrusted.example" }
  ])
    assert.equal(ontologyCandidatesInput.safeParse(invalid).success, false)
  for (const invalid of [
    { ...selection, source: "../admin" },
    { ...selection, source: "-source" },
    { ...selection, iri: "http://user:secret@example.org/" },
    { ...selection, iri: "https://example.org/" + "a".repeat(2048) },
    { ...selection, iri: "https://example.org/a b" },
    { ...selection, endpoint: "https://untrusted.example" }
  ])
    assert.equal(ontologyHierarchyInput.safeParse(invalid).success, false)
  console.log(
    "Ontology context: exact-default and explicit similar modes, response identity, bounded responses, hierarchy directions, safe public links and errors passed."
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
