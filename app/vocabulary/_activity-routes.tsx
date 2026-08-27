import { findVocabularyTermRoute } from "@/app/vocabulary/_data"
import { TermActivityPage } from "@/components/activity/term-activity-page"
import { loadTermActivity } from "@/lib/term-activity"
import { termActivityPath } from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"
import type { Metadata } from "next"
import { notFound, permanentRedirect } from "next/navigation"

const resolveActivityTerm = async (
  vocabularySlug: string,
  termSlug: string
) => {
  const route = await findVocabularyTermRoute(vocabularySlug, termSlug)
  if (!route) notFound()
  return route
}

export async function activityRouteMetadata(
  vocabularySlug: string,
  termSlug: string
): Promise<Metadata> {
  const { term } = await resolveActivityTerm(vocabularySlug, termSlug)
  return {
    title: `Changes & activity: ${term.term} | ${SITE_NAME}`,
    alternates: {
      canonical: termActivityPath(term.slug, term.vocabularySlug)
    }
  }
}

export async function PublicTermActivityRoute({
  vocabularySlug,
  termSlug
}: {
  vocabularySlug: string
  termSlug: string
}) {
  const route = await resolveActivityTerm(vocabularySlug, termSlug)
  if (route.isAlias)
    permanentRedirect(
      termActivityPath(route.term.slug, route.term.vocabularySlug)
    )

  const activity = await loadTermActivity(route.term.id)
  if (!activity) notFound()
  return <TermActivityPage activity={activity} />
}
