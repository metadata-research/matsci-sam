import {
  PublicDefinitionRoute,
  definitionRouteMetadata
} from "@/app/vocabulary/_definition-routes"
import { findNondefaultVocabulary } from "@/app/vocabulary/_data"
import { notFound } from "next/navigation"

type NamespacedDefinitionParams = {
  slug: string
  termSlug: string
  definitionNumber: string
}

const requireVocabulary = async (slug: string) => {
  if (!(await findNondefaultVocabulary(slug))) notFound()
}

export async function generateMetadata({
  params
}: {
  params: Promise<NamespacedDefinitionParams>
}) {
  const { slug, termSlug, definitionNumber } = await params
  await requireVocabulary(slug)
  return definitionRouteMetadata(slug, termSlug, definitionNumber)
}

export default async function NamespacedDefinitionPage({
  params
}: {
  params: Promise<NamespacedDefinitionParams>
}) {
  const { slug, termSlug, definitionNumber } = await params
  await requireVocabulary(slug)
  return (
    <PublicDefinitionRoute
      vocabularySlug={slug}
      termSlug={termSlug}
      definitionNumber={definitionNumber}
    />
  )
}
