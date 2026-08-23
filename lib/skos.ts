import "server-only"

import {
  coauthorsTable,
  collectionsTable,
  conceptSchemesTable,
  conceptsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  statementsTable,
  termsTable,
  usersTable
} from "@yamz/db"
import { asc, eq, inArray, isNull, ne } from "drizzle-orm"
import { SITE_NAME, SITE_URL } from "./site"
import { definitionStatus } from "./status"
import {
  definitionUri,
  revisionUri,
  schemeUri,
  termUri
} from "./public-identifiers"
import { diffToStringSimple } from "./definition-revisions"
import { lit } from "./rdf-literal"
import {
  JSONLD_CONTEXT,
  KosView,
  TTL_PREFIXES,
  conceptJsonLd,
  en,
  kosBlocksTurtle,
  schemeJsonLd,
  turtleBlock,
  type ConceptRef,
  type KosData,
  type Mapping,
  type TermRef
} from "./kos-export"
import type { Predicate } from "./kos"

export { schemeUri, termUri } from "./public-identifiers"

/*
 * SKOS view of the dictionary, derived on demand from the domain tables in
 * the same spirit as the PROV-O view. A term is a skos:Concept, its name the
 * prefLabel, and each current definition revision an identified
 * skos:definition resource with its text, example, and Dublin Core
 * attribution. Facets, topics, term relations and external mappings come
 * from the knowledge-organization statement ledger (lib/kos.ts,
 * lib/kos-export.ts): term-level dcterms:subject for facets, definition-level
 * dcterms:subject for topics (lifted onto the term as a derived triple so
 * discovery keeps working), skos:broader / narrower / related between terms,
 * and skos:*Match to external ontology IRIs. The SKOS record describes
 * current state; history belongs to the PROV-O serialization.
 */

export type TermSkos = {
  id: number
  uri: string
  slug: string
  prefLabel: string
  created: string
  definitions: {
    id: number
    uri: string
    definitionNumber: number
    created: string
    currentRevision: {
      uri: string
      version: number
      text: string
      example: string
      contributors: string[]
      created: string
      status: string
    }
    // Definition-level topics (dcterms:subject on the matsci:Definition).
    subjects: ConceptRef[]
  }[]
  // Term-level facets (dcterms:subject stored against the term).
  facets: ConceptRef[]
  // Topics lifted from the term's definitions: a derived triple on the term
  // concept, deduped, excluding anything already a facet.
  topics: ConceptRef[]
  broader: TermRef[]
  narrower: TermRef[]
  related: TermRef[]
  mappings: Mapping[]
}

// --- Loading ---

// The whole knowledge-organization layer in a handful of queries: schemes,
// live and retired concepts (only `proposed` is excluded), collections, every
// active statement, and the terms those statements name.
export const loadKos = async (): Promise<KosData> => {
  const [schemes, concepts, collections, statements] = await Promise.all([
    db.select().from(conceptSchemesTable),
    db.select().from(conceptsTable).where(ne(conceptsTable.status, "proposed")),
    db.select().from(collectionsTable),
    db
      .select({
        id: statementsTable.id,
        key: statementsTable.key,
        predicate: statementsTable.predicate,
        subjectTermId: statementsTable.subjectTermId,
        subjectDefinitionId: statementsTable.subjectDefinitionId,
        subjectConceptId: statementsTable.subjectConceptId,
        subjectCollectionId: statementsTable.subjectCollectionId,
        objectTermId: statementsTable.objectTermId,
        objectConceptId: statementsTable.objectConceptId,
        objectIri: statementsTable.objectIri
      })
      .from(statementsTable)
      .where(isNull(statementsTable.retractedAt))
  ])

  const termIds = [
    ...new Set(
      statements
        .flatMap((s) => [s.subjectTermId, s.objectTermId])
        .filter((id): id is number => id !== null)
    )
  ]
  const terms = termIds.length
    ? await db
        .select({
          id: termsTable.id,
          term: termsTable.term,
          slug: termsTable.slug
        })
        .from(termsTable)
        .where(inArray(termsTable.id, termIds))
    : []

  return {
    schemes,
    concepts,
    collections,
    statements: statements.map((s) => ({
      ...s,
      predicate: s.predicate as Predicate
    })),
    terms
  }
}

