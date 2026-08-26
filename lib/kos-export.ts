/*
 * Knowledge-organization export: the concept schemes, concepts, collections
 * and the statements between them, rendered as SKOS Turtle and JSON-LD.
 *
 * Pure module. Everything here works from an in-memory KosData snapshot; the
 * database loader (loadKos in lib/skos.ts) is injected by the routes, and
 * scripts/test-kos.ts builds documents from fixtures. Concept, scheme and
 * collection blocks are emitted once per document, so callers pass the whole
 * snapshot and say which concepts a document should describe.
 *
 * Derived triples (the skos:related mirror, every skos:narrower, the lifted
 * term-level dcterms:subject) have no stored row and therefore no reifier;
 * the reifier (slice D) describes the stored direction only.
 */

import {
  applicationMetadataNamespaceUri,
  collectionUri,
  conceptSchemeUri,
  conceptUri,
  termUri
} from "./public-identifiers"
import { lit } from "./rdf-literal"
import {
  MAPPING_PREDICATES,
  type MappingPredicate,
  type Predicate,
  isMappingPredicate
} from "./kos"

// --- Snapshot types ---

export type KosScheme = {
  id: number
  slug: string
  title: string
  description: string | null
  assertableBy: "curator" | "contributor"
}

export type KosConcept = {
  id: number
  schemeId: number
  slug: string
  prefLabel: string
  altLabels: string[]
  definition: string | null
  scopeNote: string | null
  status: "approved" | "retired" | "proposed"
  replacedById: number | null
}

export type KosCollection = {
  id: number
  slug: string
  title: string
  description: string | null
  retiredAt: string | null
}

// One active statement row (retracted rows are not loaded).
export type KosStatement = {
  id: number
  key: string
  predicate: Predicate
  subjectTermId: number | null
  subjectDefinitionId: number | null
  subjectConceptId: number | null
  subjectCollectionId: number | null
  objectTermId: number | null
  objectConceptId: number | null
  objectIri: string | null
}

// Terms referenced by any loaded statement, so relations and collection
// members can be written as term IRIs without another lookup.
export type KosTerm = {
  id: number
  term: string
  slug: string
  vocabularySlug: string
}

export type KosData = {
  schemes: KosScheme[]
  concepts: KosConcept[]
  collections: KosCollection[]
  statements: KosStatement[]
  terms: KosTerm[]
}

export type ConceptRef = {
  id: number
  uri: string
  label: string
  schemeSlug: string
  slug: string
}

export type TermRef = { id: number; uri: string; label: string }

export type Mapping = { predicate: MappingPredicate; iri: string }

// --- Indexed view over a snapshot ---

const byLabel = (a: KosConcept, b: KosConcept) =>
  a.prefLabel.localeCompare(b.prefLabel, "en")

const byRefLabel = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label, "en")

export class KosView {
  readonly schemes: KosScheme[]
  readonly concepts: KosConcept[]
  readonly collections: KosCollection[]
  readonly statements: KosStatement[]
  private schemeById = new Map<number, KosScheme>()
  private conceptById = new Map<number, KosConcept>()
  private termById = new Map<number, KosTerm>()

  constructor(data: KosData) {
    this.schemes = [...data.schemes].sort((a, b) => a.id - b.id)
    // A proposed concept is not published anywhere; the loader excludes it
    // and the view excludes it again so a fixture cannot leak one.
    this.concepts = data.concepts
      .filter((c) => c.status !== "proposed")
      .sort((a, b) => a.schemeId - b.schemeId || byLabel(a, b))
    this.collections = [...data.collections].sort((a, b) =>
      a.title.localeCompare(b.title, "en")
    )
    this.statements = [...data.statements].sort((a, b) => a.id - b.id)
    for (const s of this.schemes) this.schemeById.set(s.id, s)
    for (const c of this.concepts) this.conceptById.set(c.id, c)
    for (const t of data.terms) this.termById.set(t.id, t)
  }

