import type { TermMetadataAssertion } from "@yamz/db"
import { metadataFieldByKey, metadataPredicateIri } from "./dictionary-metadata"
import { isAbsoluteHttpIri } from "./kos"
import { identifierBaseUrl, revisionUri, termUri } from "./public-identifiers"
import { lit } from "./rdf-literal"
import { turtleBlock } from "./kos-export"

export type MetadataAssertionRow = TermMetadataAssertion
export type MetadataTermScope = {
  id: number
  slug: string
  vocabularySlug: string
}
export type MetadataRevisionScope = {
  id: number
  termId: number
  definitionNumber: number
  version: number
}
export type MetadataFact = {
  subject: string
  predicate: string
  valueType: "text" | "iri"
  value: string
  language: string | null
}
export type MetadataAssertionEvidence = {
  row: MetadataAssertionRow
  fact: MetadataFact
  uri: string
  authorIri: string
  reviewerIri: string | null
  retractorIri: string | null
}

export const isPublicMetadataAssertion = (row: MetadataAssertionRow) =>
  row.status === "accepted"
export const isCurrentMetadataAssertion = (row: MetadataAssertionRow) =>
  isPublicMetadataAssertion(row) && row.retractedAt === null

export function metadataAssertionFact(
  row: MetadataAssertionRow,
  term: MetadataTermScope,
  revision?: MetadataRevisionScope
): MetadataFact {
  if (row.termId !== term.id)
    throw new RangeError("Metadata assertion belongs to another term")
  if (
    row.definitionRevisionId !== null &&
    (!revision ||
      revision.id !== row.definitionRevisionId ||
      revision.termId !== term.id)
  )
    throw new RangeError(
      "Metadata assertion must name its exact definition revision"
    )
  const field = metadataFieldByKey(row.fieldKey)
  if (!field || field.valueType !== row.valueType)
    throw new RangeError("Metadata field and value type do not agree")
  if (
    row.valueType === "iri" &&
    (!isAbsoluteHttpIri(row.value) || row.language !== null)
  )
    throw new RangeError(
      "Metadata link must be a safe absolute IRI without a language tag"
    )
  if (
    row.language !== null &&
    !/^[a-z]{2,8}(-[a-z0-9]{1,8})*$/.test(row.language)
  )
    throw new RangeError("Metadata language tag is invalid")
  return {
    subject:
      row.definitionRevisionId === null
        ? termUri(term.slug, term.vocabularySlug)
        : revisionUri(
            term.slug,
            revision!.definitionNumber,
            revision!.version,
            term.vocabularySlug
          ),
    predicate: metadataPredicateIri(row.fieldKey, identifierBaseUrl),
    valueType: row.valueType,
    value: row.value,
    language: row.language
  }
}

export const metadataAssertionUri = (subject: string, id: string) =>
  `${subject}#metadata-${encodeURIComponent(id)}`
export const metadataObjectTurtle = (fact: MetadataFact) =>
  fact.valueType === "iri"
    ? `<${fact.value}>`
    : `${lit(fact.value)}${fact.language ? `@${fact.language}` : ""}`
const dateTime = (value: string) =>
  `${lit(new Date(value).toISOString())}^^xsd:dateTime`

/** Ordinary reification keeps the public Turtle and JSON-LD 1.1 graphs equal.
 * It records an attestation without asserting its triple in the history graph. */
export function metadataAssertionEvidenceTurtle(
  evidence: MetadataAssertionEvidence
) {
  const { row, fact, uri, authorIri, reviewerIri, retractorIri } = evidence
  if (!isPublicMetadataAssertion(row)) return ""
  const pairs = [
    "a matsci:MetadataAssertion, rdf:Statement, prov:Entity",
    `rdf:subject <${fact.subject}>`,
    `rdf:predicate <${fact.predicate}>`,
    `rdf:object ${metadataObjectTurtle(fact)}`,
    `prov:wasAttributedTo <${authorIri}>`,
    `prov:generatedAtTime ${dateTime(row.createdAt)}`,
    `matsci:fieldKey ${lit(row.fieldKey)}`,
    `matsci:reviewStatus ${lit(row.status)}`
  ]
  if (row.reviewedAt !== null)
    pairs.push(`matsci:reviewedAt ${dateTime(row.reviewedAt)}`)
  if (reviewerIri !== null) pairs.push(`matsci:reviewedBy <${reviewerIri}>`)
  if (row.sourceIri !== null) {
    if (!isAbsoluteHttpIri(row.sourceIri))
      throw new RangeError("Metadata source must be a safe absolute IRI")
    pairs.push(`dcterms:source <${row.sourceIri}>`)
  }
  if (row.sourceLabel !== null)
    pairs.push(`matsci:sourceLabel ${lit(row.sourceLabel)}`)
  if (row.sourceVersion !== null)
    pairs.push(`matsci:sourceVersion ${lit(row.sourceVersion)}`)
  if (row.sourceIri !== null || row.sourceLabel !== null)
    pairs.push('matsci:sourceBasis "contributor_reported"')
  if (row.retractedAt !== null)
    pairs.push(`prov:invalidatedAtTime ${dateTime(row.retractedAt)}`)
  if (retractorIri !== null) pairs.push(`matsci:retractedBy <${retractorIri}>`)
  return turtleBlock(uri, pairs)
}

export function metadataFactsTurtle(facts: MetadataFact[]) {
  const bySubject = new Map<string, Set<string>>()
  for (const fact of facts) {
    const pairs = bySubject.get(fact.subject) ?? new Set<string>()
    pairs.add(`<${fact.predicate}> ${metadataObjectTurtle(fact)}`)
    bySubject.set(fact.subject, pairs)
  }
  return [...bySubject]
    .map(([subject, pairs]) => turtleBlock(subject, [...pairs]))
    .join("\n")
}

export function metadataJsonLdProperties(facts: MetadataFact[]) {
  const properties: Record<
    string,
    ({ "@id": string } | { "@value": string; "@language"?: string })[]
  > = {}
  const seen = new Set<string>()
  for (const fact of facts) {
    const key = `${fact.predicate}\n${metadataObjectTurtle(fact)}`
    if (seen.has(key)) continue
    seen.add(key)
    const value =
      fact.valueType === "iri"
        ? { "@id": fact.value }
        : {
            "@value": fact.value,
            ...(fact.language ? { "@language": fact.language } : {})
          }
    ;(properties[fact.predicate] ??= []).push(value)
  }
  return properties
}
