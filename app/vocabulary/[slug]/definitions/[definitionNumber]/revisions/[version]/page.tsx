import { DefinitionDetailPage } from "@/components/definition/detail-page"
import {
  findDefinitionRevisionByPublicNumber,
  parsePositivePublicNumber
} from "@/lib/public-definition-resolution"
import { revisionUri } from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

type PublicRevisionParams = {
  slug: string
  definitionNumber: string
  version: string
}

async function resolvePublicRevision(params: Promise<PublicRevisionParams>) {
  const {
    slug,
    definitionNumber: definitionNumberParam,
    version: versionParam
  } = await params
  const definitionNumber = parsePositivePublicNumber(definitionNumberParam)
  const version = parsePositivePublicNumber(versionParam)
  if (!definitionNumber || !version) notFound()

  const definition = await findDefinitionRevisionByPublicNumber(
    slug,
    definitionNumber,
    version
  )
  if (!definition) notFound()

  return definition
}

export async function generateMetadata({
  params
}: {
  params: Promise<PublicRevisionParams>
}): Promise<Metadata> {
  const definition = await resolvePublicRevision(params)
  const canonical = revisionUri(
    definition.termSlug,
    definition.definitionNumber,
    definition.version
  )

  return {
    title: `${definition.term}: definition ${definition.definitionNumber}, revision ${definition.version} | ${SITE_NAME}`,
    alternates: { canonical }
  }
}

export default async function PublicRevisionPage({
  params
}: {
  params: Promise<PublicRevisionParams>
}) {
  const definition = await resolvePublicRevision(params)

  return (
    <DefinitionDetailPage
      definitionId={definition.id}
      version={definition.version}
    />
  )
}