  scheme(id: number) {
    const s = this.schemeById.get(id)
    if (!s) throw new RangeError(`unknown concept scheme ${id}`)
    return s
  }

  concept(id: number) {
    const c = this.conceptById.get(id)
    if (!c) throw new RangeError(`unknown concept ${id}`)
    return c
  }

  conceptOrNull(id: number) {
    return this.conceptById.get(id) ?? null
  }

  termOrNull(id: number) {
    return this.termById.get(id) ?? null
  }

  schemeIri(scheme: KosScheme) {
    return conceptSchemeUri(scheme.slug)
  }

  conceptIri(concept: KosConcept) {
    return conceptUri(this.scheme(concept.schemeId).slug, concept.slug)
  }

  conceptRef(concept: KosConcept): ConceptRef {
    const scheme = this.scheme(concept.schemeId)
    return {
      id: concept.id,
      uri: conceptUri(scheme.slug, concept.slug),
      label: concept.prefLabel,
      schemeSlug: scheme.slug,
      slug: concept.slug
    }
  }

  termRef(id: number): TermRef | null {
    const t = this.termById.get(id)
    return t
      ? {
          id,
          uri: termUri(t.slug, t.vocabularySlug),
          label: t.term
        }
      : null
  }

  // Concepts of a scheme with no active in-scheme skos:broader and not
  // retired: SKOS's convention for top concepts (Reference 4.6.3).
  topConcepts(scheme: KosScheme) {
    return this.concepts.filter(
      (c) =>
        c.schemeId === scheme.id &&
        c.status !== "retired" &&
        this.conceptBroader(c.id).length === 0
    )
  }

  conceptBroader(conceptId: number) {
    return this.statements
      .filter(
        (s) =>
          s.predicate === "skos:broader" && s.subjectConceptId === conceptId
      )
      .map((s) => this.concept(s.objectConceptId!))
  }

  conceptNarrower(conceptId: number) {
    return this.statements
      .filter(
        (s) => s.predicate === "skos:broader" && s.objectConceptId === conceptId
      )
      .map((s) => this.concept(s.subjectConceptId!))
  }

  conceptRelated(conceptId: number) {
    return this.statements
      .filter(
        (s) =>
          s.predicate === "skos:related" &&
          (s.subjectConceptId === conceptId || s.objectConceptId === conceptId)
      )
      .map((s) =>
        this.concept(
          s.subjectConceptId === conceptId
            ? s.objectConceptId!
            : s.subjectConceptId!
        )
      )
  }

  // Mappings asserted by a concept. The object is an external IRI, except
  // for the bridge, where a concept names a term of this vocabulary through
  // objectTermId. Both render as the same triple.
  conceptMappings(conceptId: number): Mapping[] {
    return this.statements
      .filter(
        (s) =>
          isMappingPredicate(s.predicate) && s.subjectConceptId === conceptId
      )
      .map((s) => ({
        predicate: s.predicate as MappingPredicate,
        iri: s.objectIri ?? this.termRef(s.objectTermId!)?.uri ?? null
      }))
      .filter((m): m is Mapping => m.iri !== null)
  }

  // The term a concept is bridged to, if any. One at most: the partial
  // unique indexes on statements allow a single active link each way.
  conceptBridge(conceptId: number): TermRef | null {
    const link = this.statements.find(
      (s) =>
        s.predicate === "skos:exactMatch" &&
        s.subjectConceptId === conceptId &&
        s.objectTermId !== null
    )
    return link ? this.termRef(link.objectTermId!) : null
  }

  // Term-level dcterms:subject (facets in curator schemes), by label.
  termFacets(termId: number): ConceptRef[] {
    return this.statements
      .filter(
        (s) => s.predicate === "dcterms:subject" && s.subjectTermId === termId
      )
      .map((s) => this.conceptRef(this.concept(s.objectConceptId!)))
      .sort(byRefLabel)
  }

