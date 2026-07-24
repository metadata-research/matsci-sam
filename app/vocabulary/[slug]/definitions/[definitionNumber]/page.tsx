import { DefinitionDetailPage } from "@/components/definition/detail-page"
import {
  findDefinitionByPublicNumber,
  parsePositivePublicNumber
} from "@/lib/public-definition-resolution"
import { definitionUri } from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

type PublicDefinitionParams = {
  slug: string
  definitionNumber: string
}

async function resolvePublicDefinition(
  params: Promise<PublicDefinitionParams>
) {
  const { slug, definitionNumber: definitionNumberParam } = await params
  const definitionNumber = parsePositivePublicNumber(definitionNumberParam)
  if (!definitionNumber) notFound()

  const definition = await findDefinitionByPublicNumber(slug, definitionNumber)
  if (!definition) notFound()

  return definition
}

export async function generateMetadata({
  params
}: {
  params: Promise<PublicDefinitionParams>
}): Promise<Metadata> {
  const definition = await resolvePublicDefinition(params)
  const canonical = definitionUri(
    definition.termSlug,
    definition.definitionNumber
  )

  return {
    title: `${definition.term}: definition ${definition.definitionNumber} | ${SITE_NAME}`,
    alternates: { canonical }
  }
}

export default async function PublicDefinitionPage({
  params
}: {
  params: Promise<PublicDefinitionParams>
}) {
  const definition = await resolvePublicDefinition(params)

  return <DefinitionDetailPage definitionId={definition.id} />
}
