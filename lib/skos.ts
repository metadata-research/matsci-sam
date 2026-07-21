import "server-only"

import {
  coauthorsTable,
  db,
  definitionsTable,
  tagsTable,
  tagsToDefinitions,
  termsTable,
  usersTable
} from "@yamz/db"
import { asc, eq, inArray } from "drizzle-orm"
import { SITE_NAME, SITE_URL } from "./site"
import { definitionStatus } from "./status"

/*
 * SKOS view of the dictionary, derived on demand from the domain tables in
 * the same spirit as the PROV-O view. A term is a skos:Concept, its name the
 * prefLabel, each community definition a skos:definition with Dublin Core
 * attribution, and examples skos:example. Tags appear as dcterms:subject
 * links to tag concepts; curated tags may carry a SKOS mapping to a class in
 * an external ontology. The SKOS record describes current state; history
 * belongs to the PROV-O serialization.
 */

export const schemeUri = `${SITE_URL}/vocabulary`

// Concept IRI. Slug rather than id: this is the identifier that gets cited and
// resolved, so it should be readable and independent of the database key. The
// slug is assigned once and never reassigned (lib/slug.ts); /terms/<id> 308s
// here, so previously published id-based IRIs keep resolving.
export const termUri = (slug: string) => `${SITE_URL}/vocabulary/${slug}`
export const tagUri = (id: number) => `${SITE_URL}/tags/${id}`

export type TermSkos = {
  uri: string
  prefLabel: string
  created: string
  definitions: {
    text: string
    example: string
    contributors: string[]
    created: string
    status: string
  }[]
  subjects: {
    uri: string
    label: string
    mappingIri: string | null
    mappingRelation: string | null
  }[]
}

export const buildTermSkos = async (
  termId: number
): Promise<TermSkos | null> => {
  const term = await db.query.termsTable.findFirst({
    where: eq(termsTable.id, termId)
  })
  if (!term) return null

  const definitions = await db
    .select({
      id: definitionsTable.id,
      definition: definitionsTable.definition,
      example: definitionsTable.example,
      score: definitionsTable.score,
      createdAt: definitionsTable.createdAt,
      model: definitionsTable.model,
      authorName: usersTable.name,
      authorIsAi: usersTable.isAi
    })
    .from(definitionsTable)
    .innerJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
    .where(eq(definitionsTable.termId, termId))
    .orderBy(asc(definitionsTable.createdAt))

  const definitionIds = definitions.map((d) => d.id)

  const [coauthors, tags] = await Promise.all([
    definitionIds.length
      ? db
          .select({
            definitionId: coauthorsTable.definitionId,
            name: usersTable.name
          })
          .from(coauthorsTable)
          .innerJoin(usersTable, eq(usersTable.id, coauthorsTable.userId))
          .where(inArray(coauthorsTable.definitionId, definitionIds))
      : Promise.resolve([]),
    definitionIds.length
      ? db
          .selectDistinct({
            id: tagsTable.id,
            name: tagsTable.name,
            mappingIri: tagsTable.mappingIri,
            mappingRelation: tagsTable.mappingRelation
          })
          .from(tagsToDefinitions)
          .innerJoin(tagsTable, eq(tagsTable.id, tagsToDefinitions.tagId))
          .where(inArray(tagsToDefinitions.definitionId, definitionIds))
      : Promise.resolve([])
  ])

  return {
    uri: termUri(term.slug),
    prefLabel: term.term,
    created: term.createdAt.slice(0, 10),
    definitions: definitions.map((d) => ({
      text: d.definition,
      example: d.example,
      contributors: [
        d.authorIsAi ? (d.model ?? "AI") : (d.authorName ?? "unknown"),
        ...coauthors
          .filter((c) => c.definitionId === d.id)
          .map((c) => c.name ?? "unknown")
      ],
      created: d.createdAt.slice(0, 10),
      status: definitionStatus(d.score)
    })),
    subjects: tags.map((t) => ({
      uri: tagUri(t.id),
      label: t.name,
      mappingIri: t.mappingIri,
      mappingRelation: t.mappingRelation
    }))
  }
}

// --- Turtle serialization ---

