import assert from "node:assert/strict"
import { DiffOp } from "diff-match-patch-ts"
import { DataFactory, Parser, Store } from "n3"
import type { Quad } from "n3"
import {
  assembleTermSkos,
  termJsonLd,
  termTurtle,
  type TermSkosRows
} from "../lib/skos"
import { TTL_PREFIXES, type KosData } from "../lib/kos-export"
import {
  identifierBaseUrl,
  revisionUri,
  termUri
} from "../lib/public-identifiers"
import {
  metadataAssertionFact,
  metadataAssertionEvidenceTurtle,
  metadataAssertionUri,
  type MetadataAssertionRow
} from "../lib/term-metadata-rdf"
import {
  ProvenanceDatasetView,
  provenanceDatasetBlocksTurtle,
  type ProvenanceDatasetData
} from "../lib/graph/provenance-dataset"
import { provenanceTurtle } from "../lib/provenance-rdf"
import { turtleJsonLd } from "../lib/rdf-jsonld"
import { metadataPredicateIri } from "../lib/dictionary-metadata"

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
const PROV = "http://www.w3.org/ns/prov#"
const DCT = "http://purl.org/dc/terms/"
const SKOS = "http://www.w3.org/2004/02/skos/core#"
const XSD = "http://www.w3.org/2001/XMLSchema#"
const m = (local: string) => `${identifierBaseUrl}/metadata#${local}`
const term = {
  id: 11,
  term: "deposit",
  slug: "deposit",
  vocabularySlug: "metadata_fixture",
  createdAt: "2026-09-20T10:00:00Z"
}
const uri = termUri(term.slug, term.vocabularySlug)
const revision1 = revisionUri(term.slug, 2, 1, term.vocabularySlug)
const revision2 = revisionUri(term.slug, 2, 2, term.vocabularySlug)
const when = "2026-09-20T10:00:00Z"
const fixture = (
  number: number,
  patch: Partial<MetadataAssertionRow> = {}
): MetadataAssertionRow => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  termId: term.id,
  definitionRevisionId: null,
  fieldKey: "alternateLabel",
  valueType: "text",
  value: 'A "deposit"\n層',
  language: "de",
  sourceIri: "https://sources.example/report",
  sourceLabel: "Reference report",
  sourceVersion: "1",
  assertedById: 1,
  createdAt: when,
  status: "accepted",
  reviewedById: 2,
  reviewedAt: when,
  retractedById: null,
  retractedAt: null,
  ...patch
})
const assertions = [
  fixture(1),
  fixture(2, { assertedById: 2, sourceVersion: "2" }),
  fixture(3, {
    status: "proposed",
    value: "SECRET PROPOSAL",
    reviewedAt: null,
    reviewedById: null,
    sourceIri: "https://secret.example/proposal"
  }),
  fixture(4, {
    status: "rejected",
    value: "SECRET REJECTION",
    sourceIri: "https://secret.example/rejection"
  }),
  fixture(5, {
    fieldKey: "usageNote",
    value: "Retracted usage",
    retractedAt: "2026-09-21T10:00:00Z",
    retractedById: 2
  }),
  fixture(6, {
    fieldKey: "usedAsValueFor",
    valueType: "iri",
    value: "https://fields.example/processing-method",
    language: null,
    definitionRevisionId: 102
  }),
  fixture(7, {
    fieldKey: "usageNote",
    value: "Old wording only",
    language: "en",
    definitionRevisionId: 101
  }),
  fixture(8, {
    fieldKey: "relatedConcept",
    valueType: "iri",
    value: "https://ontology.example/deposition",
    language: null
  }),
  fixture(9, {
    fieldKey: "describesMetadataField",
    valueType: "iri",
    value: "https://fields.example/processing-method",
    language: null
  })
]
const data: ProvenanceDatasetData = {
  users: [
    { id: 1, name: "Contributor One", isAi: false, isProfilePublic: false },
    { id: 2, name: "Contributor Two", isAi: false, isProfilePublic: true }
  ],
  models: [],
  terms: [term],
  definitions: [{ id: 21, termId: term.id, definitionNumber: 2 }],
  revisions: [
    { id: 101, definitionId: 21, version: 1 },
    { id: 102, definitionId: 21, version: 2 }
  ],
  concepts: [],
  collections: [],
  assertions: [],
  metadataAssertions: assertions,
  voteEvents: [],
  walkthroughComments: [],
  studies: []
}
const kos: KosData = {
  schemes: [],
  concepts: [],
  collections: [],
  statements: [],
  terms: []
}
const rows: TermSkosRows = {
  terms: [term],
  definitions: [
    {
      id: 21,
      termId: term.id,
      definitionNumber: 2,
      definitionCreatedAt: when,
      revisionDefinition: [[DiffOp.Insert, "Current definition"]],
      revisionExample: [],
      legacyExample: "",
      revisionVersion: 2,
      revisionCreatedAt: when,
      revisionModel: null,
      score: 0,
      authorName: "Contributor One",
      authorIsAi: false
    }
  ],
  coauthors: [],
  metadata: assertions.map((assertion) => ({
    assertion,
    definitionNumber: assertion.definitionRevisionId ? 2 : null,
    revisionVersion:
      assertion.definitionRevisionId === 101
        ? 1
        : assertion.definitionRevisionId === 102
          ? 2
          : null,
    currentRevisionId: assertion.definitionRevisionId ? 102 : null
  }))
}
const quads = (ttl: string) => new Parser().parse(ttl)
const key = (quad: Quad) =>
  JSON.stringify([
    quad.subject.termType,
    quad.subject.value,
    quad.predicate.value,
    quad.object.termType,
    quad.object.value,
    quad.object.termType === "Literal" ? quad.object.language : "",
    quad.object.termType === "Literal" ? quad.object.datatype.value : ""
  ])
