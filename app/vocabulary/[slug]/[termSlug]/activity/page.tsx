import {
  PublicTermActivityRoute,
  activityRouteMetadata
} from "@/app/vocabulary/_activity-routes"
import { findNondefaultVocabulary } from "@/app/vocabulary/_data"
import { notFound } from "next/navigation"

type NamespacedActivityParams = { slug: string; termSlug: string }

const requireVocabulary = async (slug: string) => {
  if (!(await findNondefaultVocabulary(slug))) notFound()
}

export async function generateMetadata({
  params
}: {
  params: Promise<NamespacedActivityParams>
}) {
  const { slug, termSlug } = await params
  await requireVocabulary(slug)
  return activityRouteMetadata(slug, termSlug)
}

export default async function NamespacedTermActivityPage({
  params
}: {
  params: Promise<NamespacedActivityParams>
}) {
  const { slug, termSlug } = await params
  await requireVocabulary(slug)
  return <PublicTermActivityRoute vocabularySlug={slug} termSlug={termSlug} />
}
