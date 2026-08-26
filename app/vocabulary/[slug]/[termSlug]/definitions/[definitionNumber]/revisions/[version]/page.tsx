import {
  PublicRevisionRoute,
  revisionRouteMetadata
} from "@/app/vocabulary/_definition-routes"
import { findNondefaultVocabulary } from "@/app/vocabulary/_data"
import { notFound } from "next/navigation"

type NamespacedRevisionParams = {
  slug: string
  termSlug: string
  definitionNumber: string
  version: string
}

const requireVocabulary = async (slug: string) => {
  if (!(await findNondefaultVocabulary(slug))) notFound()
}

export async function generateMetadata({
  params
}: {
  params: Promise<NamespacedRevisionParams>
}) {
  const { slug, termSlug, definitionNumber, version } = await params
  await requireVocabulary(slug)
  return revisionRouteMetadata(slug, termSlug, definitionNumber, version)
}

export default async function NamespacedRevisionPage({
  params
}: {
  params: Promise<NamespacedRevisionParams>
}) {
  const { slug, termSlug, definitionNumber, version } = await params
  await requireVocabulary(slug)
  return (
    <PublicRevisionRoute
      vocabularySlug={slug}
      termSlug={termSlug}
      definitionNumber={definitionNumber}
      version={version}
    />
  )
}
