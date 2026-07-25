import { SITE_URL } from "./site"

const identifierBaseUrl = SITE_URL.replace(/\/+$/, "")

const positiveIntegerSegment = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${label} must be a positive integer`)

  return String(value)
}

const slugSegment = (slug: string) => {
  if (!slug) throw new RangeError("Term slug must not be empty")
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
 * Application-specific RDF classes and properties share one namespace.
 * Resource identities remain under /vocabulary; this namespace is only for
 * metadata terms that SKOS, Dublin Core, and PROV-O do not provide.
 */
export const applicationMetadataNamespaceUri = `${identifierBaseUrl}/metadata#`

export const applicationMetadataUri = (name: string) => {
  if (!name) throw new RangeError("Metadata term must not be empty")
  return `${applicationMetadataNamespaceUri}${encodeURIComponent(name)}`
}