  // Definition-level dcterms:subject (topics in the open scheme), by label.
  definitionSubjects(definitionId: number): ConceptRef[] {
    return this.statements
      .filter(
        (s) =>
          s.predicate === "dcterms:subject" &&
          s.subjectDefinitionId === definitionId
      )
      .map((s) => this.conceptRef(this.concept(s.objectConceptId!)))
      .sort(byRefLabel)
  }

  termBroader(termId: number): TermRef[] {
    return this.statements
      .filter(
        (s) => s.predicate === "skos:broader" && s.subjectTermId === termId
      )
      .map((s) => this.termRef(s.objectTermId!))
      .filter((t): t is TermRef => t !== null)
  }

  termNarrower(termId: number): TermRef[] {
    return this.statements
      .filter(
        (s) => s.predicate === "skos:broader" && s.objectTermId === termId
      )
      .map((s) => this.termRef(s.subjectTermId!))
      .filter((t): t is TermRef => t !== null)
  }

  termRelated(termId: number): TermRef[] {
    return this.statements
      .filter(
        (s) =>
          s.predicate === "skos:related" &&
          (s.subjectTermId === termId || s.objectTermId === termId)
      )
      .map((s) =>
        this.termRef(
          s.subjectTermId === termId ? s.objectTermId! : s.subjectTermId!
        )
      )
      .filter((t): t is TermRef => t !== null)
  }

  termMappings(termId: number): Mapping[] {
    const asserted = this.statements
      .filter(
        (s) => isMappingPredicate(s.predicate) && s.subjectTermId === termId
      )
      .map((s) => ({
        predicate: s.predicate as MappingPredicate,
        iri: s.objectIri!
      }))

    // Derived: skos:exactMatch is symmetric, so a concept bridged to this
    // term is also a mapping of the term. No stored row, so no reifier.
    const bridged = this.statements
      .filter(
        (s) => s.predicate === "skos:exactMatch" && s.objectTermId === termId
      )
      .map((s) => this.conceptOrNull(s.subjectConceptId!))
      .filter((c): c is KosConcept => c !== null)
      .map((c) => ({
        predicate: "skos:exactMatch" as MappingPredicate,
        iri: this.conceptIri(c)
      }))

    return [...asserted, ...bridged]
  }

  // Concepts bridged to a term, for a document that must carry their blocks.
  termBridgedConceptIds(termId: number): number[] {
    return this.statements
      .filter(
        (s) => s.predicate === "skos:exactMatch" && s.objectTermId === termId
      )
      .map((s) => s.subjectConceptId!)
  }

  // Term ids that have an active skos:broader term statement, i.e. are not
  // top concepts of the dictionary scheme.
  termIdsWithBroader(): Set<number> {
    return new Set(
      this.statements
        .filter(
          (s) => s.predicate === "skos:broader" && s.subjectTermId !== null
        )
        .map((s) => s.subjectTermId!)
    )
  }

  collectionMembers(collectionId: number): TermRef[] {
    return this.statements
      .filter(
        (s) =>
          s.predicate === "skos:member" &&
          s.subjectCollectionId === collectionId
      )
      .map((s) => this.termRef(s.objectTermId!))
      .filter((t): t is TermRef => t !== null)
      .sort((a, b) => a.label.localeCompare(b.label, "en"))
  }
}

// --- Turtle ---

export const TTL_PREFIXES = `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix matsci: <${applicationMetadataNamespaceUri}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

`

export const JSONLD_CONTEXT = {
  skos: "http://www.w3.org/2004/02/skos/core#",
  dcterms: "http://purl.org/dc/terms/",
  prov: "http://www.w3.org/ns/prov#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  owl: "http://www.w3.org/2002/07/owl#",
  matsci: applicationMetadataNamespaceUri,
  xsd: "http://www.w3.org/2001/XMLSchema#"
} as const

export const en = (value: string) => `${lit(value)}@en`

// One subject with its predicate-object pairs as a Turtle block.
export const turtleBlock = (subject: string, pairs: string[]) =>
  `<${subject}> ${pairs.join(" ;\n  ")} .\n`

