import "server-only"

import {
  coauthorsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  tagsTable,
  tagsToDefinitions,
  termsTable,
  usersTable
} from "@yamz/db"
import { asc, eq, inArray } from "drizzle-orm"
import { SITE_NAME, SITE_URL } from "./site"
import { definitionStatus } from "./status"
import {
  applicationMetadataNamespaceUri,
  definitionUri,
  revisionUri,
  schemeUri,
  termUri
} from "./public-identifiers"

export { schemeUri, termUri } from "./public-identifiers"

/*
 * SKOS view of the dictionary, derived on demand from the domain tables in
 * the same spirit as the PROV-O view. A term is a skos:Concept, its name the
 * prefLabel, and each current definition revision an identified
 * skos:definition resource with its text, example, and Dublin Core
 * attribution. Tags appear as dcterms:subject links to tag concepts; curated
 * tags may carry a SKOS mapping to a class in an external ontology. The SKOS
 * record describes current state; history belongs to the PROV-O serialization.
 */

export const tagUri = (id: number) => `${SITE_URL}/tags/${id}`

export type TermSkos = {
  uri: string
  prefLabel: string
  created: string
  definitions: {
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
      definitionNumber: definitionsTable.definitionNumber,
      definitionCreatedAt: definitionsTable.createdAt,
      revisionDefinition: definitionRevisionsTable.definition,
      revisionExample: definitionRevisionsTable.example,
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
    .where(eq(definitionsTable.termId, termId))
    .orderBy(asc(definitionsTable.definitionNumber))

  const definitionIds = definitions.map((d) => d.id)

  const [coauthors, tags] = await Promise.all([
    definitionIds.length
      ? db
          .select({
            definitionId: coauthorsTable.definitionId,
            name: usersTable.name,
            isAi: usersTable.isAi
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
    definitions: definitions.map((d) => {
      const contributors = [
        d.authorIsAi
          ? (d.revisionModel ?? d.authorName ?? "AI")
          : (d.authorName ?? "unknown"),
        ...coauthors
          .filter(
            (c) =>
              c.definitionId === d.id &&
              c.isAi &&
              d.revisionModel !== null &&
              c.name === d.revisionModel
          )
          .map((c) => c.name ?? "unknown")
      ]

      return {
        uri: definitionUri(term.slug, d.definitionNumber),
        definitionNumber: d.definitionNumber,
        created: d.definitionCreatedAt,
        currentRevision: {
          uri: revisionUri(term.slug, d.definitionNumber, d.revisionVersion),
          version: d.revisionVersion,
          text: d.revisionDefinition,
          // Legacy revision imports may not contain the historical example.
          // The stable row mirrors the current content and supplies it here.
          example: d.revisionExample ?? d.legacyExample,
          contributors: [...new Set(contributors)],
          created: d.revisionCreatedAt,
          status: definitionStatus(d.score)
        }
      }
    }),
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
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix matsci: <${applicationMetadataNamespaceUri}> .
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
const dateTime = (value: string) =>
  `${lit(new Date(value).toISOString())}^^xsd:dateTime`
const positiveInteger = (value: number) =>
  `${lit(String(value))}^^xsd:positiveInteger`

const conceptTurtle = (skos: TermSkos) => {
  const lines: string[] = []
  lines.push(`<${skos.uri}> a skos:Concept ;`)
  lines.push(`  skos:inScheme <${schemeUri}> ;`)
  lines.push(`  skos:prefLabel ${en(skos.prefLabel)} ;`)

  for (const d of skos.definitions) {
    lines.push(`  skos:definition <${d.currentRevision.uri}> ;`)
  }

  const contributors = [
    ...new Set(skos.definitions.flatMap((d) => d.currentRevision.contributors))
  ]
  for (const c of contributors) lines.push(`  dcterms:contributor ${lit(c)} ;`)
  for (const s of skos.subjects) lines.push(`  dcterms:subject <${s.uri}> ;`)

  lines.push(`  dcterms:created ${date(skos.created)} .`)

  for (const d of skos.definitions) {
    const revision = d.currentRevision

    lines.push("")
    lines.push(`<${d.uri}> a matsci:Definition ;`)
    lines.push(`  dcterms:isPartOf <${skos.uri}> ;`)
    lines.push(
      `  matsci:definitionNumber ${positiveInteger(d.definitionNumber)} ;`
    )
    lines.push(`  matsci:currentRevision <${revision.uri}> ;`)
    lines.push(`  dcterms:hasVersion <${revision.uri}> ;`)
    lines.push(`  dcterms:created ${dateTime(d.created)} .`)

    lines.push("")
    lines.push(`<${revision.uri}> a matsci:DefinitionRevision ;`)
    lines.push(`  rdf:value ${en(revision.text)} ;`)
    if (revision.example) lines.push(`  skos:example ${en(revision.example)} ;`)
    lines.push(`  dcterms:isVersionOf <${d.uri}> ;`)
    lines.push(`  prov:specializationOf <${d.uri}> ;`)
    for (const contributor of revision.contributors)
      lines.push(`  dcterms:creator ${lit(contributor)} ;`)
    lines.push(`  matsci:version ${positiveInteger(revision.version)} ;`)
    lines.push(`  matsci:status ${lit(revision.status)} ;`)
    lines.push(`  dcterms:created ${dateTime(revision.created)} .`)
  }

  for (const s of skos.subjects) {
    lines.push("")
    lines.push(`<${s.uri}> a skos:Concept ;`)
    lines.push(
      `  skos:prefLabel ${en(s.label)} ${
        s.mappingIri && s.mappingRelation
          ? `;\n  skos:${s.mappingRelation} <${s.mappingIri}> .`
          : "."
      }`
    )
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
    dcterms: "http://purl.org/dc/terms/",
    prov: "http://www.w3.org/ns/prov#",
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    matsci: applicationMetadataNamespaceUri,
    xsd: "http://www.w3.org/2001/XMLSchema#"
  },
  "@id": skos.uri,
  "@type": "skos:Concept",
  "skos:inScheme": { "@id": schemeUri },
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
        "dcterms:isPartOf": { "@id": skos.uri },
        "dcterms:created": {
          "@value": new Date(d.created).toISOString(),
          "@type": "xsd:dateTime"
        },
        "dcterms:hasVersion": { "@id": revision.uri },
        "matsci:definitionNumber": {
          "@value": d.definitionNumber,
          "@type": "xsd:positiveInteger"
        },
        "matsci:currentRevision": { "@id": revision.uri }
      },
      "prov:specializationOf": { "@id": d.uri },
      "matsci:version": {
        "@value": revision.version,
        "@type": "xsd:positiveInteger"
      },
      "matsci:status": revision.status
    }
  }),
  "dcterms:contributor": [
    ...new Set(skos.definitions.flatMap((d) => d.currentRevision.contributors))
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
