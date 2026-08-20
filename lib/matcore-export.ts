import {
  matCoreElementUri,
  matCoreProfileUri,
  schemeUri
} from "@/lib/public-identifiers"
import { en, turtleBlock } from "@/lib/kos-export"
import { lit } from "@/lib/rdf-literal"
import {
  matCoreProfiles,
  matCoreSourceSnapshot,
  type MatCoreElement,
  type MatCoreProfile
} from "@/lib/matcore"

/*
 * MatCore as RDF.
 *
 * The dictionary describes terminology. MatCore describes the datasets that
 * terminology is used about, so the two meet at exactly one point: an element
 * whose value should be drawn from the vocabulary rather than written as free
 * text. That join is stated with rdfs:range, and `material` is the element
 * that carries it.
 *
 * Elements are rdf:Property rather than owl:DatatypeProperty or
 * owl:ObjectProperty. The paper gives no datatypes, so committing to either
 * would assert more than the source supports. Where an element corresponds to
 * a Dublin Core property, that is said with rdfs:subPropertyOf or
 * owl:equivalentProperty and never by redeclaring the Dublin Core term here.
 *
 * Everything below is derived from the typed transcription in lib/matcore.ts.
 * Nothing is stored, and no database is involved.
 */

const profileElements = (profile: MatCoreProfile) =>
  profile.elements.map((element) => elementBlock(element, profile))

const elementBlock = (element: MatCoreElement, profile: MatCoreProfile) => {
  const pairs = [
    "a rdf:Property",
    `rdfs:label ${en(element.label)}`,
    `rdfs:comment ${en(element.description)}`,
    `dcterms:isPartOf <${matCoreProfileUri(profile.key)}>`,
    // The key as printed in the source figure, which differs from our slug for
    // at least one element, so a reader can find the row in the paper.
    `matsci:sourceKey ${lit(element.sourceKey)}`,
    `matsci:required ${element.required ? "true" : "false"}`
  ]

  if (element.crosswalk)
    pairs.push(
      element.crosswalk.relation === "exact"
        ? `owl:equivalentProperty ${element.crosswalk.property}`
        : `rdfs:subPropertyOf ${element.crosswalk.property}`
    )

  if (element.rangeIsVocabulary) pairs.push(`rdfs:range <${schemeUri}>`)

  return turtleBlock(matCoreElementUri(element.key), pairs)
}

/*
 * A profile is a tier of the standard, not a SKOS collection. skos:member has
 * the range skos:Concept union skos:Collection, so listing rdf:Property
 * elements with it would entail that every MatCore element is a concept in
 * this vocabulary, which is the one thing the element set must not say.
 * dcterms:hasPart states the containment with no such entailment, and each
 * element already carries the matching dcterms:isPartOf.
 */
const profileBlock = (profile: MatCoreProfile) =>
  turtleBlock(matCoreProfileUri(profile.key), [
    "a matsci:MetadataProfile",
    `rdfs:label ${en(profile.name)}`,
    `rdfs:comment ${en(profile.scopeNote)}`,
    ...profile.elements.map(
      (element) => `dcterms:hasPart <${matCoreElementUri(element.key)}>`
    )
  ])

// The snapshot itself, so a consumer reading only the RDF still learns which
// version of the paper this transcribes and that it is preliminary.
const snapshotBlock = () =>
  turtleBlock(matCoreProfileUri("snapshot"), [
    "a dcterms:Standard",
    `dcterms:title ${en(matCoreSourceSnapshot.title)}`,
    `dcterms:bibliographicCitation ${lit(matCoreSourceSnapshot.citationLabel)}`,
    `dcterms:identifier ${lit(matCoreSourceSnapshot.snapshotLabel)}`,
    `dcterms:date ${lit(matCoreSourceSnapshot.publishedDate)}^^xsd:date`,
    `dcterms:source <${matCoreSourceSnapshot.sourceUrl}>`,
    `rdfs:comment ${en(matCoreSourceSnapshot.transcriptionNotice)}`
  ])

export const matCoreBlocksTurtle = () =>
  [
    snapshotBlock(),
    ...matCoreProfiles.map(profileBlock),
    ...matCoreProfiles.flatMap(profileElements)
  ].join("\n")