const TTL_PREFIXES = `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

`

// Escape a Turtle string literal (backslash first, then quotes and newlines)
const lit = (value: string) =>
  `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n")}"`

const en = (value: string) => `${lit(value)}@en`
const date = (value: string) => `${lit(value)}^^xsd:date`

const conceptTurtle = (skos: TermSkos) => {
  const lines: string[] = []
  lines.push(`<${skos.uri}> a skos:Concept ;`)
  lines.push(`  skos:inScheme <${schemeUri}> ;`)
  lines.push(`  skos:prefLabel ${en(skos.prefLabel)} ;`)

  for (const d of skos.definitions) {
    lines.push(`  skos:definition ${en(d.text)} ;`)
    if (d.example) lines.push(`  skos:example ${en(d.example)} ;`)
    lines.push(
      `  skos:editorialNote ${en(
        `Definition contributed ${d.created} by ${d.contributors.join(" and ")}; community status ${d.status}.`
      )} ;`
    )
  }

  const contributors = [
    ...new Set(skos.definitions.flatMap((d) => d.contributors))
  ]
  for (const c of contributors) lines.push(`  dcterms:contributor ${lit(c)} ;`)
  for (const s of skos.subjects) lines.push(`  dcterms:subject <${s.uri}> ;`)

  lines.push(`  dcterms:created ${date(skos.created)} .`)

  for (const s of skos.subjects) {
    lines.push("")
    lines.push(`<${s.uri}> a skos:Concept ;`)
    lines.push(`  skos:prefLabel ${en(s.label)} ${
      s.mappingIri && s.mappingRelation
        ? `;\n  skos:${s.mappingRelation} <${s.mappingIri}> .`
        : "."
    }`)
  }

  return lines.join("\n") + "\n"
}

export const termTurtle = (skos: TermSkos) => TTL_PREFIXES + conceptTurtle(skos)

export const schemeTurtle = async () => {
  const terms = await db
    .select({ id: termsTable.id })
    .from(termsTable)
    .orderBy(asc(termsTable.term))

  const records = (
    await Promise.all(terms.map((t) => buildTermSkos(t.id)))
  ).filter((r): r is TermSkos => r !== null)

  const scheme = [
    `<${schemeUri}> a skos:ConceptScheme ;`,
    `  dcterms:title ${en(`${SITE_NAME} vocabulary`)} ;`,
    `  dcterms:description ${en(
      "Community definitions of materials science terminology, curated with human-in-the-loop AI by the Metadata Research Center, Drexel University."
    )} ;`,
    `  dcterms:publisher ${lit("Metadata Research Center, Drexel University")} .`,
    ""
  ].join("\n")

  return TTL_PREFIXES + scheme + "\n" + records.map(conceptTurtle).join("\n")
}

// --- JSON-LD serializations ---

export const termJsonLd = (skos: TermSkos) => ({
  "@context": {
    skos: "http://www.w3.org/2004/02/skos/core#",
    dcterms: "http://purl.org/dc/terms/"
  },
  "@id": skos.uri,
  "@type": "skos:Concept",
  "skos:inScheme": { "@id": schemeUri },
  "skos:prefLabel": { "@value": skos.prefLabel, "@language": "en" },
  "skos:definition": skos.definitions.map((d) => ({
    "@value": d.text,
    "@language": "en"
  })),
  "skos:example": skos.definitions
    .filter((d) => d.example)
    .map((d) => ({ "@value": d.example, "@language": "en" })),
  "dcterms:contributor": [
    ...new Set(skos.definitions.flatMap((d) => d.contributors))
  ],
  "dcterms:subject": skos.subjects.map((s) => ({ "@id": s.uri })),
  "dcterms:created": skos.created
})

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
// its concepts, so the IRI every concept points at with skos:inScheme
// dereferences to a real description.
export const conceptSchemeJsonLd = (
  terms: { term: string; slug: string }[]
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
  "skos:hasTopConcept": terms.map(({ term, slug }) => ({
    "@id": termUri(slug),
    "@type": "skos:Concept",
    "skos:prefLabel": { "@value": term, "@language": "en" }
  }))
})
