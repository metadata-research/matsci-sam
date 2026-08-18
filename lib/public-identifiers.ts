import { SITE_URL } from "./site"

export const identifierBaseUrl = SITE_URL.replace(/\/+$/, "")

const positiveIntegerSegment = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${label} must be a positive integer`)

  return String(value)
}

const slugSegment = (slug: string, label = "Term slug") => {
  if (!slug) throw new RangeError(`${label} must not be empty`)
  return encodeURIComponent(slug)
}

const absoluteIdentifier = (path: string) => `${identifierBaseUrl}${path}`

export const schemePath = "/vocabulary"

export const termPath = (slug: string) => `${schemePath}/${slugSegment(slug)}`

export const definitionPath = (slug: string, definitionNumber: number) =>
  `${termPath(slug)}/definitions/${positiveIntegerSegment(
    definitionNumber,
    "Definition number"
  )}`

export const revisionPath = (
  slug: string,
  definitionNumber: number,
  version: number
) =>
  `${definitionPath(slug, definitionNumber)}/revisions/${positiveIntegerSegment(
    version,
    "Revision version"
  )}`

export const rankPath = (slug: string, rank: number) =>
  `${termPath(slug)}/rank/${positiveIntegerSegment(rank, "Rank")}`

export const schemeUri = absoluteIdentifier(schemePath)
export const termUri = (slug: string) => absoluteIdentifier(termPath(slug))
export const definitionUri = (slug: string, definitionNumber: number) =>
  absoluteIdentifier(definitionPath(slug, definitionNumber))
export const revisionUri = (
  slug: string,
  definitionNumber: number,
  version: number
) => absoluteIdentifier(revisionPath(slug, definitionNumber, version))
export const rankUri = (slug: string, rank: number) =>
  absoluteIdentifier(rankPath(slug, rank))

/*
 * Knowledge-organization identifiers: concept schemes other than the
 * dictionary itself, the concepts (tags, facets) they hold, and curated
 * collections of terms. The word "tag" stays in the path because that is what
 * a visitor calls all of them. A scheme slug is never all digits, so
 * /tags/<digits> stays free for the legacy numeric tag redirect. A statement
 * (one stored subject-predicate-object row) is named by a hash IRI on its
 * subject with an opaque key that is never a row id.
 */
export const tagsIndexPath = "/tags"
export const collectionsIndexPath = "/collections"

export const conceptSchemePath = (schemeSlug: string) =>
  `${tagsIndexPath}/${slugSegment(schemeSlug, "Scheme slug")}`

export const conceptPath = (schemeSlug: string, conceptSlug: string) =>
  `${conceptSchemePath(schemeSlug)}/${slugSegment(conceptSlug, "Concept slug")}`

export const collectionPath = (slug: string) =>
  `${collectionsIndexPath}/${slugSegment(slug, "Collection slug")}`

export const tagsIndexUri = absoluteIdentifier(tagsIndexPath)
export const conceptSchemeUri = (schemeSlug: string) =>
  absoluteIdentifier(conceptSchemePath(schemeSlug))
export const conceptUri = (schemeSlug: string, conceptSlug: string) =>
  absoluteIdentifier(conceptPath(schemeSlug, conceptSlug))
export const collectionUri = (slug: string) =>
  absoluteIdentifier(collectionPath(slug))

// The reifier IRI for one stored statement. The subject IRI is already
// absolute; the key is the statement's opaque uuid.
export const statementUri = (subjectIri: string, key: string) => {
  if (!subjectIri) throw new RangeError("Subject IRI must not be empty")
  if (!key) throw new RangeError("Statement key must not be empty")
  return `${subjectIri}#statement-${encodeURIComponent(key)}`
}

/*
 * Application-specific RDF classes and properties share one namespace.
 * Resource identities remain under /vocabulary; this namespace is only for
 * metadata terms that SKOS, Dublin Core, and PROV-O do not provide.
 */
export const applicationMetadataNamespaceUri = `${identifierBaseUrl}/metadata#`

export const applicationMetadataUri = (name: string) => {
  if (!name) throw new RangeError("Metadata term must not be empty")
  return `${applicationMetadataNamespaceUri}${encodeURIComponent(name)}`
}
