import {
  PublicRevisionRoute,
  revisionRouteMetadata
} from "@/app/vocabulary/_definition-routes"
import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"

type PublicRevisionParams = {
  slug: string
  definitionNumber: string
  version: string
}

export async function generateMetadata({
  params
}: {
  params: Promise<PublicRevisionParams>
}) {
  const { slug, definitionNumber, version } = await params
  return revisionRouteMetadata(
    DEFAULT_VOCABULARY_SLUG,
    slug,
    definitionNumber,
    version
  )
}

export default async function PublicRevisionPage({
  params
}: {
  params: Promise<PublicRevisionParams>
}) {
  const { slug, definitionNumber, version } = await params
  return (
    <PublicRevisionRoute
      vocabularySlug={DEFAULT_VOCABULARY_SLUG}
      termSlug={slug}
      definitionNumber={definitionNumber}
      version={version}
    />
  )
}
