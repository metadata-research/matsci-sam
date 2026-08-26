import {
  PublicDefinitionRoute,
  definitionRouteMetadata
} from "@/app/vocabulary/_definition-routes"
import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"

type PublicDefinitionParams = {
  slug: string
  definitionNumber: string
}

export async function generateMetadata({
  params
}: {
  params: Promise<PublicDefinitionParams>
}) {
  const { slug, definitionNumber } = await params
  return definitionRouteMetadata(
    DEFAULT_VOCABULARY_SLUG,
    slug,
    definitionNumber
  )
}

export default async function PublicDefinitionPage({
  params
}: {
  params: Promise<PublicDefinitionParams>
}) {
  const { slug, definitionNumber } = await params
  return (
    <PublicDefinitionRoute
      vocabularySlug={DEFAULT_VOCABULARY_SLUG}
      termSlug={slug}
      definitionNumber={definitionNumber}
    />
  )
}
