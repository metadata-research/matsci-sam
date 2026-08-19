/*
 * Registry for the knowledge-organization statement ledger (drizzle/schema.ts,
 * "KNOWLEDGE ORGANIZATION"). This is the single place that says what each
 * value of the closed statement_predicate enum means: its IRI, which kinds of
 * subject and object it accepts, and whether it is symmetric or has a stored
 * inverse. The serializers, the tRPC validators and the tests all read it, and
 * scripts/test-kos-db.ts proves it agrees with the statements_predicate_shape
 * CHECK in the database.
 *
 * Plain module: no "server-only", no database import, so the pure test can
 * load it and so client code may read the predicate list.
 */

import { identifierBaseUrl } from "./public-identifiers"

export const SKOS = "http://www.w3.org/2004/02/skos/core#"
export const DCTERMS = "http://purl.org/dc/terms/"

// The one open scheme: authors attach its concepts to their own definitions.
// Curated schemes (conceptSchemes.curated) attach at term level instead.
export const TOPICS_SCHEME_SLUG = "topics"

/*
 * The row shape every concept read returns, on the router and on the pages
 * alike. components/tags/selector.tsx copies a row from one query into
 * another's cache, so the shape is a contract, not a convenience.
 */
export type ConceptRow = {
  id: number
  name: string
  slug: string
  schemeSlug: string
}

export type SubjectKind = "term" | "definition" | "concept" | "collection"
export type ObjectKind = "term" | "concept" | "iri"

export type PredicateSpec = {
  iri: string
  subject: readonly SubjectKind[]
  object: readonly ObjectKind[]
  // The inverse property in the export; never stored (skos:narrower is
  // derived from the stored skos:broader row).
  inverse?: string
  // Stored once, canonical order (smaller id first); the mirror is derived.
  symmetric?: true
  // Subject and object must be the same kind (term-term or concept-concept).
  sameKind?: true
  // Two concepts must be in one scheme (checked in tRPC and invariants).
  sameScheme?: true
  // Shapes this predicate accepts beyond the subject x object product above.
  // skos:exactMatch takes an external IRI from a term or a concept, and
  // additionally a concept may name a term through the typed foreign key
  // (the bridge). Term-to-term is not a shape, so the product cannot express
  // it and the database CHECK spells the same exception out.
  extraShapes?: readonly { subject: SubjectKind; object: ObjectKind }[]
}

export const PREDICATES = {
  "dcterms:subject": {
    iri: `${DCTERMS}subject`,
    subject: ["term", "definition"],
    object: ["concept"]
  },
  "skos:broader": {
    iri: `${SKOS}broader`,
    subject: ["term", "concept"],
    object: ["term", "concept"],
    inverse: "skos:narrower",
    sameKind: true,
    sameScheme: true
  },
  "skos:related": {
    iri: `${SKOS}related`,
    subject: ["term", "concept"],
    object: ["term", "concept"],
    symmetric: true,
    sameKind: true,
    sameScheme: true
  },
  "skos:member": {
    iri: `${SKOS}member`,
    subject: ["collection"],
    object: ["term"]
  },
  "skos:exactMatch": {
    iri: `${SKOS}exactMatch`,
    subject: ["term", "concept"],
    object: ["iri"],
    // The bridge: this concept and that term are the same concept.
    extraShapes: [{ subject: "concept", object: "term" }]
  },
  "skos:closeMatch": {
    iri: `${SKOS}closeMatch`,
    subject: ["term", "concept"],
    object: ["iri"]
  },
  "skos:broadMatch": {
    iri: `${SKOS}broadMatch`,
    subject: ["term", "concept"],
    object: ["iri"]
  },
  "skos:narrowMatch": {
    iri: `${SKOS}narrowMatch`,
    subject: ["term", "concept"],
    object: ["iri"]
  },
  "skos:relatedMatch": {
    iri: `${SKOS}relatedMatch`,
    subject: ["term", "concept"],
    object: ["iri"]
  }
} as const satisfies Record<string, PredicateSpec>

export type Predicate = keyof typeof PREDICATES
export const PREDICATE_VALUES = Object.keys(PREDICATES) as Predicate[]

export const MAPPING_PREDICATES = [
  "skos:exactMatch",
  "skos:closeMatch",
  "skos:broadMatch",
  "skos:narrowMatch",
  "skos:relatedMatch"
] as const satisfies readonly Predicate[]
export type MappingPredicate = (typeof MAPPING_PREDICATES)[number]

export const isMappingPredicate = (p: Predicate): p is MappingPredicate =>
  (MAPPING_PREDICATES as readonly string[]).includes(p)