type TermRow = { id: number; term: string; slug: string; createdAt: string }
type DefinitionRow = {
  id: number
  termId: number
  definitionNumber: number
  definitionCreatedAt: string
  revisionDefinition: Parameters<typeof diffToStringSimple>[0]
  revisionExample: Parameters<typeof diffToStringSimple>[0] | null
  legacyExample: string
  revisionVersion: number
  revisionCreatedAt: string
  revisionModel: string | null
  score: number
  authorName: string | null
  authorIsAi: boolean
}
type CoauthorRow = { definitionId: number; name: string | null; isAi: boolean }

export type TermSkosRows = {
  terms: TermRow[]
  definitions: DefinitionRow[]
  coauthors: CoauthorRow[]
}

// Pure assembly of TermSkos records from loaded rows and a KOS snapshot.
// scripts/test-kos.ts exercises this from fixtures.
export const assembleTermSkos = (
  rows: TermSkosRows,
  kos: KosData
): TermSkos[] => {
  const view = new KosView(kos)
  const definitionsByTerm = new Map<number, DefinitionRow[]>()
  for (const d of rows.definitions) {
    const list = definitionsByTerm.get(d.termId) ?? []
    list.push(d)
    definitionsByTerm.set(d.termId, list)
  }
  const coauthorsByDefinition = new Map<number, CoauthorRow[]>()
  for (const c of rows.coauthors) {
    const list = coauthorsByDefinition.get(c.definitionId) ?? []
    list.push(c)
    coauthorsByDefinition.set(c.definitionId, list)
  }

  return rows.terms.map((term) => {
    const definitions = (definitionsByTerm.get(term.id) ?? [])
      .slice()
      .sort((a, b) => a.definitionNumber - b.definitionNumber)
      .map((d) => {
        const contributors = [
          d.authorIsAi
            ? (d.revisionModel ?? d.authorName ?? "AI")
            : (d.authorName ?? "unknown"),
          ...(coauthorsByDefinition.get(d.id) ?? [])
            .filter(
              (c) =>
                c.isAi && d.revisionModel !== null && c.name === d.revisionModel
            )
            .map((c) => c.name ?? "unknown")
        ]
        const example = diffToStringSimple(d.revisionExample ?? [])

        return {
          id: d.id,
          uri: definitionUri(term.slug, d.definitionNumber),
          definitionNumber: d.definitionNumber,
          created: d.definitionCreatedAt,
          currentRevision: {
            uri: revisionUri(term.slug, d.definitionNumber, d.revisionVersion),
            version: d.revisionVersion,
            text: diffToStringSimple(d.revisionDefinition),
            // Legacy revision imports may not contain the historical example.
            // The stable row mirrors the current content and supplies it here.
            example: example === "" ? d.legacyExample : example,
            contributors: [...new Set(contributors)],
            created: d.revisionCreatedAt,
            status: definitionStatus(d.score)
          },
          subjects: view.definitionSubjects(d.id)
        }
      })

    const facets = view.termFacets(term.id)
    const facetIds = new Set(facets.map((f) => f.id))
    const topics = [
      ...new Map(
        definitions
          .flatMap((d) => d.subjects)
          .filter((c) => !facetIds.has(c.id))
          .map((c) => [c.id, c] as const)
      ).values()
    ].sort((a, b) => a.label.localeCompare(b.label, "en"))

    return {
      id: term.id,
      uri: termUri(term.slug),
      slug: term.slug,
      prefLabel: term.term,
      created: term.createdAt.slice(0, 10),
      definitions,
      facets,
      topics,
      broader: view.termBroader(term.id),
      narrower: view.termNarrower(term.id),
      related: view.termRelated(term.id),
      mappings: view.termMappings(term.id)
    }
  })
}