const keySet = (items: Quad[]) => new Set(items.map(key))
const objects = (store: Store, subject: string, predicate: string) =>
  store.getObjects(subject, predicate, null)
function assertJsonLdEquivalent(turtle: string) {
  const expanded = turtleJsonLd(turtle)
  const reconstructed: Quad[] = []
  const ref = (id: string) =>
    id.startsWith("_:")
      ? DataFactory.blankNode(id.slice(2))
      : DataFactory.namedNode(id)
  for (const node of expanded) {
    for (const [predicate, raw] of Object.entries(node)) {
      if (predicate === "@id") continue
      for (const value of raw as Record<string, string>[]) {
        const object = value["@id"]
          ? ref(value["@id"])
          : value["@language"]
            ? DataFactory.literal(value["@value"], value["@language"])
            : DataFactory.literal(
                value["@value"],
                DataFactory.namedNode(value["@type"] ?? `${XSD}string`)
              )
        reconstructed.push(
          DataFactory.quad(
            ref(node["@id"] as string),
            DataFactory.namedNode(predicate),
            object
          )
        )
      }
    }
  }
  assert.deepEqual(
    keySet(reconstructed),
    keySet(quads(turtle)),
    "Expanded JSON-LD preserves every Turtle triple, term kind, language and datatype"
  )
}

const [skos] = assembleTermSkos(rows, kos)
const currentTurtle = termTurtle(skos, kos)
const current = new Store(quads(currentTurtle))
assert.equal(
  objects(current, uri, `${SKOS}altLabel`).length,
  1,
  "Two attestations of one fact yield one graph fact"
)
assert.equal(
  objects(current, uri, `${SKOS}altLabel`)[0].value,
  assertions[0].value
)
assert.equal(
  objects(current, revision2, m("usedAsValueFor"))[0].value,
  assertions[5].value
)
assert.equal(
  objects(current, uri, m("usedAsValueFor")).length,
  0,
  "Revision metadata is never lifted to its term"
)
assert.equal(
  objects(current, revision1, `${SKOS}scopeNote`).length,
  0,
  "Historical revision annotations do not migrate to new wording"
)
assert.equal(
  objects(current, uri, `${SKOS}scopeNote`).length,
  0,
  "Retracted metadata is absent from the current graph"
)
assert.equal(
  objects(current, uri, m("relatedConcept"))[0].value,
  assertions[7].value
)
assert.equal(
  objects(current, uri, m("describesMetadataField"))[0].value,
  assertions[8].value
)
assert.ok(!currentTurtle.includes("SECRET"))
assert.ok(
  !currentTurtle.includes("exactMatch") && !currentTurtle.includes("sameAs"),
  "Neutral context creates no equivalence"
)
assert.equal(
  current.getQuads(null, "https://fields.example/processing-method", null, null)
    .length,
  0,
  "A dictionary link is not a dataset field/value instance"
)
assertJsonLdEquivalent(currentTurtle)
const compact = termJsonLd(skos, kos) as Record<string, unknown>
assert.deepEqual(compact[`${SKOS}altLabel`], [
  { "@value": assertions[0].value, "@language": "de" }
])
const revisionJson = (
  compact["skos:definition"] as Record<string, unknown>[]
)[0]
assert.deepEqual(revisionJson[m("usedAsValueFor")], [
  { "@id": assertions[5].value }
])