// Exact mirror of the statements_object_iri_absolute CHECK: absolute http(s),
// no whitespace, no C0 or DEL control, none of the IRIREF delimiters
// < > " { } | ^ ` \ (Turtle interpolates these raw).
export const isAbsoluteHttpIri = (value: string) =>
  /^https?:\/\/[^\s\x00-\x1f\x7f<>"{}|^`\\]+$/.test(value)

// An IRI a mapping may point at: absolute http(s) and not one of ours. Any IRI
// under the identifier base is refused so a term-to-term or term-to-concept
// link cannot bypass the typed foreign keys, and a future MatCore element IRI
// cannot arrive as a "mapping".
export const isExternalIri = (value: string, base = identifierBaseUrl) => {
  if (!isAbsoluteHttpIri(value)) return false
  const trimmedBase = base.replace(/\/+$/, "")
  if (!trimmedBase) return true
  const lower = value.toLowerCase()
  const lowerBase = trimmedBase.toLowerCase()
  return !(
    lower === lowerBase ||
    lower.startsWith(`${lowerBase}/`) ||
    lower.startsWith(`${lowerBase}#`) ||
    lower.startsWith(`${lowerBase}?`)
  )
}

// A symmetric predicate is stored once with the smaller id as subject, so one
// active-unique index also catches the mirror image. Returns the pair in
// storage order.
export const canonicalizeSymmetric = (
  subjectId: number,
  objectId: number
): [subjectId: number, objectId: number] =>
  subjectId <= objectId ? [subjectId, objectId] : [objectId, subjectId]

// The minimal row shape the resolvers below need: what the statements table
// stores for the two ends of a triple.
export type StatementEnds = {
  subjectTermId: number | null
  subjectDefinitionId: number | null
  subjectConceptId: number | null
  subjectCollectionId: number | null
  objectTermId: number | null
  objectConceptId: number | null
  objectIri: string | null
}

export type SubjectRef =
  | { kind: "term"; id: number }
  | { kind: "definition"; id: number }
  | { kind: "concept"; id: number }
  | { kind: "collection"; id: number }

export type ObjectRef =
  | { kind: "term"; id: number }
  | { kind: "concept"; id: number }
  | { kind: "iri"; iri: string }

export const subjectOf = (s: StatementEnds): SubjectRef => {
  if (s.subjectTermId !== null) return { kind: "term", id: s.subjectTermId }
  if (s.subjectDefinitionId !== null)
    return { kind: "definition", id: s.subjectDefinitionId }
  if (s.subjectConceptId !== null)
    return { kind: "concept", id: s.subjectConceptId }
  if (s.subjectCollectionId !== null)
    return { kind: "collection", id: s.subjectCollectionId }
  throw new RangeError("statement has no subject")
}

export const objectOf = (s: StatementEnds): ObjectRef => {
  if (s.objectTermId !== null) return { kind: "term", id: s.objectTermId }
  if (s.objectConceptId !== null)
    return { kind: "concept", id: s.objectConceptId }
  if (s.objectIri !== null) return { kind: "iri", iri: s.objectIri }
  throw new RangeError("statement has no object")
}

// Does the predicate accept this subject kind and object kind at all? This is
// the TypeScript twin of statements_predicate_shape; scripts/test-kos-db.ts
// checks every combination against the database.
export const predicateAccepts = (
  predicate: Predicate,
  subject: SubjectKind,
  object: ObjectKind
) => {
  const spec: PredicateSpec = PREDICATES[predicate]
  if (
    spec.extraShapes?.some(
      (shape) => shape.subject === subject && shape.object === object
    )
  )
    return true
  if (!spec.subject.includes(subject) || !spec.object.includes(object))
    return false
  if (spec.sameKind && subject !== object) return false
  return true
}

// Who may assert what. An author (definition owner) may only put a concept
// from a non-curated scheme onto their own definition; every other statement
// -- term-level facets, term relations, mappings, collection membership -- is
// a curator action. The caller loads the concept with its scheme first.
export const authorMayAssert = (
  predicate: Predicate,
  subjectKind: SubjectKind,
  objectSchemeCurated: boolean
) =>
  predicate === "dcterms:subject" &&
  subjectKind === "definition" &&
  !objectSchemeCurated

/*
 * The bridge is asserted by a curator, or by the contributor who created the
 * topic. A term is not owned, so nobody else has standing to say that a tag
 * and a term are the same concept. Seeded and migrated concepts have no
 * creator, so only topics created through the application can be linked by
 * their author.
 */
export const mayLinkConcept = (
  user: { id: number; role: string } | null,
  concept: { createdById: number | null; schemeCurated: boolean }
) => {
  if (!user) return false
  if (user.role === "admin") return true
  // A facet is curated by definition; its bridge is a curator's call.
  if (concept.schemeCurated) return false
  return concept.createdById !== null && concept.createdById === user.id
}

// Which subject level a scheme's concepts attach at: curated schemes are
// term-level facets, non-curated schemes are definition-level topics.
// Enforced in tRPC and by drizzle/invariants.sql.
export const schemeAttachesAt = (curated: boolean): "term" | "definition" =>
  curated ? "term" : "definition"