// Bulk loader: every term (or the given ids) with its definitions, current
// revisions and coauthors in three queries, whatever the term count.
export const buildTermsSkos = async (
  kos: KosData,
  termIds?: number[]
): Promise<TermSkos[]> => {
  if (termIds && termIds.length === 0) return []

  const terms = await db
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      createdAt: termsTable.createdAt
    })
    .from(termsTable)
    .where(termIds ? inArray(termsTable.id, termIds) : undefined)
    .orderBy(asc(termsTable.term))
  if (terms.length === 0) return []

  const definitions = await db
    .select({
      id: definitionsTable.id,
      termId: definitionsTable.termId,
      definitionNumber: definitionsTable.definitionNumber,
      definitionCreatedAt: definitionsTable.createdAt,
      revisionDefinition: definitionRevisionsTable.definitionDiff,
      revisionExample: definitionRevisionsTable.exampleDiff,
      legacyExample: definitionsTable.example,
      revisionVersion: definitionRevisionsTable.version,
      revisionCreatedAt: definitionRevisionsTable.createdAt,
      revisionModel: definitionRevisionsTable.model,
      score: definitionsTable.score,
      authorName: usersTable.name,
      authorIsAi: usersTable.isAi
    })
    .from(definitionsTable)
    .innerJoin(
      definitionRevisionsTable,
      eq(definitionRevisionsTable.id, definitionsTable.currentRevisionId)
    )
    .innerJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
    .where(termIds ? inArray(definitionsTable.termId, termIds) : undefined)
    .orderBy(asc(definitionsTable.definitionNumber))

  const definitionIds = definitions.map((d) => d.id)
  const coauthors = definitionIds.length
    ? await db
        .select({
          definitionId: coauthorsTable.definitionId,
          name: usersTable.name,
          isAi: usersTable.isAi
        })
        .from(coauthorsTable)
        .innerJoin(usersTable, eq(usersTable.id, coauthorsTable.userId))
        .where(inArray(coauthorsTable.definitionId, definitionIds))
    : []

  return assembleTermSkos({ terms, definitions, coauthors }, kos)
}

export const buildTermSkos = async (
  termId: number,
  kos?: KosData
): Promise<TermSkos | null> => {
  if (!Number.isInteger(termId)) return null
  const [record] = await buildTermsSkos(kos ?? (await loadKos()), [termId])
  return record ?? null
}

// Term ids with an active skos:broader term statement: not top concepts of
// the dictionary scheme. The /vocabulary page uses this for hasTopConcept.
export const termIdsWithActiveBroader = async () =>
  new KosView(await loadKos()).termIdsWithBroader()

// --- Turtle serialization ---

const date = (value: string) => `${lit(value)}^^xsd:date`
const dateTime = (value: string) =>
  `${lit(new Date(value).toISOString())}^^xsd:dateTime`
const positiveInteger = (value: number) =>
  `${lit(String(value))}^^xsd:positiveInteger`

// Every concept a term document mentions, so its blocks can be emitted once.
const referencedConceptIds = (skos: TermSkos, view: KosView) => [
  ...new Set([
    ...skos.facets.map((c) => c.id),
    ...skos.topics.map((c) => c.id),
    ...skos.definitions.flatMap((d) => d.subjects.map((c) => c.id)),
    // A concept bridged to this term is named by the derived mapping above,
    // so the document carries its block too.
    ...view.termBridgedConceptIds(skos.id)
  ])
]

const conceptTurtle = (skos: TermSkos) => {
  const contributors = [
    ...new Set(skos.definitions.flatMap((d) => d.currentRevision.contributors))
  ]

  const termPairs = [
    "a skos:Concept",
    `skos:inScheme <${schemeUri}>`,
    `skos:prefLabel ${en(skos.prefLabel)}`,
    ...skos.definitions.map(
      (d) => `skos:definition <${d.currentRevision.uri}>`
    ),
    ...contributors.map((c) => `dcterms:contributor ${lit(c)}`),
    // Facets are stored against the term; topics are lifted from its
    // definitions (a derived triple; the stored rows are on the definitions).
    ...skos.facets.map((c) => `dcterms:subject <${c.uri}>`),
    ...skos.topics.map((c) => `dcterms:subject <${c.uri}>`),
    ...skos.broader.map((t) => `skos:broader <${t.uri}>`),
    ...skos.narrower.map((t) => `skos:narrower <${t.uri}>`),
    ...skos.related.map((t) => `skos:related <${t.uri}>`),
    ...skos.mappings.map((m) => `${m.predicate} <${m.iri}>`),
    `dcterms:created ${date(skos.created)}`
  ]

  const blocks = [turtleBlock(skos.uri, termPairs)]

  for (const d of skos.definitions) {
    const revision = d.currentRevision

    blocks.push(
      turtleBlock(d.uri, [
        "a matsci:Definition",
        `dcterms:isPartOf <${skos.uri}>`,
        `matsci:definitionNumber ${positiveInteger(d.definitionNumber)}`,
        `matsci:currentRevision <${revision.uri}>`,
        `dcterms:hasVersion <${revision.uri}>`,
        ...d.subjects.map((c) => `dcterms:subject <${c.uri}>`),
        `dcterms:created ${dateTime(d.created)}`
      ])
    )

    blocks.push(
      turtleBlock(revision.uri, [
        "a matsci:DefinitionRevision",
        `rdf:value ${en(revision.text)}`,
        ...(revision.example ? [`skos:example ${en(revision.example)}`] : []),
        `dcterms:isVersionOf <${d.uri}>`,
        `prov:specializationOf <${d.uri}>`,
        ...revision.contributors.map((c) => `dcterms:creator ${lit(c)}`),
        `matsci:version ${positiveInteger(revision.version)}`,
        `matsci:status ${lit(revision.status)}`,
        `dcterms:created ${dateTime(revision.created)}`
      ])
    )
  }

  return blocks.join("\n")
}

