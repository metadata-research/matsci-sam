import { IDENTIFIER_BASE_URL } from "./site"

// The authority every IRI below is built under. Already normalized (no
// trailing slash) and validated in lib/site.ts.
export const identifierBaseUrl = IDENTIFIER_BASE_URL

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
export const DEFAULT_VOCABULARY_SLUG = "matsci-sam"

export const vocabularyPath = (vocabularySlug: string) =>
  vocabularySlug === DEFAULT_VOCABULARY_SLUG
    ? schemePath
    : `${schemePath}/${slugSegment(vocabularySlug, "Vocabulary slug")}`

export const termPath = (
  slug: string,
  vocabularySlug = DEFAULT_VOCABULARY_SLUG
) => `${vocabularyPath(vocabularySlug)}/${slugSegment(slug)}`

// An application view of recorded changes around a concept. It deliberately
// has no matching URI builder: the activity page is not a published entity.
export const termActivityPath = (
  slug: string,
  vocabularySlug = DEFAULT_VOCABULARY_SLUG
) => `${termPath(slug, vocabularySlug)}/activity`

export const definitionPath = (
  slug: string,
  definitionNumber: number,
  vocabularySlug = DEFAULT_VOCABULARY_SLUG
) =>
  `${termPath(slug, vocabularySlug)}/definitions/${positiveIntegerSegment(
    definitionNumber,
    "Definition number"
  )}`

export const revisionPath = (
  slug: string,
  definitionNumber: number,
  version: number,
  vocabularySlug = DEFAULT_VOCABULARY_SLUG
) =>
  `${definitionPath(slug, definitionNumber, vocabularySlug)}/revisions/${positiveIntegerSegment(version, "Revision version")}`

export const rankPath = (
  slug: string,
  rank: number,
  vocabularySlug = DEFAULT_VOCABULARY_SLUG
) =>
  `${termPath(slug, vocabularySlug)}/rank/${positiveIntegerSegment(rank, "Rank")}`

export const schemeUri = absoluteIdentifier(schemePath)
export const vocabularyUri = (vocabularySlug: string) =>
  absoluteIdentifier(vocabularyPath(vocabularySlug))
export const termUri = (
  slug: string,
  vocabularySlug = DEFAULT_VOCABULARY_SLUG
) => absoluteIdentifier(termPath(slug, vocabularySlug))
export const definitionUri = (
  slug: string,
  definitionNumber: number,
  vocabularySlug = DEFAULT_VOCABULARY_SLUG
) => absoluteIdentifier(definitionPath(slug, definitionNumber, vocabularySlug))
export const revisionUri = (
  slug: string,
  definitionNumber: number,
  version: number,
  vocabularySlug = DEFAULT_VOCABULARY_SLUG
) =>
  absoluteIdentifier(
    revisionPath(slug, definitionNumber, version, vocabularySlug)
  )
export const rankUri = (
  slug: string,
  rank: number,
  vocabularySlug = DEFAULT_VOCABULARY_SLUG
) => absoluteIdentifier(rankPath(slug, rank, vocabularySlug))

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

/*
 * Communities are application routes, not published identifiers. There is
 * deliberately no communityUri or invitationUri to go with these: a Uri
 * builder in this file means the thing dereferences as RDF, and nothing about
 * a group of people is published. Do not complete the triple.
 */
export const communitiesIndexPath = "/communities"

export const communityPath = (slug: string) =>
  `${communitiesIndexPath}/${slugSegment(slug, "Community slug")}`

/*
 * A study is published as a prov:Activity: its title, its window and the
 * collection it works through are in the dataset graph. Its people are not.
 * The community that runs it, the roster and the invitations stay
 * application routes with no identifier, and the study IRI says nothing
 * about who took part.
 */
export const studiesIndexPath = "/studies"

export const studyPath = (slug: string) =>
  `${studiesIndexPath}/${slugSegment(slug, "Study slug")}`

// The walkthrough of a study. An application route under the study, with no
// identifier of its own: what a participant does there is recorded against
// the terms and the study.
export const studyRunPath = (slug: string) => `${studyPath(slug)}/run`

export const invitePath = (token: string) =>
  `/invite/${slugSegment(token, "Invitation token")}`

export const tagsIndexUri = absoluteIdentifier(tagsIndexPath)
export const conceptSchemeUri = (schemeSlug: string) =>
  absoluteIdentifier(conceptSchemePath(schemeSlug))
export const conceptUri = (schemeSlug: string, conceptSlug: string) =>
  absoluteIdentifier(conceptPath(schemeSlug, conceptSlug))
export const collectionUri = (slug: string) =>
  absoluteIdentifier(collectionPath(slug))
export const studyUri = (slug: string) => absoluteIdentifier(studyPath(slug))

/*
 * A model that contributes is an agent with a resolvable identity, so it gets
 * a readable path of its own rather than the /people/<id> route, which
 * exposes a database key and carries fields a model has no use for.
 */
export const modelsIndexPath = "/models"

export const modelPath = (slug: string) =>
  `${modelsIndexPath}/${slugSegment(slug, "Model slug")}`

export const modelUri = (slug: string) => absoluteIdentifier(modelPath(slug))

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

/*
 * MatCore elements are a transcription of a published standard, so they get a
 * namespace of their own rather than sharing the application namespace above.
 * The distinction matters to a consumer: matsci: terms are ours to change,
 * these describe somebody else's specification.
 */
export const matCoreNamespaceUri = `${identifierBaseUrl}/metadata/matcore#`

export const matCoreElementUri = (key: string) => {
  if (!key) throw new RangeError("MatCore element key must not be empty")
  return `${matCoreNamespaceUri}${encodeURIComponent(key)}`
}

export const matCoreProfileUri = (key: string) => {
  if (!key) throw new RangeError("MatCore profile key must not be empty")
  return `${matCoreNamespaceUri}${encodeURIComponent(key)}`
}
