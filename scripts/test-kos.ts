/*
 * Pure checks for the knowledge-organization ledger: the predicate registry,
 * the IRI guards, and the SKOS serializers built from in-memory fixtures and
 * parsed back with n3. No database. Run as
 *
 *   tsx --conditions=react-server scripts/test-kos.ts
 *
 * so lib/skos.ts's `import "server-only"` resolves to its empty variant.
 * scripts/test-kos-db.ts holds the checks that need a migrated database.
 */

import assert from "node:assert/strict"
import { DiffOp } from "diff-match-patch-ts"
import type { Diff } from "diff-match-patch-ts"
import { Parser } from "n3"
import type { Quad } from "n3"

const main = async () => {
  // lib/skos.ts imports @yamz/db, which builds a pool lazily and never
  // connects here (same arrangement as test:revisions).
  process.env.DATABASE_URL ??= "postgresql:///kos-test"

  const {
    MAPPING_PREDICATES,
    PREDICATES,
    PREDICATE_VALUES,
    authorMayAssert,
    canonicalizeSymmetric,
    conceptMayBridge,
    isAbsoluteHttpIri,
    isExternalIri,
    isMappingPredicate,
    mayLinkConcept,
    objectOf,
    predicateAccepts,
    subjectOf
  } = await import("../lib/kos")
  const { lit } = await import("../lib/rdf-literal")
  const { uniqueSlug } = await import("../lib/slug")
  const { KosView, conceptJsonLd, kosTurtle } = await import(
    "../lib/kos-export"
  )
  type KosData = import("../lib/kos-export").KosData
  const {
    assembleTermSkos,
    renderSchemeTurtle,
    termJsonLd,
    termTurtle,
    conceptSchemeJsonLd
  } = await import("../lib/skos")
  const {
    conceptSchemeUri,
    conceptUri,
    collectionUri,
    identifierBaseUrl,
    termUri
  } = await import("../lib/public-identifiers")

  // --- Predicate registry: hand-copied domain/range table (plan §5) ---

  const expected: Record<
    string,
    { subject: string[]; object: string[]; iri: string }
  > = {
    "dcterms:subject": {
      subject: ["term", "definition"],
      object: ["concept"],
      iri: "http://purl.org/dc/terms/subject"
    },
    "skos:broader": {
      subject: ["term", "concept"],
      object: ["term", "concept"],
      iri: "http://www.w3.org/2004/02/skos/core#broader"
    },
    "skos:related": {
      subject: ["term", "concept"],
      object: ["term", "concept"],
      iri: "http://www.w3.org/2004/02/skos/core#related"
    },
    "skos:member": {
      subject: ["collection"],
      object: ["term"],
      iri: "http://www.w3.org/2004/02/skos/core#member"
    },
    "skos:exactMatch": {
      subject: ["term", "concept"],
      object: ["iri"],
      iri: "http://www.w3.org/2004/02/skos/core#exactMatch"
    },
    "skos:closeMatch": {
      subject: ["term", "concept"],
      object: ["iri"],
      iri: "http://www.w3.org/2004/02/skos/core#closeMatch"
    },
    "skos:broadMatch": {
      subject: ["term", "concept"],
      object: ["iri"],
      iri: "http://www.w3.org/2004/02/skos/core#broadMatch"
    },
    "skos:narrowMatch": {
      subject: ["term", "concept"],
      object: ["iri"],
      iri: "http://www.w3.org/2004/02/skos/core#narrowMatch"
    },
    "skos:relatedMatch": {
      subject: ["term", "concept"],
      object: ["iri"],
      iri: "http://www.w3.org/2004/02/skos/core#relatedMatch"
    }
  }
  assert.deepEqual(new Set(PREDICATE_VALUES), new Set(Object.keys(expected)))
  for (const [p, spec] of Object.entries(expected)) {
    const actual = PREDICATES[p as keyof typeof PREDICATES]
    assert.deepEqual([...actual.subject], spec.subject, `${p} subject kinds`)
    assert.deepEqual([...actual.object], spec.object, `${p} object kinds`)
    assert.equal(actual.iri, spec.iri, `${p} IRI`)
  }
  assert.equal(PREDICATES["skos:broader"].inverse, "skos:narrower")
  assert.equal(PREDICATES["skos:related"].symmetric, true)
  assert.equal(PREDICATES["skos:broader"].sameScheme, true)
  assert.equal(MAPPING_PREDICATES.length, 5)
  assert.ok(isMappingPredicate("skos:closeMatch"))
  assert.ok(!isMappingPredicate("skos:broader"))

  // predicateAccepts mirrors the CHECK's CASE (the database twin is in
  // test-kos-db.ts): same-kind rule for broader/related.
  assert.ok(predicateAccepts("dcterms:subject", "definition", "concept"))
  assert.ok(predicateAccepts("dcterms:subject", "term", "concept"))
  assert.ok(!predicateAccepts("dcterms:subject", "concept", "concept"))
  assert.ok(!predicateAccepts("dcterms:subject", "term", "iri"))
  assert.ok(predicateAccepts("skos:broader", "term", "term"))
  assert.ok(predicateAccepts("skos:broader", "concept", "concept"))
  assert.ok(!predicateAccepts("skos:broader", "term", "concept"))
  assert.ok(!predicateAccepts("skos:broader", "concept", "term"))
  assert.ok(predicateAccepts("skos:member", "collection", "term"))
  assert.ok(!predicateAccepts("skos:member", "collection", "concept"))
  assert.ok(predicateAccepts("skos:exactMatch", "term", "iri"))
  assert.ok(predicateAccepts("skos:exactMatch", "concept", "iri"))
  assert.ok(!predicateAccepts("skos:exactMatch", "term", "concept"))
  assert.ok(!predicateAccepts("skos:exactMatch", "definition", "iri"))
  // The bridge is one extra shape, not a widening: a concept may name a term,
  // and nothing else may. The database CHECK spells out the same exception.
  assert.ok(predicateAccepts("skos:exactMatch", "concept", "term"))
  assert.ok(!predicateAccepts("skos:exactMatch", "term", "term"))
  assert.ok(!predicateAccepts("skos:exactMatch", "concept", "concept"))
  assert.ok(!predicateAccepts("skos:closeMatch", "concept", "term"))
  assert.ok(!predicateAccepts("skos:relatedMatch", "concept", "term"))

  // --- IRI guards ---

  const accepted = [
    "https://w3id.org/emmo#EMMO_03441eb3_d1fd_4906_b953_b83312d7589e",
    "https://w3id.org/pmd/co/PMD_0000934",
    "http://qudt.org/vocab/quantitykind/GapEnergy",
    "https://w3id.org/emmo/domain/characterisation-methodology/chameo#FatigueTesting",
    "https://example.org/über/straße",
    "http://example.org/a?b=c&d=e",
    "https://example.org/x#y"
  ]
  for (const iri of accepted)
    assert.ok(isAbsoluteHttpIri(iri), `accepts ${iri}`)

  const rejected = [
    "ftp://example.org/x",
    "example.org/x",
    "urn:isbn:0451450523",
    "https://example.org/a b",
    "https://example.org/a\tb",
    "https://example.org/a\nb",
    "https://example.org/a\\b",
    "https://example.org/a\x01b",
    "https://example.org/a\x7fb",
    "https://example.org/a^b",
    "https://example.org/a`b",
    'https://example.org/a"b',
    "https://example.org/a<b>",
    "https://example.org/{a}",
    "https://example.org/a|b",
    "https://",
    ""
  ]
  for (const iri of rejected)
    assert.ok(!isAbsoluteHttpIri(iri), `rejects ${JSON.stringify(iri)}`)

  // Own-base IRIs are absolute but not external.
  const base = "https://sam.example.org"
  assert.ok(isExternalIri("https://w3id.org/emmo#X", base))
  assert.ok(!isExternalIri(`${base}/vocabulary/steel`, base))
  assert.ok(!isExternalIri(`${base}/tags/pspp/processing`, base))
  assert.ok(!isExternalIri(`${base}`, base))
  assert.ok(!isExternalIri(`${base}#frag`, base))
  assert.ok(!isExternalIri(`${base.toUpperCase()}/vocabulary/x`, base))
  assert.ok(isExternalIri(`${base}.evil.org/x`, base))
  assert.ok(!isExternalIri("https://example.org/a b", base))
  assert.ok(!isExternalIri(`${identifierBaseUrl}/vocabulary/steel`))
  assert.ok(isExternalIri("https://w3id.org/pmd/co/PMD_0090002"))

  // --- Symmetric canonicalization ---

  assert.deepEqual(canonicalizeSymmetric(7, 3), [3, 7])
  assert.deepEqual(canonicalizeSymmetric(3, 7), [3, 7])
  assert.deepEqual(canonicalizeSymmetric(4, 4), [4, 4])

  // --- Who may assert ---

  assert.ok(authorMayAssert("dcterms:subject", "definition", false))
  assert.ok(!authorMayAssert("dcterms:subject", "definition", true))
  assert.ok(!authorMayAssert("dcterms:subject", "term", false))
  assert.ok(!authorMayAssert("skos:broader", "term", false))
  assert.ok(!authorMayAssert("skos:exactMatch", "term", false))
  assert.ok(!authorMayAssert("skos:member", "collection", false))

  // Who may bridge a tag to a term: a curator always, the creator of an open
  // topic for their own topic, nobody else.
  const admin = { id: 1, role: "admin" }
  const author = { id: 2, role: "user" }
  const other = { id: 3, role: "user" }
  const ownTopic = { createdById: 2 }
  assert.ok(mayLinkConcept(admin, ownTopic))
  assert.ok(mayLinkConcept(author, ownTopic))
  assert.ok(!mayLinkConcept(other, ownTopic))
  assert.ok(!mayLinkConcept(null, ownTopic))
  // A seeded or migrated concept has no creator to claim it.
  assert.ok(!mayLinkConcept(author, { createdById: null }))

  // Whether a tag may be bridged at all is a rule about the tag, and it
  // binds a curator too: the database invariant refuses a bridged facet
  // whoever asserts it.
  assert.ok(conceptMayBridge({ schemeCurated: false }))
  assert.ok(!conceptMayBridge({ schemeCurated: true }))

  // --- Row resolvers ---

  const ends = {
    subjectTermId: null,
    subjectDefinitionId: 12,
    subjectConceptId: null,
    subjectCollectionId: null,
    objectTermId: null,
    objectConceptId: 5,
    objectIri: null
  }
  assert.deepEqual(subjectOf(ends), { kind: "definition", id: 12 })
  assert.deepEqual(objectOf(ends), { kind: "concept", id: 5 })
  assert.deepEqual(
    objectOf({ ...ends, objectConceptId: null, objectIri: "https://x.org/y" }),
    { kind: "iri", iri: "https://x.org/y" }
  )

  // --- Literal escaping and slugs ---

  assert.equal(lit('a "b" \\ c'), '"a \\"b\\" \\\\ c"')
  assert.equal(lit("line1\nline2\ttab\r"), '"line1\\nline2\\ttab\\r"')
  assert.equal(lit("bell\x07"), '"bell\\u0007"')
  assert.equal(uniqueSlug("王明：这是什么？", new Set(), "topic"), "topic")
  assert.equal(
    uniqueSlug("王明：这是什么？", new Set(["topic"]), "topic"),
    "topic_2"
  )
  assert.equal(uniqueSlug("Band Gap", new Set(["band_gap"])), "band_gap_2")
  assert.equal(uniqueSlug("!!!", new Set()), "term")

  // --- Fixtures: two schemes, hierarchy, a retired duplicate, mappings, a
  // collection, and one term with two definitions ---

  const concept = (
    id: number,
    schemeId: number,
    slug: string,
    prefLabel: string,
    extra: Partial<KosData["concepts"][number]> = {}
  ): KosData["concepts"][number] => ({
    id,
    schemeId,
    slug,
    prefLabel,
    altLabels: [],
    definition: null,
    scopeNote: null,
    status: "approved",
    replacedById: null,
    ...extra
  })
  const statement = (
    id: number,
    predicate: KosData["statements"][number]["predicate"],
    ends: Partial<
      Omit<KosData["statements"][number], "id" | "key" | "predicate">
    >
  ): KosData["statements"][number] => ({
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
    ...ends
  })

  const EMMO = "https://w3id.org/emmo#EMMO_03441eb3_d1fd_4906_b953_b83312d7589e"
  const PMD = "https://w3id.org/pmd/co/PMD_0000934"

  const kos: KosData = {
    schemes: [
      {
        id: 1,
        slug: "topics",
        title: "Topics",
        description: "Community tags applied to definitions.",
        curated: false
      },
      {
        id: 2,
        slug: "pspp",
        title: "PSPP facets",
        description: null,
        curated: true
      }
    ],
    concepts: [
      concept(1, 2, "processing", "Processing", {
        definition: "Processing: how a material is made."
      }),
      concept(2, 2, "structure", "Structure"),
      concept(5, 1, "steel", "Steel", { altLabels: ["steels", "Stahl"] }),
      concept(6, 1, "metals", "Metals"),
      concept(7, 1, "steel_2", "steel ", {
        status: "retired",
        replacedById: 5
      }),
      concept(8, 1, "corrosion", "Corrosion", {
        scopeNote: "Use for degradation in service, not for surface finish."
      }),
      concept(9, 1, "odd", 'Odd "label" \\ back\nslash', {
        definition: 'Has a\ttab and a "quote".'
      }),
      concept(10, 1, "proposed_one", "Proposed", { status: "proposed" })
    ],
    collections: [
      {
        id: 1,
        slug: "demo-terms",
        title: "Demo terms",
        description: "Reviewed for the demo."
      }
    ],
    statements: [
      // term-level facet
      statement(1, "dcterms:subject", { subjectTermId: 1, objectConceptId: 1 }),
      // definition-level topics: both definitions carry steel; one also metals
      statement(2, "dcterms:subject", {
        subjectDefinitionId: 10,
        objectConceptId: 5
      }),
      statement(3, "dcterms:subject", {
        subjectDefinitionId: 11,
        objectConceptId: 5
      }),
      statement(4, "dcterms:subject", {
        subjectDefinitionId: 11,
        objectConceptId: 6
      }),
      // concept hierarchy inside topics, a related pair, and a mapping
      statement(5, "skos:broader", { subjectConceptId: 5, objectConceptId: 6 }),
      statement(6, "skos:related", { subjectConceptId: 5, objectConceptId: 8 }),
      statement(7, "skos:exactMatch", { subjectConceptId: 5, objectIri: EMMO }),
      // term relations and a term mapping
      statement(8, "skos:broader", { subjectTermId: 1, objectTermId: 2 }),
      statement(9, "skos:related", { subjectTermId: 1, objectTermId: 3 }),
      statement(10, "skos:closeMatch", { subjectTermId: 1, objectIri: PMD }),
      // collection membership
      // the bridge: the topic "Steel" is the same concept as a term
      statement(13, "skos:exactMatch", { subjectConceptId: 8, objectTermId: 1 }),
      statement(11, "skos:member", { subjectCollectionId: 1, objectTermId: 1 }),
      statement(12, "skos:member", { subjectCollectionId: 1, objectTermId: 2 })
    ],
    terms: [
      { id: 1, term: "martensite", slug: "martensite" },
      { id: 2, term: "austenite", slug: "austenite" },
      { id: 3, term: "band gap", slug: "band_gap" }
    ]
  }

  const rows = {
    terms: [
      {
        id: 1,
        term: "martensite",
        slug: "martensite",
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
        id: 11,
        termId: 1,
        definitionNumber: 2,
        definitionCreatedAt: "2026-02-02T03:04:05.000Z",
        revisionDefinition: [
          [DiffOp.Insert, "Diffusionless transformation product\nof austenite."]
        ] satisfies Diff[],
        revisionExample: null,
        legacyExample: "Legacy example.",
        revisionVersion: 1,
        revisionCreatedAt: "2026-02-02T03:04:05.000Z",
        revisionModel: "gpt-oss:20b",
        score: 0,
        authorName: "gpt-oss:20b",
        authorIsAi: true
      }
    ],
    coauthors: [{ definitionId: 11, name: "gpt-oss:20b", isAi: true }]
  }

  const [skos] = assembleTermSkos(rows, kos)
  assert.equal(skos.uri, termUri("martensite"))
  assert.deepEqual(
    skos.facets.map((c) => c.slug),
    ["processing"]
  )
  assert.deepEqual(
    skos.topics.map((c) => c.slug),
    ["metals", "steel"]
  )
  assert.deepEqual(
    skos.definitions.map((d) => d.subjects.map((c) => c.slug)),
    [["steel"], ["metals", "steel"]]
  )
  assert.deepEqual(
    skos.broader.map((t) => t.uri),
    [termUri("austenite")]
  )
  assert.deepEqual(skos.narrower, [])
  assert.deepEqual(
    skos.related.map((t) => t.uri),
    [termUri("band_gap")]
  )
  // Its own mapping, plus the derived reverse of the bridge.
  assert.deepEqual(skos.mappings, [
    { predicate: "skos:closeMatch", iri: PMD },
    { predicate: "skos:exactMatch", iri: conceptUri("topics", "corrosion") }
  ])
  assert.equal(skos.definitions[1].currentRevision.example, "Legacy example.")
  assert.deepEqual(skos.definitions[1].currentRevision.contributors, [
    "gpt-oss:20b"
  ])
  assert.equal(skos.created, "2026-01-02")

  // --- Turtle: parse with n3, zero errors, each concept IRI once as subject ---

  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
  const SKOS = "http://www.w3.org/2004/02/skos/core#"
  const DCT = "http://purl.org/dc/terms/"
  const OWL = "http://www.w3.org/2002/07/owl#"

  const parse = (text: string, label: string): Quad[] => {
    try {
      return new Parser().parse(text)
    } catch (error) {
      throw new Error(
        `${label} does not parse: ${(error as Error).message}\n${text}`
      )
    }
  }
  const typeSubjects = (quads: Quad[], type: string) =>
    quads
      .filter((q) => q.predicate.value === RDF_TYPE && q.object.value === type)
      .map((q) => q.subject.value)
  const countOccurrences = (list: string[]) =>
    list.reduce(
      (m, v) => m.set(v, (m.get(v) ?? 0) + 1),
      new Map<string, number>()
    )
  const objectsOf = (quads: Quad[], subject: string, predicate: string) =>
    quads
      .filter(
        (q) => q.subject.value === subject && q.predicate.value === predicate
      )
      .map((q) => q.object.value)

  const view = new KosView(kos)
  const iri = (id: number) => view.conceptIri(view.concept(id))
  const termIri = termUri("martensite")

  // Term document
  const termQuads = parse(termTurtle(skos, kos), "termTurtle")
  assert.deepEqual(
    new Set(objectsOf(termQuads, termIri, `${DCT}subject`)),
    new Set([iri(1), iri(5), iri(6)]),
    "term carries facets and lifted topics"
  )
  assert.deepEqual(objectsOf(termQuads, termIri, `${SKOS}broader`), [
    termUri("austenite")
  ])
  assert.deepEqual(objectsOf(termQuads, termIri, `${SKOS}related`), [
    termUri("band_gap")
  ])
  assert.deepEqual(objectsOf(termQuads, termIri, `${SKOS}closeMatch`), [PMD])
  assert.deepEqual(
    objectsOf(termQuads, skos.definitions[1].uri, `${DCT}subject`).sort(),
    [iri(6), iri(5)].sort(),
    "definition resource carries its own topics"
  )
  const termConceptSubjects = typeSubjects(termQuads, `${SKOS}Concept`)
  // Facets, lifted topics, and the bridged concept, each once.
  for (const id of [1, 5, 6, 8])
    assert.equal(
      termConceptSubjects.filter((s) => s === iri(id)).length,
      1,
      `concept ${id} once in term document`
    )
  assert.ok(
    !termConceptSubjects.includes(iri(2)),
    "unreferenced concept not in term document"
  )
  assert.deepEqual(
    new Set(typeSubjects(termQuads, `${SKOS}ConceptScheme`)),
    new Set([conceptSchemeUri("topics"), conceptSchemeUri("pspp")])
  )
  assert.equal(
    objectsOf(termQuads, conceptSchemeUri("topics"), `${SKOS}hasTopConcept`)
      .length,
    0,
    "term document does not enumerate the scheme"
  )
  assert.deepEqual(objectsOf(termQuads, iri(5), `${SKOS}broader`), [iri(6)])
  assert.deepEqual(objectsOf(termQuads, iri(5), `${SKOS}exactMatch`), [EMMO])
  assert.equal(objectsOf(termQuads, iri(5), `${SKOS}altLabel`).length, 2)
  assert.deepEqual(objectsOf(termQuads, iri(1), `${SKOS}topConceptOf`), [
    conceptSchemeUri("pspp")
  ])
  assert.equal(
    objectsOf(termQuads, iri(5), `${SKOS}topConceptOf`).length,
    0,
    "concept with broader is not a top concept"
  )

  // Whole-vocabulary document
  const schemeQuads = parse(
    renderSchemeTurtle({ kos, records: [skos] }),
    "renderSchemeTurtle"
  )
  const conceptSubjects = countOccurrences(
    typeSubjects(schemeQuads, `${SKOS}Concept`)
  )
  for (const c of kos.concepts.filter((c) => c.status !== "proposed"))
    assert.equal(
      conceptSubjects.get(iri(c.id)),
      1,
      `concept ${c.slug} appears once as a subject`
    )
  assert.equal(
    conceptSubjects.get(conceptUri("topics", "proposed_one")),
    undefined,
    "proposed concept is not exported"
  )
  assert.equal(conceptSubjects.get(termIri), 1)
  assert.deepEqual(objectsOf(schemeQuads, iri(7), `${OWL}deprecated`), ["true"])
  assert.deepEqual(objectsOf(schemeQuads, iri(7), `${DCT}isReplacedBy`), [
    iri(5)
  ])
  assert.equal(objectsOf(schemeQuads, iri(7), `${SKOS}topConceptOf`).length, 0)
  assert.deepEqual(
    new Set(
      objectsOf(schemeQuads, conceptSchemeUri("topics"), `${SKOS}hasTopConcept`)
    ),
    new Set([iri(6), iri(8), iri(9)]),
    "top concepts: no in-scheme broader, not retired, not proposed"
  )
  assert.equal(
    objectsOf(schemeQuads, conceptSchemeUri("pspp"), `${SKOS}hasTopConcept`)
      .length,
    2
  )
  assert.deepEqual(objectsOf(schemeQuads, iri(6), `${SKOS}narrower`), [iri(5)])
  assert.deepEqual(
    objectsOf(schemeQuads, iri(8), `${SKOS}related`),
    [iri(5)],
    "related mirror derived"
  )
  assert.deepEqual(
    new Set(
      objectsOf(schemeQuads, collectionUri("demo-terms"), `${SKOS}member`)
    ),
    new Set([termUri("martensite"), termUri("austenite")])
  )
  assert.deepEqual(typeSubjects(schemeQuads, `${SKOS}Collection`), [
    collectionUri("demo-terms")
  ])
  // The odd label round-trips through the escaper
  assert.deepEqual(objectsOf(schemeQuads, iri(9), `${SKOS}prefLabel`), [
    'Odd "label" \\ back\nslash'
  ])
  assert.deepEqual(objectsOf(schemeQuads, iri(9), `${SKOS}definition`), [
    'Has a\ttab and a "quote".'
  ])

  // The bridge: stored on the concept, derived onto the term, and both ends
  // carry the concept's block.
  assert.deepEqual(
    objectsOf(schemeQuads, iri(8), `${SKOS}exactMatch`),
    [termIri],
    "concept names the bridged term"
  )
  assert.deepEqual(
    objectsOf(schemeQuads, termIri, `${SKOS}exactMatch`),
    [iri(8)],
    "the term names the concept back, derived"
  )
  // A term document carries the bridge and the bridged concept's block.
  assert.deepEqual(objectsOf(termQuads, termIri, `${SKOS}exactMatch`), [iri(8)])
  assert.equal(
    typeSubjects(termQuads, `${SKOS}Concept`).filter((x) => x === iri(8)).length,
    1,
    "the bridged concept's block travels with the term document"
  )
  assert.deepEqual(
    objectsOf(schemeQuads, iri(8), `${SKOS}scopeNote`),
    ["Use for degradation in service, not for surface finish."]
  )

  // KOS-only document
  const kosQuads = parse(kosTurtle(kos), "kosTurtle")
  assert.equal(
    countOccurrences(typeSubjects(kosQuads, `${SKOS}Concept`)).size,
    7
  )
  assert.equal(typeSubjects(kosQuads, `${SKOS}ConceptScheme`).length, 2)
  assert.equal(typeSubjects(kosQuads, `${SKOS}Collection`).length, 1)
  assert.equal(
    kosQuads.filter((q) => q.subject.value === termIri).length,
    0,
    "no term blocks in tags.ttl"
  )

  // Empty snapshot still yields a valid document
  parse(
    kosTurtle({
      schemes: [],
      concepts: [],
      collections: [],
      statements: [],
      terms: []
    }),
    "empty kosTurtle"
  )

  // --- JSON-LD ---

  const jsonLd = termJsonLd(skos, kos) as Record<string, unknown>
  assert.equal(jsonLd["@id"], termIri)
  assert.ok((jsonLd["@context"] as Record<string, string>).owl)
  assert.deepEqual(
    (jsonLd["dcterms:subject"] as { "@id": string }[]).map((r) => r["@id"]),
    [iri(1), iri(6), iri(5)]
  )
  const included = jsonLd["@included"] as { "@id": string }[]
  assert.deepEqual(
    new Set(included.map((n) => n["@id"])),
    new Set([
      iri(1),
      iri(5),
      iri(6),
      iri(8),
      conceptSchemeUri("topics"),
      conceptSchemeUri("pspp")
    ])
  )
  assert.deepEqual(jsonLd["skos:broader"], [{ "@id": termUri("austenite") }])
  assert.deepEqual(jsonLd["skos:closeMatch"], [{ "@id": PMD }])
  const steelNode = conceptJsonLd(view, view.concept(5)) as Record<
    string,
    unknown
  >
  assert.deepEqual(steelNode["skos:broader"], [{ "@id": iri(6) }])
  assert.deepEqual(steelNode["skos:exactMatch"], [{ "@id": EMMO }])
  const retiredNode = conceptJsonLd(view, view.concept(7)) as Record<
    string,
    unknown
  >
  assert.equal(retiredNode["owl:deprecated"], true)
  assert.deepEqual(retiredNode["dcterms:isReplacedBy"], { "@id": iri(5) })
  assert.equal(conceptUri("pspp", "processing"), iri(1))

  const scheme = conceptSchemeJsonLd([{ term: "austenite", slug: "austenite" }])
  assert.equal(scheme["skos:hasTopConcept"].length, 1)

  console.log("KOS ledger tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