// One term as a Turtle document: the term concept, its definitions and
// revisions, then the concepts it references and their schemes, once.
export const termTurtle = (skos: TermSkos, kos: KosData) => {
  const view = new KosView(kos)
  const kosBlocks = kosBlocksTurtle(view, referencedConceptIds(skos, view))
  return (
    TTL_PREFIXES + conceptTurtle(skos) + (kosBlocks ? "\n" + kosBlocks : "")
  )
}

export type SchemeDocument = { kos: KosData; records: TermSkos[] }

export const loadSchemeDocument = async (): Promise<SchemeDocument> => {
  const kos = await loadKos()
  const records = await buildTermsSkos(kos)
  return { kos, records }
}

// The dictionary alone, without prefixes: the scheme block, then every term
// concept with its definitions and revisions. This is the `vocabulary` named
// graph of the graph layer (lib/graph/documents.ts), and one of the two
// halves of /vocabulary.ttl. The knowledge-organization blocks are the other
// half and are the `kos` graph, so the two never state a triple twice.
export const renderVocabularyTurtle = ({ records }: SchemeDocument) => {
  const scheme = turtleBlock(schemeUri, [
    "a skos:ConceptScheme",
    `dcterms:title ${en(`${SITE_NAME} vocabulary`)}`,
    `dcterms:description ${en(
      "Community definitions of materials science terminology, curated with human-in-the-loop AI by the Metadata Research Center, Drexel University."
    )}`,
    `dcterms:publisher ${lit("Metadata Research Center, Drexel University")}`
  ])

  return scheme + "\n" + records.map(conceptTurtle).join("\n")
}

// The whole dictionary as one document: the scheme, every term concept, then
// the knowledge-organization blocks (schemes, concepts, collections) once, so
// the document stays self-describing.
export const renderSchemeTurtle = (document: SchemeDocument) => {
  const kosBlocks = kosBlocksTurtle(new KosView(document.kos))

  return (
    TTL_PREFIXES +
    renderVocabularyTurtle(document) +
    (kosBlocks ? "\n" + kosBlocks : "")
  )
}

export const schemeTurtle = async (load = loadSchemeDocument) =>
  renderSchemeTurtle(await load())

// --- JSON-LD serializations ---

const idRef = (uri: string) => ({ "@id": uri })