// An authorless definition is excluded by the public-definition loader, but
// the independent metadata query can still return its current revision.
const [withoutPublicDefinitions] = assembleTermSkos(
  { ...rows, definitions: [] },
  kos
)
const withoutDefinitionsTurtle = new Store(
  quads(termTurtle(withoutPublicDefinitions, kos))
)
assert.equal(
  objects(withoutDefinitionsTurtle, revision2, m("usedAsValueFor")).length,
  0,
  "Revision metadata is excluded with its non-public definition"
)
assert.deepEqual(
  withoutPublicDefinitions.metadata,
  skos.metadata?.filter((fact) => fact.subject === uri)
)
const withoutDefinitionsJson = termJsonLd(
  withoutPublicDefinitions,
  kos
) as Record<string, unknown>
assert.deepEqual(withoutDefinitionsJson["skos:definition"], [])
assert.equal(
  objects(withoutDefinitionsTurtle, uri, `${SKOS}altLabel`)[0].value,
  assertions[0].value,
  "Term-wide metadata remains public even without a public definition"
)
assert.deepEqual(withoutDefinitionsJson[`${SKOS}altLabel`], [
  { "@value": assertions[0].value, "@language": "de" }
])

const view = new ProvenanceDatasetView(data)
const historyTurtle = TTL_PREFIXES + provenanceDatasetBlocksTurtle(view)
const history = new Store(quads(historyTurtle))
assert.equal(
  history.getSubjects(`${RDF}type`, m("MetadataAssertion"), null).length,
  7,
  "All seven independently accepted attestations survive, including retraction"
)
assert.ok(
  !historyTurtle.includes("SECRET") &&
    !historyTurtle.includes("https://secret.example")
)
for (const row of assertions.filter((item) => item.status === "accepted")) {
  const evidence = view.metadataAssertionEvidence(row)
  assert.equal(
    objects(history, evidence.uri, `${RDF}subject`)[0].value,
    evidence.fact.subject
  )
  assert.equal(
    objects(history, evidence.uri, `${RDF}predicate`)[0].value,
    metadataPredicateIri(row.fieldKey, identifierBaseUrl)
  )
  assert.equal(
    objects(history, evidence.uri, `${RDF}object`)[0].value,
    row.value
  )
  assert.equal(
    objects(history, evidence.uri, `${DCT}source`)[0].value,
    row.sourceIri
  )
  assert.equal(
    objects(history, evidence.uri, m("sourceVersion"))[0].value,
    row.sourceVersion
  )
}
const first = metadataAssertionUri(uri, assertions[0].id)
const independent = metadataAssertionUri(uri, assertions[1].id)
assert.notEqual(first, independent)
assert.notEqual(
  objects(history, first, `${PROV}wasAttributedTo`)[0].value,
  objects(history, independent, `${PROV}wasAttributedTo`)[0].value
)
assert.equal(
  objects(
    history,
    metadataAssertionUri(uri, assertions[4].id),
    `${PROV}invalidatedAtTime`
  ).length,
  1
)
assert.equal(
  objects(history, revision1, `${SKOS}scopeNote`).length,
  0,
  "History reifies the old fact without asserting it"
)
assert.equal(
  objects(
    history,
    metadataAssertionUri(revision1, assertions[6].id),
    `${RDF}subject`
  )[0].value,
  revision1
)
assertJsonLdEquivalent(historyTurtle)
assert.equal(
  provenanceDatasetBlocksTurtle(
    new ProvenanceDatasetView({
      ...data,
      metadataAssertions: [...assertions].reverse()
    })
  ),
  provenanceDatasetBlocksTurtle(view)
)

const prov = {
  term,
  graph: {
    nodes: assertions.map((row) => {
      const evidence = view.metadataAssertionEvidence(row)
      return {
        id: `metadata_${row.id}`,
        label: row.value,
        type: "entity" as const,
        detail: row.value,
        publicResource: { uri: evidence.uri },
        metadataAssertion: evidence
      }
    }),
    edges: []
  }
}
const termHistoryTurtle = provenanceTurtle(prov)
assert.ok(
  !termHistoryTurtle.includes("SECRET"),
  "Public provenance serializer rejects private metadata nodes defensively"
)
assertJsonLdEquivalent(termHistoryTurtle)
assert.equal(
  metadataAssertionEvidenceTurtle(
    view.metadataAssertionEvidence(assertions[2])
  ),
  ""
)
assert.throws(
  () => metadataAssertionFact(assertions[5], term),
  /exact definition revision/
)
assert.throws(
  () =>
    metadataAssertionFact(assertions[5], term, {
      id: 102,
      termId: 999,
      definitionNumber: 1,
      version: 1
    }),
  /exact definition revision/
)
assert.throws(
  () => metadataAssertionFact({ ...assertions[0], language: 'en";bad' }, term),
  /language/
)
assert.throws(
  () =>
    metadataAssertionFact(
      { ...assertions[7], value: "https://example.test/> <bad>" },
      term
    ),
  /safe absolute IRI/
)
console.log(
  "Metadata RDF tests passed: accepted/current scoping, historical attestations, independent authors/sources, safe literals/IRIs, neutral relations and Turtle/JSON-LD equivalence."
)
