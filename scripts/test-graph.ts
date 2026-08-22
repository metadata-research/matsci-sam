/*
 * Pure checks for the graph layer: the graph names, the dataset-wide
 * provenance emitters, the meta graph, and the disjointness of the four
 * content graphs, all from in-memory fixtures parsed back with n3. No
 * database and no Fuseki. Run as
 *
 *   tsx --conditions=react-server scripts/test-graph.ts [--export <dir>]
 *
 * so the "server-only" imports resolve to their empty variant. With
 * --export the fixture documents are written for the CI SHACL step, along
 * with three documents that deliberately break one shape each: one names a
 * person, one breaks the kos rules, one breaks the provenance rules.
 * scripts/test-graph-db.ts holds the checks that need a database and a
 * store.
 */

import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { DiffOp } from "diff-match-patch-ts"
import type { Diff } from "diff-match-patch-ts"
import { Parser } from "n3"
import type { Quad, Term } from "n3"

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
const RDFS = "http://www.w3.org/2000/01/rdf-schema#"
const PROV = "http://www.w3.org/ns/prov#"
const DCT = "http://purl.org/dc/terms/"
const OWL = "http://www.w3.org/2002/07/owl#"
const VOID = "http://rdfs.org/ns/void#"
const SD = "http://www.w3.org/ns/sparql-service-description#"
const XSD_DATETIME = "http://www.w3.org/2001/XMLSchema#dateTime"