export const termJsonLd = (skos: TermSkos, kos: KosData) => {
  const view = new KosView(kos)
  const referenced = referencedConceptIds(skos, view)
  const schemeIds = new Set(referenced.map((id) => view.concept(id).schemeId))
  // Concept and scheme bodies once, as JSON-LD 1.1 @included nodes -- the
  // same blocks the Turtle document carries -- while every mention in the
  // term node is a bare @id reference. Schemes come without the top-concept
  // enumeration a term document does not need.
  const included = [
    ...referenced.map((id) => conceptJsonLd(view, view.concept(id))),
    ...view.schemes
      .filter((s) => schemeIds.has(s.id))
      .map((s) => schemeJsonLd(view, s, { withTopConcepts: false }))
  ]
  const subjectRefs = [...skos.facets, ...skos.topics]

  return {
    "@context": JSONLD_CONTEXT,
    "@id": skos.uri,
    "@type": "skos:Concept",
    "skos:inScheme": idRef(schemeUri),
    "skos:prefLabel": { "@value": skos.prefLabel, "@language": "en" },
    "skos:definition": skos.definitions.map((d) => {
      const revision = d.currentRevision

      return {
        "@id": revision.uri,
        "@type": "matsci:DefinitionRevision",
        "rdf:value": { "@value": revision.text, "@language": "en" },
        ...(revision.example
          ? {
              "skos:example": {
                "@value": revision.example,
                "@language": "en"
              }
            }
          : {}),
        "dcterms:creator": revision.contributors,
        "dcterms:created": {
          "@value": new Date(revision.created).toISOString(),
          "@type": "xsd:dateTime"
        },
        "dcterms:isVersionOf": {
          "@id": d.uri,
          "@type": "matsci:Definition",
          "dcterms:isPartOf": idRef(skos.uri),
          "dcterms:created": {
            "@value": new Date(d.created).toISOString(),
            "@type": "xsd:dateTime"
          },
          "dcterms:hasVersion": idRef(revision.uri),
          "matsci:definitionNumber": {
            "@value": d.definitionNumber,
            "@type": "xsd:positiveInteger"
          },
          "matsci:currentRevision": idRef(revision.uri),
          ...(d.subjects.length
            ? { "dcterms:subject": d.subjects.map((c) => idRef(c.uri)) }
            : {})
        },
        "prov:specializationOf": idRef(d.uri),
        "matsci:version": {
          "@value": revision.version,
          "@type": "xsd:positiveInteger"
        },
        "matsci:status": revision.status
      }
    }),
    "dcterms:contributor": [
      ...new Set(
        skos.definitions.flatMap((d) => d.currentRevision.contributors)
      )
    ],
    "dcterms:subject": subjectRefs.map((c) => idRef(c.uri)),
    ...(skos.broader.length
      ? { "skos:broader": skos.broader.map((t) => idRef(t.uri)) }
      : {}),
    ...(skos.narrower.length
      ? { "skos:narrower": skos.narrower.map((t) => idRef(t.uri)) }
      : {}),
    ...(skos.related.length
      ? { "skos:related": skos.related.map((t) => idRef(t.uri)) }
      : {}),
    ...Object.fromEntries(
      [...new Set(skos.mappings.map((m) => m.predicate))].map((p) => [
        p,
        skos.mappings.filter((m) => m.predicate === p).map((m) => idRef(m.iri))
      ])
    ),
    "dcterms:created": skos.created,
    ...(included.length ? { "@included": included } : {})
  }
}

// schema.org DefinedTerm for page heads: what crawlers and reference
// managers read. The top-scored definition stands in as the description.
export const definedTermJsonLd = (
  term: { id: number; term: string; slug: string },
  description: string | undefined
) => ({
  "@context": "https://schema.org",
  "@type": "DefinedTerm",
  "@id": termUri(term.slug),
  name: term.term,
  ...(description ? { description } : {}),
  url: termUri(term.slug),
  inDefinedTermSet: {
    "@type": "DefinedTermSet",
    "@id": schemeUri,
    name: SITE_NAME,
    url: SITE_URL
  }
})

// The scheme itself, for the /vocabulary page: a skos:ConceptScheme listing
// its top concepts, so the IRI every concept points at with skos:inScheme
// dereferences to a real description. Pass only terms with no active
// skos:broader term statement (see termIdsWithActiveBroader): a term under
// another term is not a top concept.
export const conceptSchemeJsonLd = (
  topTerms: { term: string; slug: string }[]
) => ({
  "@context": {
    skos: "http://www.w3.org/2004/02/skos/core#",
    dcterms: "http://purl.org/dc/terms/"
  },
  "@id": schemeUri,
  "@type": "skos:ConceptScheme",
  "dcterms:title": SITE_NAME,
  "dcterms:description":
    "A community-built controlled vocabulary for materials science metadata.",
  "skos:hasTopConcept": topTerms.map(({ term, slug }) => ({
    "@id": termUri(slug),
    "@type": "skos:Concept",
    "skos:prefLabel": { "@value": term, "@language": "en" }
  }))
})
