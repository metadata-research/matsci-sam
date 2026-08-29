import {
  PublicTermActivityRoute,
  activityRouteMetadata
} from "@/app/vocabulary/_activity-routes"
import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"

type DefaultActivityParams = { slug: string }

export async function generateMetadata({
  params
}: {
  params: Promise<DefaultActivityParams>
}) {
  const { slug } = await params
  return activityRouteMetadata(DEFAULT_VOCABULARY_SLUG, slug)
}

export default async function DefaultTermActivityPage({
  params
}: {
  params: Promise<DefaultActivityParams>
}) {
  const { slug } = await params
  return (
    <PublicTermActivityRoute
      vocabularySlug={DEFAULT_VOCABULARY_SLUG}
      termSlug={slug}
    />
  )
}