// Scheme block. Top concepts are listed only when asked (whole-KOS documents);
// a term document describes the scheme without enumerating it.
export const schemeBlockTurtle = (
  view: KosView,
  scheme: KosScheme,
  { withTopConcepts = true } = {}
) => {
  const pairs = ["a skos:ConceptScheme", `dcterms:title ${en(scheme.title)}`]
  if (scheme.description)
    pairs.push(`dcterms:description ${en(scheme.description)}`)
  // A term points at a facet and at a topic with the same dcterms:subject, so
  // without this a consumer cannot tell a curated classification from an open
  // one. The concept already carries skos:inScheme, which makes the scheme
  // reachable in one step from any tagged term. Derived from the policy rather
  // than stored, so the published shape did not change when the boolean did.
  pairs.push(
    `matsci:curated ${scheme.assertableBy === "curator" ? "true" : "false"}`
  )
  if (withTopConcepts)
    for (const c of view.topConcepts(scheme))
      pairs.push(`skos:hasTopConcept <${view.conceptIri(c)}>`)
  return turtleBlock(view.schemeIri(scheme), pairs)
}

export const conceptBlockTurtle = (view: KosView, concept: KosConcept) => {
  const scheme = view.scheme(concept.schemeId)
  const pairs = ["a skos:Concept", `skos:inScheme <${view.schemeIri(scheme)}>`]

  if (concept.status === "retired") {
    // A merged or withdrawn concept keeps its IRI, says so, and points at
    // its replacement. No top-concept claim and no other statements.
    pairs.push(`skos:prefLabel ${en(concept.prefLabel)}`)
    pairs.push("owl:deprecated true")
    if (concept.replacedById !== null) {
      const replacement = view.conceptOrNull(concept.replacedById)
      if (replacement)
        pairs.push(`dcterms:isReplacedBy <${view.conceptIri(replacement)}>`)
    }
    return turtleBlock(view.conceptIri(concept), pairs)
  }

  const broader = view.conceptBroader(concept.id)
  if (broader.length === 0)
    pairs.push(`skos:topConceptOf <${view.schemeIri(scheme)}>`)
  pairs.push(`skos:prefLabel ${en(concept.prefLabel)}`)
  for (const alt of concept.altLabels) pairs.push(`skos:altLabel ${en(alt)}`)
  if (concept.definition)
    pairs.push(`skos:definition ${en(concept.definition)}`)
  if (concept.scopeNote) pairs.push(`skos:scopeNote ${en(concept.scopeNote)}`)
  for (const b of broader) pairs.push(`skos:broader <${view.conceptIri(b)}>`)
  for (const n of view.conceptNarrower(concept.id))
    pairs.push(`skos:narrower <${view.conceptIri(n)}>`)
  for (const r of view.conceptRelated(concept.id))
    pairs.push(`skos:related <${view.conceptIri(r)}>`)
  for (const m of view.conceptMappings(concept.id))
    pairs.push(`${m.predicate} <${m.iri}>`)
  return turtleBlock(view.conceptIri(concept), pairs)
}

export const collectionBlockTurtle = (
  view: KosView,
  collection: KosCollection
) => {
  const pairs = ["a skos:Collection", `skos:prefLabel ${en(collection.title)}`]
  if (collection.description)
    pairs.push(`dcterms:description ${en(collection.description)}`)
  // A retired collection keeps its IRI and says it is deprecated, the same way
  // a retired concept does. Its members were retracted when it retired, so the
  // loop below finds none.
  if (collection.retiredAt) pairs.push("owl:deprecated true")
  for (const m of view.collectionMembers(collection.id))
    pairs.push(`skos:member <${m.uri}>`)
  return turtleBlock(collectionUri(collection.slug), pairs)
}

