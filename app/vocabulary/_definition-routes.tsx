import { DefinitionDetailPage } from "@/components/definition/detail-page"
import { findTermRouteAlias } from "@/app/vocabulary/_data"
import {
  findDefinitionByPublicNumber,
  findDefinitionRevisionByPublicNumber,
  parsePositivePublicNumber
} from "@/lib/public-definition-resolution"
import {
  definitionPath,
  definitionUri,
  revisionPath,
  revisionUri
} from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"
import type { Metadata } from "next"
import { notFound, permanentRedirect } from "next/navigation"
import { VocabularySourceLabel } from "./_pages"

const resolveDefinition = async (
  vocabularySlug: string,
  termSlug: string,
  definitionNumberParam: string
) => {
  const definitionNumber = parsePositivePublicNumber(definitionNumberParam)
  if (!definitionNumber) notFound()

  const definition = await findDefinitionByPublicNumber(
    termSlug,
    definitionNumber,
    vocabularySlug
  )
  if (!definition) {
    const alias = await findTermRouteAlias(vocabularySlug, termSlug)
    if (alias)
      permanentRedirect(
        definitionPath(alias.slug, definitionNumber, alias.vocabularySlug)
      )
    notFound()
  }
  return definition
}

const resolveRevision = async (
  vocabularySlug: string,
  termSlug: string,
  definitionNumberParam: string,
  versionParam: string
) => {
  const definitionNumber = parsePositivePublicNumber(definitionNumberParam)
  const version = parsePositivePublicNumber(versionParam)
  if (!definitionNumber || !version) notFound()

  const definition = await findDefinitionRevisionByPublicNumber(
    termSlug,
    definitionNumber,
    version,
    vocabularySlug
  )
  if (!definition) {
    const alias = await findTermRouteAlias(vocabularySlug, termSlug)
    if (alias)
      permanentRedirect(
        revisionPath(
          alias.slug,
          definitionNumber,
          version,
          alias.vocabularySlug
        )
      )
    notFound()
  }
  return definition
}

export async function definitionRouteMetadata(
  vocabularySlug: string,
  termSlug: string,
  definitionNumber: string
): Promise<Metadata> {
  const definition = await resolveDefinition(
    vocabularySlug,
    termSlug,
    definitionNumber
  )
  const canonical = definitionUri(
    definition.termSlug,
    definition.definitionNumber,
    definition.termVocabularySlug
  )

  return {
    title:
      definition.term +
      ": definition " +
      definition.definitionNumber +
      " | " +
      SITE_NAME,
    alternates: { canonical }
  }
}

export async function PublicDefinitionRoute({
  vocabularySlug,
  termSlug,
  definitionNumber
}: {
  vocabularySlug: string
  termSlug: string
  definitionNumber: string
}) {
  const definition = await resolveDefinition(
    vocabularySlug,
    termSlug,
    definitionNumber
  )

  return (
    <>
      <VocabularySourceLabel vocabularySlug={definition.termVocabularySlug} />
      <DefinitionDetailPage definitionId={definition.id} />
    </>
  )
}

export async function revisionRouteMetadata(
  vocabularySlug: string,
  termSlug: string,
  definitionNumber: string,
  version: string
): Promise<Metadata> {
  const definition = await resolveRevision(
    vocabularySlug,
    termSlug,
    definitionNumber,
    version
  )
  const canonical = revisionUri(
    definition.termSlug,
    definition.definitionNumber,
    definition.version,
    definition.termVocabularySlug
  )

  return {
    title:
      definition.term +
      ": definition " +
      definition.definitionNumber +
      ", revision " +
      definition.version +
      " | " +
      SITE_NAME,
    alternates: { canonical }
  }
}

export async function PublicRevisionRoute({
  vocabularySlug,
  termSlug,
  definitionNumber,
  version
}: {
  vocabularySlug: string
  termSlug: string
  definitionNumber: string
  version: string
}) {
  const definition = await resolveRevision(
    vocabularySlug,
    termSlug,
    definitionNumber,
    version
  )

  return (
    <>
      <VocabularySourceLabel vocabularySlug={definition.termVocabularySlug} />
      <DefinitionDetailPage
        definitionId={definition.id}
        version={definition.version}
      />
    </>
  )
}