const main = async () => {
  // lib/skos.ts and lib/graph/documents.ts import @yamz/db, which builds a
  // pool lazily and never connects here (same arrangement as test:kos).
  process.env.DATABASE_URL ??= "postgresql:///graph-test"

  const exportDir = (() => {
    const argv = process.argv.slice(2)
    const at = argv.indexOf("--export")
    return at === -1 ? null : (argv[at + 1] ?? null)
  })()

  const names = await import("../lib/graph/names")
  const {
    ProvenanceDatasetView,
    agentBlockTurtle,
    assertionBlockTurtle,
    provenanceDatasetBlocksTurtle,
    studyBlockTurtle,
    voteEventBlockTurtle
  } = await import("../lib/graph/provenance-dataset")
  type ProvenanceDatasetData =
    import("../lib/graph/provenance-dataset").ProvenanceDatasetData
  type AssertionRow = import("../lib/graph/provenance-dataset").AssertionRow
  const {
    countTriples,
    kosGraphTurtle,
    matCoreGraphTurtle,
    provenanceGraphTurtle,
    vocabularyGraphTurtle
  } = await import("../lib/graph/documents")
  const { metaGraphTurtle } = await import("../lib/graph/void")
  const { provenanceBodyTurtle } = await import("../lib/provenance-rdf")
  type Provenance = Parameters<typeof provenanceBodyTurtle>[0]
  const { assembleTermSkos } = await import("../lib/skos")
  const { TTL_PREFIXES } = await import("../lib/kos-export")
  type KosData = import("../lib/kos-export").KosData
  const {
    applicationMetadataUri,
    collectionUri,
    conceptUri,
    definitionUri,
    identifierBaseUrl,
    modelUri,
    revisionUri,
    statementUri,
    studyUri,
    termUri
  } = await import("../lib/public-identifiers")
  const { SITE_URL } = await import("../lib/site")

  const matsci = (name: string) => applicationMetadataUri(name)

  // --- Parsing helpers ---

  const parse = (text: string, label: string): Quad[] => {
    try {
      return new Parser().parse(text)
    } catch (error) {
      throw new Error(
        `${label} does not parse: ${(error as Error).message}\n${text}`
      )
    }
  }
  const objectsOf = (quads: Quad[], subject: string, predicate: string) =>
    quads.filter(
      (q) => q.subject.value === subject && q.predicate.value === predicate
    )
  const values = (quads: Quad[], subject: string, predicate: string) =>
    objectsOf(quads, subject, predicate).map((q) => q.object.value)
  const types = (quads: Quad[], subject: string) =>
    values(quads, subject, `${RDF}type`).sort()
  const subjects = (quads: Quad[]) => new Set(quads.map((q) => q.subject.value))
  // Type sets compare sorted, because the identifier base decides whether a
  // matsci: IRI sorts before or after a prov: one.
  const assertTypes = (quads: Quad[], subject: string, expected: string[]) =>
    assert.deepEqual(types(quads, subject), [...expected].sort(), subject)

  // n3 2.2 parses an RDF 1.2 triple term as a Quad-valued object, which the
  // 1.x typings do not know, so the walkers below read terms loosely.
  type AnyTerm = {
    termType: string
    value: string
    subject?: AnyTerm
    predicate?: AnyTerm
    object?: AnyTerm
    language?: string
    datatype?: { value: string }
  }
  const loose = (t: Term) => t as unknown as AnyTerm

  // One canonical string per triple, triple terms included, so two
  // documents can be compared as sets without trusting their text.
  const termKey = (term: Term): string => {
    const t = loose(term)
    switch (t.termType) {
      case "Quad":
        return `<<(${termKey(t.subject as Term)} ${termKey(t.predicate as Term)} ${termKey(t.object as Term)})>>`
      case "Literal":
        return `${JSON.stringify(t.value)}@${t.language}^^<${t.datatype?.value}>`
      case "BlankNode":
        return `_:${t.value}`
      default:
        return `<${t.value}>`
    }
  }
  const tripleKeys = (quads: Quad[]) =>
    new Set(
      quads.map(
        (q) => `${termKey(q.subject)} ${termKey(q.predicate)} ${termKey(q.object)}`
      )
    )

  // Every IRI a document mentions, inside triple terms too.
  const irisIn = (quads: Quad[]): string[] => {
    const out: string[] = []
    const visit = (term: Term) => {
      const t = loose(term)
      if (t.termType === "NamedNode") out.push(t.value)
      else if (t.termType === "Quad") {
        visit(t.subject as Term)
        visit(t.predicate as Term)
        visit(t.object as Term)
      }
    }
    for (const q of quads) {
      visit(q.subject)
      visit(q.predicate)
      visit(q.object)
    }
    return out
  }

  // --- Graph names ---

  assert.deepEqual(
    [...names.GRAPH_NAMES],
    ["vocabulary", "kos", "provenance", "matcore", "meta"]
  )
  assert.deepEqual(
    [...names.CONTENT_GRAPH_NAMES],
    ["vocabulary", "kos", "provenance", "matcore"]
  )
  assert.ok(names.isGraphName("kos"))
  assert.ok(names.isGraphName("meta"))
  assert.ok(!names.isGraphName("people"))
  assert.ok(!names.isGraphName(""))
  assert.equal(names.graphPath("kos"), "/graphs/kos")
  assert.equal(names.graphIri("kos"), `${identifierBaseUrl}/graphs/kos`)
  assert.equal(names.datasetIri, `${identifierBaseUrl}/dataset`)
  // The endpoint is at the application origin; names.ts says why.
  assert.equal(names.sparqlEndpointUrl, `${SITE_URL}/sparql`)
  assert.equal(studyUri("id4-pilot"), `${identifierBaseUrl}/studies/id4-pilot`)

  // --- Fixtures: four accounts of four kinds, three terms, a bridge, a
  // retraction, a legacy row, votes from both records, two studies ---

  const PMD = "https://w3id.org/pmd/co/PMD_0000934"
  const EMMO = "https://w3id.org/emmo#EMMO_03441eb3_d1fd_4906_b953_b83312d7589e"

  const assertion = (
    id: number,
    predicate: AssertionRow["predicate"],
    ends: Partial<Omit<AssertionRow, "id" | "key" | "predicate">>
  ): AssertionRow => ({
    id,
    key: `k${id}`,
    predicate,
    subjectTermId: null,
    subjectDefinitionId: null,
    subjectConceptId: null,
    subjectCollectionId: null,
    objectTermId: null,
    objectConceptId: null,
    objectIri: null,
    assertedById: 1,
    createdAt: `2026-03-0${id} 10:00:00.5+00`,
    retractedAt: null,
    retractedById: null,
    ...ends
  })

  const data: ProvenanceDatasetData = {
    users: [
      // A person with a public profile, a person without one, a model, a
      // simulated persona (an AI identity with no aiModels row), a person
      // with no name, and a person who only votes and is private.
      { id: 1, name: "Ada", isAi: false, isProfilePublic: true },
      { id: 2, name: "Bob", isAi: false, isProfilePublic: false },
      { id: 3, name: "gemma4:26b", isAi: true, isProfilePublic: false },
      { id: 4, name: "Persona 1", isAi: true, isProfilePublic: false },
      { id: 5, name: null, isAi: false, isProfilePublic: false },
      { id: 6, name: "Carol", isAi: false, isProfilePublic: false }
    ],
    models: [{ userId: 3, slug: "gemma4-26b", tag: "gemma4:26b" }],
    terms: [
      { id: 1, slug: "martensite" },
      { id: 2, slug: "austenite" },
      { id: 3, slug: "band_gap" },
      // With band_gap, a pair a locale collation and code-point order sort
      // differently ("_" against "/"), so the agent order is pinned.
      { id: 4, slug: "band" }
    ],
    definitions: [
      { id: 10, termId: 1, definitionNumber: 1 },
      { id: 11, termId: 1, definitionNumber: 2 },
      { id: 12, termId: 2, definitionNumber: 1 }
    ],
    revisions: [
      { id: 100, definitionId: 10, version: 1 },
      { id: 101, definitionId: 10, version: 2 },
      { id: 102, definitionId: 11, version: 1 },
      { id: 103, definitionId: 12, version: 1 }
    ],
    concepts: [
      { id: 1, schemeSlug: "pspp", slug: "processing" },
      { id: 5, schemeSlug: "topics", slug: "steel" },
      { id: 6, schemeSlug: "topics", slug: "metals" },
      { id: 8, schemeSlug: "topics", slug: "corrosion" }
    ],
    collections: [
      { id: 1, slug: "demo-terms" },
      { id: 2, slug: "retired-set" }
    ],
    assertions: [
      // term subject, concept object
      assertion(1, "dcterms:subject", {
        subjectTermId: 1,
        objectConceptId: 1
      }),
      // definition subject, asserted by a model
      assertion(2, "dcterms:subject", {
        subjectDefinitionId: 10,
        objectConceptId: 5,
        assertedById: 3
      }),
      // concept subject, asserted by a private person
      assertion(3, "skos:broader", {
        subjectConceptId: 5,
        objectConceptId: 6,
        assertedById: 2
      }),
      // collection subject
      assertion(4, "skos:member", { subjectCollectionId: 1, objectTermId: 1 }),
      // external IRI object, retracted by someone else
      assertion(5, "skos:closeMatch", {
        subjectTermId: 1,
        objectIri: PMD,
        retractedAt: "2026-04-01 12:00:00+00",
        retractedById: 2
      }),
      // the bridge, asserted by a simulated persona
      assertion(6, "skos:exactMatch", {
        subjectConceptId: 8,
        objectTermId: 1,
        assertedById: 4
      }),
      // a migrated legacy row with no asserter
      assertion(7, "skos:related", {
        subjectTermId: 1,
        objectTermId: 3,
        assertedById: null
      }),
      // asserted and retracted by an account with no name
      assertion(8, "skos:broader", {
        subjectTermId: 2,
        objectTermId: 1,
        assertedById: 5,
        retractedAt: "2026-04-02 12:00:00+00",
        retractedById: 5
      }),
      // a concept mapping to an external IRI
      assertion(9, "skos:exactMatch", {
        subjectConceptId: 5,
        objectIri: EMMO
      }),
      // retracted, so the kos fixture need not know the terms: one on band
      // and one on band_gap, whose agent nodes are the pair that a locale
      // collation and code-point order sort differently
      assertion(10, "dcterms:subject", {
        subjectTermId: 4,
        objectConceptId: 1,
        createdAt: "2026-03-10 10:00:00+00",
        retractedAt: "2026-04-03 12:00:00+00",
        retractedById: 1
      }),
      assertion(11, "dcterms:subject", {
        subjectTermId: 3,
        objectConceptId: 1,
        createdAt: "2026-03-11 10:00:00+00",
        retractedAt: "2026-04-03 12:00:00+00",
        retractedById: 1
      })
    ],
    voteEvents: [
      {
        id: 1,
        definitionId: 10,
        revisionId: 100,
        userId: 1,
        kind: "up",
        actorKind: "human",
        createdAt: "2026-05-01 09:00:00+00"
      },
      {
        id: 2,
        definitionId: 10,
        revisionId: 100,
        userId: 2,
        kind: "down",
        actorKind: "human",
        createdAt: "2026-05-01 09:05:00+00"
      },
      {
        id: 3,
        definitionId: 10,
        revisionId: 100,
        userId: 2,
        kind: null,
        actorKind: "human",
        createdAt: "2026-05-01 09:06:00+00"
      },
      {
        id: 4,
        definitionId: 11,
        revisionId: 102,
        userId: 3,
        kind: "up",
        actorKind: "model",
        createdAt: "2026-05-02 09:00:00+00"
      },
      {
        id: 5,
        definitionId: 11,
        revisionId: 102,
        userId: 4,
        kind: "up",
        actorKind: "simulated",
        createdAt: "2026-05-02 09:01:00+00"
      },
      {
        id: 6,
        definitionId: 10,
        revisionId: 100,
        userId: 6,
        kind: "up",
        actorKind: "human",
        createdAt: "2026-05-03 09:00:00+00"
      }
    ],
    votes: [
      // covered by event 1, so not a legacy act
      {
        revisionId: 100,
        definitionId: 10,
        userId: 1,
        kind: "up",
        createdAt: "2026-05-01 09:00:00+00",
        migratedLegacy: false
      },
      // three pre-0040 votes on one revision: ordered by time, then user
      {
        revisionId: 103,
        definitionId: 12,
        userId: 2,
        kind: "down",
        createdAt: "2026-02-02 00:00:00+00",
        migratedLegacy: true
      },
      {
        revisionId: 103,
        definitionId: 12,
        userId: 1,
        kind: "up",
        createdAt: "2026-02-01 00:00:00+00",
        migratedLegacy: false
      },
      {
        revisionId: 103,
        definitionId: 12,
        userId: 3,
        kind: "up",
        createdAt: "2026-02-02 00:00:00+00",
        migratedLegacy: true
      }
    ],
    studies: [
      {
        id: 1,
        slug: "id4-pilot",
        title: "ID4 pilot",
        collectionId: 1,
        opensAt: "2026-09-01 00:00:00+00",
        closesAt: "2026-09-08 00:00:00+00",
        retiredAt: null
      },
      {
        id: 2,
        slug: "old-study",
        title: 'An "old" study',
        collectionId: 2,
        opensAt: null,
        closesAt: null,
        retiredAt: "2026-01-01 00:00:00+00"
      }
    ]
  }

  const view = new ProvenanceDatasetView(data)
  const datasetBlocks = provenanceDatasetBlocksTurtle(view)
  const dataset = parse(TTL_PREFIXES + datasetBlocks, "dataset blocks")

  const martensite = termUri("martensite")
  const austenite = termUri("austenite")
  const personUnder = (slug: string, id: number) =>
    `${termUri(slug)}/provenance#user_${id}`
  const quadOf = (q: Quad) => {
    const inner = loose(q.object)
    assert.equal(inner.termType, "Quad", "rdf:reifies takes a triple term")
    return [inner.subject!.value, inner.predicate!.value, inner.object!.value]
  }
  const reified = (subject: string) => {
    const [q, ...more] = objectsOf(dataset, subject, `${RDF}reifies`)
    assert.ok(q, `${subject} reifies something`)
    assert.equal(more.length, 0, `${subject} reifies one triple`)
    return quadOf(q)
  }

  // --- Assertions: every subject kind, every object kind, both states ---

  const a1 = statementUri(martensite, "k1")
  assertTypes(dataset, a1, [matsci("Assertion"), `${PROV}Entity`])
  assert.deepEqual(reified(a1), [
    martensite,
    `${DCT}subject`,
    conceptUri("pspp", "processing")
  ])
  assert.deepEqual(values(dataset, a1, `${PROV}wasAttributedTo`), [
    personUnder("martensite", 1)
  ])
  const [generated] = objectsOf(dataset, a1, `${PROV}generatedAtTime`)
  assert.equal(generated.object.termType, "Literal")
  assert.equal(loose(generated.object).datatype?.value, XSD_DATETIME)
  assert.equal(generated.object.value, "2026-03-01T10:00:00.500Z")
  assert.equal(values(dataset, a1, `${PROV}invalidatedAtTime`).length, 0)
  assert.equal(values(dataset, a1, matsci("retractedBy")).length, 0)

  // A definition subject is under its term, and a model is its own agent.
  const a2 = statementUri(definitionUri("martensite", 1), "k2")
  assert.deepEqual(reified(a2), [
    definitionUri("martensite", 1),
    `${DCT}subject`,
    conceptUri("topics", "steel")
  ])
  assert.deepEqual(values(dataset, a2, `${PROV}wasAttributedTo`), [
    modelUri("gemma4-26b")
  ])

  // A concept subject has no term above it: the agent is a hash node on the
  // concept, public profile or not.
  const steel = conceptUri("topics", "steel")
  const a3 = statementUri(steel, "k3")
  assert.deepEqual(reified(a3), [
    steel,
    "http://www.w3.org/2004/02/skos/core#broader",
    conceptUri("topics", "metals")
  ])
  assert.deepEqual(values(dataset, a3, `${PROV}wasAttributedTo`), [
    `${steel}#user_2`
  ])

  const demo = collectionUri("demo-terms")
  const a4 = statementUri(demo, "k4")
  assert.deepEqual(reified(a4), [
    demo,
    "http://www.w3.org/2004/02/skos/core#member",
    martensite
  ])
  assert.deepEqual(values(dataset, a4, `${PROV}wasAttributedTo`), [
    `${demo}#user_1`
  ])

  // Retracted: the assertion stays, with the time and the retractor.
  const a5 = statementUri(martensite, "k5")
  assert.deepEqual(reified(a5), [
    martensite,
    "http://www.w3.org/2004/02/skos/core#closeMatch",
    PMD
  ])
  assert.deepEqual(values(dataset, a5, `${PROV}invalidatedAtTime`), [
    "2026-04-01T12:00:00.000Z"
  ])
  assert.deepEqual(values(dataset, a5, matsci("retractedBy")), [
    personUnder("martensite", 2)
  ])

  // The bridge is reified in its stored direction, concept to term, and a
  // simulated persona is a software agent on the concept.
  const corrosion = conceptUri("topics", "corrosion")
  const a6 = statementUri(corrosion, "k6")
  assert.deepEqual(reified(a6), [
    corrosion,
    "http://www.w3.org/2004/02/skos/core#exactMatch",
    martensite
  ])
  assert.deepEqual(values(dataset, a6, `${PROV}wasAttributedTo`), [
    `${corrosion}#user_4`
  ])

  // A legacy row has no asserter and no attribution, and a symmetric
  // predicate is reified once, as stored.
  const a7 = statementUri(martensite, "k7")
  assert.deepEqual(reified(a7), [
    martensite,
    "http://www.w3.org/2004/02/skos/core#related",
    termUri("band_gap")
  ])
  assert.equal(values(dataset, a7, `${PROV}wasAttributedTo`).length, 0)
  assert.equal(values(dataset, a7, `${PROV}generatedAtTime`).length, 1)

  const a8 = statementUri(austenite, "k8")
  assert.deepEqual(values(dataset, a8, `${PROV}wasAttributedTo`), [
    personUnder("austenite", 5)
  ])
  assert.deepEqual(values(dataset, a8, matsci("retractedBy")), [
    personUnder("austenite", 5)
  ])

  const a9 = statementUri(steel, "k9")
  assert.deepEqual(reified(a9), [
    steel,
    "http://www.w3.org/2004/02/skos/core#exactMatch",
    EMMO
  ])

  const assertionSubjects = [...subjects(dataset)].filter((s) =>
    s.includes("#statement-")
  )
  assert.equal(assertionSubjects.length, data.assertions.length)
  // The reified triples are not asserted: no quad of the dataset blocks has
  // a statement subject-predicate pair from the ledger.
  assert.ok(
    !dataset.some((q) => q.predicate.value === `${DCT}subject`),
    "the kos triple is reified, not asserted, in the provenance graph"
  )

  // --- Vote events: both records, withdrawal, the three agent cases ---

  const rev100 = revisionUri("martensite", 1, 1)
  const rev102 = revisionUri("martensite", 2, 1)
  const rev103 = revisionUri("austenite", 1, 1)
  const acts = view.voteActs()
  assert.deepEqual(
    acts.map((a) => a.iri),
    [
      `${rev100}#vote-event-1`,
      `${rev100}#vote-event-2`,
      `${rev100}#vote-event-3`,
      `${rev102}#vote-event-4`,
      `${rev102}#vote-event-5`,
      `${rev100}#vote-event-6`,
      // legacy: by (createdAt, userId) on the revision, 1-based
      `${rev103}#vote-1`,
      `${rev103}#vote-2`,
      `${rev103}#vote-3`
    ]
  )

  const e1 = `${rev100}#vote-event-1`
  assertTypes(dataset, e1, [`${PROV}Activity`, matsci("VoteEvent")])
  assert.deepEqual(values(dataset, e1, `${PROV}used`), [rev100])
  assert.deepEqual(values(dataset, e1, matsci("voteKind")), ["up"])
  assert.deepEqual(values(dataset, e1, matsci("actorKind")), ["human"])
  assert.deepEqual(values(dataset, e1, `${PROV}atTime`), [
    "2026-05-01T09:00:00.000Z"
  ])
  // Public profile: the person is named, on the term's document.
  assert.deepEqual(values(dataset, e1, `${PROV}wasAssociatedWith`), [
    personUnder("martensite", 1)
  ])
  assert.equal(
    values(dataset, e1, matsci("legacyAssociationInferred")).length,
    0
  )

  // Private profile: the act is published, the agent is not.
  const e2 = `${rev100}#vote-event-2`
  assert.deepEqual(values(dataset, e2, matsci("voteKind")), ["down"])
  assert.equal(values(dataset, e2, `${PROV}wasAssociatedWith`).length, 0)

  const e3 = `${rev100}#vote-event-3`
  assert.deepEqual(values(dataset, e3, matsci("voteKind")), ["withdrawn"])
  assert.equal(values(dataset, e3, `${PROV}wasAssociatedWith`).length, 0)

  // A model votes as itself; a simulated persona as its AI identity node.
  const e4 = `${rev102}#vote-event-4`
  assert.deepEqual(values(dataset, e4, matsci("actorKind")), ["model"])
  assert.deepEqual(values(dataset, e4, `${PROV}wasAssociatedWith`), [
    modelUri("gemma4-26b")
  ])
  const e5 = `${rev102}#vote-event-5`
  assert.deepEqual(values(dataset, e5, matsci("actorKind")), ["simulated"])
  assert.deepEqual(values(dataset, e5, `${PROV}wasAssociatedWith`), [
    personUnder("martensite", 4)
  ])

  // Legacy acts: numbered by time then user; the migrated ones say their
  // binding was inferred; the model's act is a model act.
  const l1 = `${rev103}#vote-1`
  assertTypes(dataset, l1, [`${PROV}Activity`, matsci("VoteEvent")])
  assert.deepEqual(values(dataset, l1, `${PROV}used`), [rev103])
  assert.deepEqual(values(dataset, l1, matsci("voteKind")), ["up"])
  assert.deepEqual(values(dataset, l1, matsci("actorKind")), ["human"])
  assert.equal(
    values(dataset, l1, matsci("legacyAssociationInferred")).length,
    0
  )
  assert.deepEqual(values(dataset, l1, `${PROV}wasAssociatedWith`), [
    personUnder("austenite", 1)
  ])
  const l2 = `${rev103}#vote-2`
  assert.deepEqual(values(dataset, l2, matsci("voteKind")), ["down"])
  assert.deepEqual(values(dataset, l2, matsci("legacyAssociationInferred")), [
    "yes"
  ])
  assert.equal(values(dataset, l2, `${PROV}wasAssociatedWith`).length, 0)
  const l3 = `${rev103}#vote-3`
  assert.deepEqual(values(dataset, l3, matsci("actorKind")), ["model"])
  assert.deepEqual(values(dataset, l3, `${PROV}wasAssociatedWith`), [
    modelUri("gemma4-26b")
  ])
  // The vote covered by an event is not synthesized again.
  assert.equal(values(dataset, `${rev100}#vote-1`, `${PROV}used`).length, 0)

  // --- Studies ---

  const s1 = studyUri("id4-pilot")
  assertTypes(dataset, s1, [`${PROV}Activity`, matsci("Study")])
  assert.deepEqual(values(dataset, s1, `${DCT}title`), ["ID4 pilot"])
  assert.deepEqual(values(dataset, s1, `${PROV}startedAtTime`), [
    "2026-09-01T00:00:00.000Z"
  ])
  assert.deepEqual(values(dataset, s1, `${PROV}endedAtTime`), [
    "2026-09-08T00:00:00.000Z"
  ])
  assert.deepEqual(values(dataset, s1, matsci("worklist")), [demo])
  assert.equal(values(dataset, s1, `${OWL}deprecated`).length, 0)

  const s2 = studyUri("old-study")
  assert.deepEqual(values(dataset, s2, `${DCT}title`), ['An "old" study'])
  assert.equal(values(dataset, s2, `${PROV}startedAtTime`).length, 0)
  assert.equal(values(dataset, s2, `${PROV}endedAtTime`).length, 0)
  assert.deepEqual(values(dataset, s2, matsci("worklist")), [
    collectionUri("retired-set")
  ])
  assert.deepEqual(values(dataset, s2, `${OWL}deprecated`), ["true"])
  // Nothing about who took part.
  assert.ok(
    !dataset.some(
      (q) =>
        q.subject.value.startsWith(`${identifierBaseUrl}/studies/`) &&
        [`${PROV}wasAssociatedWith`, `${PROV}wasAttributedTo`].includes(
          q.predicate.value
        )
    )
  )

  // --- Agents: one block per referenced IRI, typed by account kind ---

  const agents = view.referencedAgents()
  assert.deepEqual(
    agents.map((a) => a.iri),
    [...agents.map((a) => a.iri)].sort(),
    "agent blocks are in code-point IRI order"
  )
  // The pair the two orders disagree on, in the order a store sorts IRIs:
  // "/" before "_" by code point, the other way round under ICU.
  assert.deepEqual(
    agents.map((a) => a.iri).filter((iri) => iri.includes("/band")),
    [personUnder("band", 1), personUnder("band_gap", 1)]
  )
  const agentByIri = new Map(agents.map((a) => [a.iri, a]))
  assert.deepEqual(agentByIri.get(personUnder("martensite", 1)), {
    iri: personUnder("martensite", 1),
    type: "prov:Person",
    label: "Ada"
  })
  assert.deepEqual(agentByIri.get(modelUri("gemma4-26b")), {
    iri: modelUri("gemma4-26b"),
    type: "prov:SoftwareAgent",
    label: "gemma4:26b"
  })
  assert.deepEqual(agentByIri.get(`${corrosion}#user_4`), {
    iri: `${corrosion}#user_4`,
    type: "prov:SoftwareAgent",
    label: "Persona 1"
  })
  assert.deepEqual(agentByIri.get(personUnder("austenite", 5)), {
    iri: personUnder("austenite", 5),
    type: "prov:Person",
    label: "User 5"
  })
  // Bob retracted on martensite, so that node exists; the private voter
  // Carol is referenced by nothing and has no node anywhere.
  assert.ok(agentByIri.has(personUnder("martensite", 2)))
  assert.ok(!agentByIri.has(personUnder("martensite", 6)))
  assert.ok(!datasetBlocks.includes("user_6"))
  assert.ok(!datasetBlocks.includes("Carol"))
  for (const agent of agents) {
    assertTypes(dataset, agent.iri, [
      agent.type === "prov:Person" ? `${PROV}Person` : `${PROV}SoftwareAgent`
    ])
    assert.deepEqual(values(dataset, agent.iri, `${RDFS}label`), [agent.label])
  }
  assert.equal(
    parse(TTL_PREFIXES + agentBlockTurtle(agents[0]), "agent block").length,
    2
  )

  // The single-block emitters agree with the document.
  assert.ok(datasetBlocks.includes(assertionBlockTurtle(view, data.assertions[4])))
  assert.ok(datasetBlocks.includes(voteEventBlockTurtle(view, acts[8])))
  assert.ok(datasetBlocks.includes(studyBlockTurtle(view, data.studies[1])))

  // Determinism: the same rows in another order render the same bytes.
  const shuffled = new ProvenanceDatasetView({
    ...data,
    assertions: [...data.assertions].reverse(),
    voteEvents: [...data.voteEvents].reverse(),
    votes: [...data.votes].reverse(),
    studies: [...data.studies].reverse(),
    users: [...data.users].reverse()
  })
  assert.equal(provenanceDatasetBlocksTurtle(shuffled), datasetBlocks)

  // A fixture that names a revision the view does not know fails loudly,
  // as a loader that forgot a table should.
  assert.throws(
    () =>
      new ProvenanceDatasetView({
        ...data,
        revisions: []
      }).voteActs(),
    RangeError
  )

  // --- The per-term body: split identities and the omitted triples ---

  const rev1 = revisionUri("martensite", 1, 1)
  const rev2 = revisionUri("martensite", 1, 2)
  const def1 = definitionUri("martensite", 1)
  const prov: Provenance = {
    term: { id: 1, term: "martensite", slug: "martensite" },
    events: [],
    graph: {
      nodes: [
        {
          id: "term_1",
          label: "martensite",
          type: "term",
          publicResource: { uri: martensite },
          meta: { created: "2026-01-02 03:04:05" }
        },
        {
          id: "def_10_v1",
          label: "Definition 1 · revision 1",
          type: "entity",
          publicResource: { uri: rev1, specializationOf: def1 },
          detail: "A hard phase.",
          meta: { definitionId: 10, version: 1, current: "no" }
        },
        {
          id: "def_10_v2",
          label: "Definition 1 · revision 2 (current)",
          type: "entity",
          publicResource: {
            uri: rev2,
            specializationOf: def1,
            wasRevisionOf: rev1
          },
          detail: 'A hard phase with a "body-centred" tetragonal lattice.',
          meta: { definitionId: 10, version: 2, current: "yes" }
        },
        {
          id: "act_revision_101",
          label: "Edit definition",
          type: "activity",
          meta: { at: "2026-01-03T00:00:00.000Z", revisionId: 101 }
        },
        { id: "user_1", label: "Ada", type: "person" },
        { id: "user_4", label: "Persona 1", type: "software" },
        // A model with a profile, as the dataset graph names it.
        {
          id: "model_gemma4:26b",
          label: "gemma4:26b",
          type: "software",
          publicResource: { uri: modelUri("gemma4-26b") }
        },
        {
          id: "comment_7",
          label: "Comment on definition 1 · revision 2",
          type: "activity",
          meta: {
            at: "2026-05-01 08:00:00+00",
            actorKind: "simulated",
            legacyAssociationInferred: "no"
          }
        },
        {
          id: "anonymous_vote_1",
          label: "Upvote on definition 1 · revision 2",
          type: "activity",
          meta: { at: "2026-05-01 09:00:00+00", actorKind: "human" }
        }
      ],
      edges: [
        {
          id: "e1",
          source: "def_10_v1",
          target: "term_1",
          rel: "wasDerivedFrom"
        },
        {
          id: "e2",
          source: "def_10_v2",
          target: "def_10_v1",
          rel: "wasDerivedFrom"
        },
        {
          id: "e3",
          source: "def_10_v2",
          target: "act_revision_101",
          rel: "wasGeneratedBy"
        },
        {
          id: "e4",
          source: "act_revision_101",
          target: "user_1",
          rel: "wasAssociatedWith"
        },
        {
          id: "e5",
          source: "def_10_v2",
          target: "user_1",
          rel: "wasAttributedTo"
        },
        {
          id: "e6",
          source: "anonymous_vote_1",
          target: "def_10_v2",
          rel: "used"
        },
        {
          id: "e7",
          source: "def_10_v1",
          target: "model_gemma4:26b",
          rel: "wasAttributedTo"
        },
        {
          id: "e8",
          source: "comment_7",
          target: "user_4",
          rel: "wasAssociatedWith"
        }
      ]
    }
  }

  const bodyAlone = provenanceBodyTurtle(prov)
  const bodyInGraph = provenanceBodyTurtle(prov, { vocabularyTriples: false })
  const alone = parse(TTL_PREFIXES + bodyAlone, "per-term body")
  const inGraph = parse(TTL_PREFIXES + bodyInGraph, "per-term body in graph")

  // The person node of the body is the agent node of the dataset blocks.
  assert.ok(subjects(alone).has(personUnder("martensite", 1)))
  assert.equal(
    personUnder("martensite", 1),
    view.assertionAgent(data.assertions[0], 1).iri
  )
  assert.equal(personUnder("martensite", 1), view.voteAgent(acts[0]).iri)
  assert.deepEqual(types(inGraph, personUnder("martensite", 4)), [
    `${PROV}SoftwareAgent`
  ])
  // A model with a profile is its own IRI in both renderings, and the
  // revision it generated is attributed to that IRI.
  assertTypes(inGraph, modelUri("gemma4-26b"), [`${PROV}SoftwareAgent`])
  assert.deepEqual(values(inGraph, rev1, `${PROV}wasAttributedTo`), [
    modelUri("gemma4-26b")
  ])
  assert.equal(view.assertionAgent(data.assertions[1], 3).iri, modelUri("gemma4-26b"))
  // A comment states its actor kind as a literal, the spelling the vote
  // events use, and the persona it is associated with is a software agent.
  const comment = `${martensite}/provenance#comment_7`
  assert.deepEqual(values(inGraph, comment, matsci("actorKind")), ["simulated"])
  assert.deepEqual(values(inGraph, comment, matsci("legacyAssociationInferred")), ["no"])
  assert.deepEqual(values(inGraph, comment, `${PROV}wasAssociatedWith`), [
    personUnder("martensite", 4)
  ])

  // Alone, the body repeats what the vocabulary says so it reads on its
  // own. In the graph it leaves the typing of the definition and of the
  // current revision, and that revision's specializationOf, to the
  // vocabulary graph, keeps them for the non-current revision, which no
  // other graph describes, and keeps the revision chain.
  assertTypes(alone, rev2, [
    `${PROV}Entity`,
    matsci("DefinitionRevision")
  ])
  assertTypes(alone, def1, [`${PROV}Entity`, matsci("Definition")])
  assert.deepEqual(values(alone, rev2, `${PROV}specializationOf`), [def1])
  assertTypes(inGraph, rev2, [`${PROV}Entity`])
  assertTypes(inGraph, def1, [`${PROV}Entity`])
  assert.equal(values(inGraph, rev2, `${PROV}specializationOf`).length, 0)
  assertTypes(inGraph, rev1, [`${PROV}Entity`, matsci("DefinitionRevision")])
  assert.deepEqual(values(inGraph, rev1, `${PROV}specializationOf`), [def1])
  assert.deepEqual(values(inGraph, rev2, `${PROV}wasRevisionOf`), [rev1])
  assert.deepEqual(values(alone, rev2, `${PROV}wasRevisionOf`), [rev1])
  assert.deepEqual(values(inGraph, rev2, `${PROV}wasAttributedTo`), [
    personUnder("martensite", 1)
  ])
  // Three triples, all about the current revision and its definition: the
  // revision typing, the definition typing, and the specializationOf.
  const omitted = [...tripleKeys(alone)].filter(
    (k) => !tripleKeys(inGraph).has(k)
  )
  assert.equal(omitted.length, 3, `omitted: ${omitted}`)
  assert.ok(
    omitted.every(
      (k) =>
        k.includes(matsci("DefinitionRevision")) ||
        k.includes(matsci("Definition")) ||
        k.includes(`${PROV}specializationOf`)
    )
  )
  assert.equal(
    [...tripleKeys(inGraph)].filter((k) => !tripleKeys(alone).has(k)).length,
    0
  )

  // --- The four content graphs from fixtures, and their disjointness ---

  const kos: KosData = {
    schemes: [
      {
        id: 1,
        slug: "topics",
        title: "Topics",
        description: "Community tags applied to definitions.",
        assertableBy: "contributor"
      },
      {
        id: 2,
        slug: "pspp",
        title: "PSPP facets",
        description: null,
        assertableBy: "curator"
      }
    ],
    concepts: [
      {
        id: 1,
        schemeId: 2,
        slug: "processing",
        prefLabel: "Processing",
        altLabels: [],
        definition: null,
        scopeNote: null,
        status: "approved",
        replacedById: null
      },
      {
        id: 5,
        schemeId: 1,
        slug: "steel",
        prefLabel: "Steel",
        altLabels: ["steels"],
        definition: null,
        scopeNote: null,
        status: "approved",
        replacedById: null
      },
      {
        id: 6,
        schemeId: 1,
        slug: "metals",
        prefLabel: "Metals",
        altLabels: [],
        definition: null,
        scopeNote: null,
        status: "approved",
        replacedById: null
      },
      {
        id: 8,
        schemeId: 1,
        slug: "corrosion",
        prefLabel: "Corrosion",
        altLabels: [],
        definition: null,
        scopeNote: null,
        status: "approved",
        replacedById: null
      }
    ],
    collections: [
      {
        id: 1,
        slug: "demo-terms",
        title: "Demo terms",
        description: null,
        retiredAt: null
      },
      {
        id: 2,
        slug: "retired-set",
        title: "Retired set",
        description: null,
        retiredAt: "2026-01-01 00:00:00+00"
      }
    ],
    // The active rows of the assertion fixture, as the kos loader sees them.
    statements: data.assertions
      .filter((a) => a.retractedAt === null)
      .map(({ id, key, predicate, ...ends }) => ({
        id,
        key,
        predicate,
        subjectTermId: ends.subjectTermId,
        subjectDefinitionId: ends.subjectDefinitionId,
        subjectConceptId: ends.subjectConceptId,
        subjectCollectionId: ends.subjectCollectionId,
        objectTermId: ends.objectTermId,
        objectConceptId: ends.objectConceptId,
        objectIri: ends.objectIri
      })),
    terms: [
      { id: 1, term: "martensite", slug: "martensite" },
      { id: 2, term: "austenite", slug: "austenite" },
      { id: 3, term: "band gap", slug: "band_gap" }
    ]
  }
  const records = assembleTermSkos(
    {
      terms: [
        {
          id: 1,
          term: "martensite",
          slug: "martensite",
          createdAt: "2026-01-02 03:04:05"
        },
        {
          id: 2,
          term: "austenite",
          slug: "austenite",
          createdAt: "2026-01-02 03:04:05"
        },
        // Related to martensite by the ledger fixture, so it is in the
        // vocabulary too: a relation to a term outside it cannot be stored.
        {
          id: 3,
          term: "band gap",
          slug: "band_gap",
          createdAt: "2026-01-02 03:04:05"
        }
      ],
      definitions: [
        {
          id: 10,
          termId: 1,
          definitionNumber: 1,
          definitionCreatedAt: "2026-01-02T03:04:05.000Z",
          revisionDefinition: [
            [
              DiffOp.Insert,
              'A hard phase with a "body-centred" tetragonal lattice.'
            ]
          ] satisfies Diff[],
          revisionExample: [[DiffOp.Insert, "Quenched steel."]] satisfies Diff[],
          legacyExample: "",
          revisionVersion: 2,
          revisionCreatedAt: "2026-01-03T00:00:00.000Z",
          revisionModel: null,
          score: 6,
          authorName: "Ada",
          authorIsAi: false
        },
        {
          id: 12,
          termId: 2,
          definitionNumber: 1,
          definitionCreatedAt: "2026-02-02T03:04:05.000Z",
          revisionDefinition: [
            [DiffOp.Insert, "The face-centred cubic phase of iron."]
          ] satisfies Diff[],
          revisionExample: null,
          legacyExample: "",
          revisionVersion: 1,
          revisionCreatedAt: "2026-02-02T03:04:05.000Z",
          revisionModel: "gemma4:26b",
          score: 0,
          authorName: "gemma4:26b",
          authorIsAi: true
        }
      ],
      coauthors: []
    },
    kos
  )
  const document = { kos, records }

  const projectedAt = "2026-08-22T12:00:00.000Z"
  const content = {
    vocabulary: vocabularyGraphTurtle(document),
    kos: kosGraphTurtle(document),
    provenance: provenanceGraphTurtle([bodyInGraph], datasetBlocks),
    matcore: matCoreGraphTurtle()
  }
  const parsed = Object.fromEntries(
    names.CONTENT_GRAPH_NAMES.map((name) => [
      name,
      parse(content[name], `${name} graph`)
    ])
  ) as Record<(typeof names.CONTENT_GRAPH_NAMES)[number], Quad[]>
  const counts = Object.fromEntries(
    names.CONTENT_GRAPH_NAMES.map((name) => [name, countTriples(content[name])])
  ) as Record<(typeof names.CONTENT_GRAPH_NAMES)[number], number>
  for (const name of names.CONTENT_GRAPH_NAMES)
    assert.ok(counts[name] > 0, `${name} graph is not empty`)
  // The count is of distinct triples, as a store holds them.
  assert.equal(counts.provenance, tripleKeys(parsed.provenance).size)
  assert.equal(
    countTriples(TTL_PREFIXES + "<http://x/s> <http://x/p> <http://x/o> , <http://x/o> .\n"),
    1
  )

  // Pairwise disjoint, on canonical triples. The revision IRI appears in
  // both the vocabulary and the provenance graph, with different triples.
  for (const a of names.CONTENT_GRAPH_NAMES)
    for (const b of names.CONTENT_GRAPH_NAMES) {
      if (a >= b) continue
      const shared = [...tripleKeys(parsed[a])].filter((k) =>
        tripleKeys(parsed[b]).has(k)
      )
      assert.equal(shared.length, 0, `${a} and ${b} share: ${shared}`)
    }
  assert.ok(subjects(parsed.vocabulary).has(rev2))
  assert.ok(subjects(parsed.provenance).has(rev2))
  // In the union every revision, current or not, is typed and linked to
  // its definition exactly once: rev2 by the vocabulary graph, rev1 (not
  // current) by the provenance graph.
  const union = [...parsed.vocabulary, ...parsed.provenance]
  const revisionSubjects = [...subjects(union)].filter((s) =>
    /\/definitions\/\d+\/revisions\/\d+$/.test(s)
  )
  assert.ok(revisionSubjects.includes(rev1) && revisionSubjects.includes(rev2))
  for (const revision of revisionSubjects) {
    assert.ok(
      types(union, revision).includes(matsci("DefinitionRevision")),
      `${revision} is a DefinitionRevision in the union`
    )
    assert.equal(
      values(union, revision, `${PROV}specializationOf`).length,
      1,
      `${revision} has one specializationOf in the union`
    )
  }
  // The negative control: with the vocabulary triples left in, the two
  // graphs would overlap, which is what the option exists to prevent.
  const overlapping = parse(
    provenanceGraphTurtle([bodyAlone], datasetBlocks),
    "provenance with vocabulary triples"
  )
  assert.equal(
    [...tripleKeys(overlapping)].filter((k) =>
      tripleKeys(parsed.vocabulary).has(k)
    ).length,
    3
  )

  // The kos graph asserts the active triples the provenance graph reifies,
  // and not the retracted ones.
  assert.ok(
    parsed.kos.some(
      (q) =>
        q.subject.value === steel &&
        q.predicate.value === "http://www.w3.org/2004/02/skos/core#broader"
    )
  )
  assert.ok(
    !parsed.kos.some(
      (q) =>
        q.subject.value === martensite &&
        q.predicate.value === "http://www.w3.org/2004/02/skos/core#closeMatch"
    )
  )

  // --- Meta graph ---

  const metaTtl = metaGraphTurtle({ projectedAt, counts })
  const meta = parse(metaTtl, "meta graph")
  const total = names.CONTENT_GRAPH_NAMES.reduce((n, g) => n + counts[g], 0)
  assertTypes(meta, names.datasetIri, [
    `${VOID}Dataset`,
    `${SD}Dataset`
  ])
  assert.deepEqual(values(meta, names.datasetIri, `${VOID}triples`), [
    String(total)
  ])
  assert.deepEqual(values(meta, names.datasetIri, `${DCT}modified`), [
    projectedAt
  ])
  assert.deepEqual(values(meta, names.datasetIri, `${VOID}sparqlEndpoint`), [
    names.sparqlEndpointUrl
  ])
  // The dumps are the content graphs, which together are the dataset.
  assert.deepEqual(
    values(meta, names.datasetIri, `${VOID}dataDump`).sort(),
    names.CONTENT_GRAPH_NAMES.map(names.graphIri).sort()
  )
  assert.deepEqual(
    values(meta, names.datasetIri, `${VOID}subset`).sort(),
    names.CONTENT_GRAPH_NAMES.map(names.graphIri).sort()
  )
  assert.deepEqual(
    values(meta, names.datasetIri, `${SD}namedGraph`).sort(),
    names.GRAPH_NAMES.map(names.graphIri).sort()
  )
  assertTypes(meta, names.sparqlEndpointUrl, [`${SD}Service`])
  assert.deepEqual(values(meta, names.sparqlEndpointUrl, `${SD}feature`), [
    `${SD}UnionDefaultGraph`
  ])
  for (const name of names.CONTENT_GRAPH_NAMES) {
    const iri = names.graphIri(name)
    assertTypes(meta, iri, [`${VOID}Dataset`, `${SD}NamedGraph`])
    assert.deepEqual(values(meta, iri, `${SD}name`), [iri])
    assert.deepEqual(values(meta, iri, `${RDFS}label`), [name])
    assert.deepEqual(values(meta, iri, `${VOID}triples`), [String(counts[name])])
    assert.deepEqual(values(meta, iri, `${VOID}dataDump`), [iri])
    assert.deepEqual(values(meta, iri, `${VOID}inDataset`), [names.datasetIri])
    assert.equal(values(meta, iri, `${DCT}description`).length, 1)
  }
  assert.deepEqual(types(meta, names.graphIri("meta")), [`${SD}NamedGraph`])
  assert.equal(values(meta, names.graphIri("meta"), `${VOID}triples`).length, 0)
  // The same input renders the same bytes.
  assert.equal(metaGraphTurtle({ projectedAt, counts }), metaTtl)

  // --- People exclusion: no IRI anywhere is under /people/, /communities/
  // or /invite/, the three paths the privacy shape refuses ---

  const EXCLUDED_PATHS = ["/people/", "/communities/", "/invite/"]
  const documents = { ...content, meta: metaTtl }
  for (const [name, text] of Object.entries(documents)) {
    const quads = parse(text, `${name} graph`)
    for (const iri of irisIn(quads))
      for (const path of EXCLUDED_PATHS)
        assert.ok(!iri.includes(path), `${name} names a person: ${iri}`)
    for (const path of EXCLUDED_PATHS)
      assert.ok(!text.includes(path), `${name} mentions ${path}`)
  }

  // --- Export for the CI SHACL step ---

  if (exportDir !== null) {
    mkdirSync(exportDir, { recursive: true })
    for (const name of names.GRAPH_NAMES)
      writeFileSync(join(exportDir, `${name}.ttl`), documents[name])
    // What the privacy shape must refuse: a person with an IRI, named as
    // the agent of a vote, and a community named by a study. Each is one
    // focus node, so the report must hold both.
    const negative =
      TTL_PREFIXES +
      `<${identifierBaseUrl}/people/1> a prov:Person ;\n  rdfs:label "Someone" .\n\n` +
      `<${rev100}#vote-event-1> a matsci:VoteEvent, prov:Activity ;\n` +
      `  prov:used <${rev100}> ;\n` +
      `  matsci:voteKind "up" ;\n  matsci:actorKind "human" ;\n` +
      `  prov:atTime "2026-05-01T09:00:00.000Z"^^xsd:dateTime ;\n` +
      `  prov:wasAssociatedWith <${identifierBaseUrl}/people/1> .\n\n` +
      `<${s1}> a matsci:Study, prov:Activity ;\n` +
      `  dcterms:title "ID4 pilot"@en ;\n` +
      `  matsci:worklist <${demo}> ;\n` +
      `  dcterms:isPartOf <${identifierBaseUrl}/communities/zhang-lab> .\n`
    parse(negative, "negative-people")
    writeFileSync(join(exportDir, "negative-people.ttl"), negative)

    // What the kos shape must refuse: a tag with two preferred labels, in a
    // broader cycle with another.
    const { conceptSchemeUri } = await import("../lib/public-identifiers")
    const topics = conceptSchemeUri("topics")
    const metals = conceptUri("topics", "metals")
    const negativeKos =
      TTL_PREFIXES +
      `<${topics}> a skos:ConceptScheme ;\n  dcterms:title "Topics"@en ;\n  matsci:curated false .\n\n` +
      `<${steel}> a skos:Concept ;\n  skos:inScheme <${topics}> ;\n` +
      `  skos:prefLabel "Steel"@en ;\n  skos:prefLabel "Steels"@en ;\n` +
      `  skos:broader <${metals}> .\n\n` +
      `<${metals}> a skos:Concept ;\n  skos:inScheme <${topics}> ;\n` +
      `  skos:prefLabel "Metals"@en ;\n  skos:broader <${steel}> .\n`
    parse(negativeKos, "negative-kos")
    writeFileSync(join(exportDir, "negative-kos.ttl"), negativeKos)

    // What the provenance shape must refuse: a retraction time with no
    // retractor, a reifier whose object is an IRI and not a triple term,
    // and an actor kind outside the three.
    const negativeProvenance =
      TTL_PREFIXES +
      `<${a5}> a matsci:Assertion, prov:Entity ;\n` +
      `  rdf:reifies <<( <${martensite}> skos:closeMatch <${PMD}> )>> ;\n` +
      `  prov:generatedAtTime "2026-03-05T10:00:00.000Z"^^xsd:dateTime ;\n` +
      `  prov:invalidatedAtTime "2026-04-01T12:00:00.000Z"^^xsd:dateTime .\n\n` +
      `<${a1}> a matsci:Assertion, prov:Entity ;\n` +
      `  rdf:reifies <${martensite}> ;\n` +
      `  prov:generatedAtTime "2026-03-01T10:00:00.500Z"^^xsd:dateTime .\n\n` +
      `<${e1}> a matsci:VoteEvent, prov:Activity ;\n` +
      `  prov:used <${rev100}> ;\n` +
      `  matsci:voteKind "up" ;\n  matsci:actorKind "robot" ;\n` +
      `  prov:atTime "2026-05-01T09:00:00.000Z"^^xsd:dateTime .\n`
    parse(negativeProvenance, "negative-provenance")
    writeFileSync(join(exportDir, "negative-provenance.ttl"), negativeProvenance)
    console.log(`Fixture documents written to ${exportDir}`)
  }

  console.log("Graph layer tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