// The scheme, concept and collection blocks of a document, each once. With
// `conceptIds` only those concepts and their schemes are described (a term
// document); without it, the whole KOS (tags.ttl, vocabulary.ttl).
export const kosBlocksTurtle = (
  view: KosView,
  conceptIds?: Iterable<number>
): string => {
  const blocks: string[] = []
  if (conceptIds === undefined) {
    for (const s of view.schemes) blocks.push(schemeBlockTurtle(view, s))
    for (const c of view.concepts) blocks.push(conceptBlockTurtle(view, c))
    for (const c of view.collections)
      blocks.push(collectionBlockTurtle(view, c))
    return blocks.join("\n")
  }

  const wanted = new Set(conceptIds)
  const concepts = view.concepts.filter((c) => wanted.has(c.id))
  const schemeIds = new Set(concepts.map((c) => c.schemeId))
  for (const s of view.schemes)
    if (schemeIds.has(s.id))
      blocks.push(schemeBlockTurtle(view, s, { withTopConcepts: false }))
  for (const c of concepts) blocks.push(conceptBlockTurtle(view, c))
  return blocks.join("\n")
}

// /tags.ttl: the whole knowledge-organization layer as one document.
export const kosTurtle = (data: KosData) =>
  TTL_PREFIXES + kosBlocksTurtle(new KosView(data))

// --- JSON-LD ---

const idRef = (uri: string) => ({ "@id": uri })

export const schemeJsonLd = (
  view: KosView,
  scheme: KosScheme,
  { withTopConcepts = true } = {}
) => ({
  "@id": view.schemeIri(scheme),
  "@type": "skos:ConceptScheme",
  "dcterms:title": { "@value": scheme.title, "@language": "en" },
  ...(scheme.description
    ? {
        "dcterms:description": {
          "@value": scheme.description,
          "@language": "en"
        }
      }
    : {}),
  ...(withTopConcepts
    ? {
        "skos:hasTopConcept": view
          .topConcepts(scheme)
          .map((c) => idRef(view.conceptIri(c)))
      }
    : {})
})

export const conceptJsonLd = (view: KosView, concept: KosConcept) => {
  const scheme = view.scheme(concept.schemeId)
  const base = {
    "@id": view.conceptIri(concept),
    "@type": "skos:Concept",
    "skos:inScheme": idRef(view.schemeIri(scheme)),
    "skos:prefLabel": { "@value": concept.prefLabel, "@language": "en" }
  }
  if (concept.status === "retired") {
    const replacement =
      concept.replacedById !== null
        ? view.conceptOrNull(concept.replacedById)
        : null
    return {
      ...base,
      "owl:deprecated": true,
      ...(replacement
        ? { "dcterms:isReplacedBy": idRef(view.conceptIri(replacement)) }
        : {})
    }
  }
  const broader = view.conceptBroader(concept.id)
  const mappings = view.conceptMappings(concept.id)
  return {
    ...base,
    ...(broader.length === 0
      ? { "skos:topConceptOf": idRef(view.schemeIri(scheme)) }
      : {}),
    ...(concept.altLabels.length
      ? {
          "skos:altLabel": concept.altLabels.map((alt) => ({
            "@value": alt,
            "@language": "en"
          }))
        }
      : {}),
    ...(concept.definition
      ? {
          "skos:definition": {
            "@value": concept.definition,
            "@language": "en"
          }
        }
      : {}),
    ...(concept.scopeNote
      ? {
          "skos:scopeNote": {
            "@value": concept.scopeNote,
            "@language": "en"
          }
        }
      : {}),
    ...(broader.length
      ? { "skos:broader": broader.map((b) => idRef(view.conceptIri(b))) }
      : {}),
    ...(view.conceptNarrower(concept.id).length
      ? {
          "skos:narrower": view
            .conceptNarrower(concept.id)
            .map((n) => idRef(view.conceptIri(n)))
        }
      : {}),
    ...(view.conceptRelated(concept.id).length
      ? {
          "skos:related": view
            .conceptRelated(concept.id)
            .map((r) => idRef(view.conceptIri(r)))
        }
      : {}),
    ...Object.fromEntries(
      MAPPING_PREDICATES.filter((p) =>
        mappings.some((m) => m.predicate === p)
      ).map((p) => [
        p,
        mappings.filter((m) => m.predicate === p).map((m) => idRef(m.iri))
      ])
    )
  }
}
