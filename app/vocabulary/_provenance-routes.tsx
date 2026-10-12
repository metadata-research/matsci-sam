import { findVocabularyTermRoute } from "@/app/vocabulary/_data"
import { TermProvenancePage } from "@/components/provenance/page"
import { termPath } from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"
import type { Metadata } from "next"
import { notFound, permanentRedirect } from "next/navigation"

const resolveProvenanceTerm = async (
  vocabularySlug: string,
  termSlug: string
) => {
  const route = await findVocabularyTermRoute(vocabularySlug, termSlug)
  if (!route) notFound()
  return route
}

export async function provenanceRouteMetadata(
  vocabularySlug: string,
  termSlug: string
): Promise<Metadata> {
  const { term } = await resolveProvenanceTerm(vocabularySlug, termSlug)
  return {
    title: `Provenance: ${term.term} | ${SITE_NAME}`,
    robots: term.hiddenAt ? { index: false, follow: false } : undefined,
    alternates: {
      canonical: termPath(term.slug, term.vocabularySlug) + "/provenance"
    }
  }
}

export async function PublicTermProvenanceRoute({
  vocabularySlug,
  termSlug
}: {
  vocabularySlug: string
  termSlug: string
}) {
  const route = await resolveProvenanceTerm(vocabularySlug, termSlug)
  if (route.isAlias)
    permanentRedirect(
      termPath(route.term.slug, route.term.vocabularySlug) + "/provenance"
    )
  return (
    <TermProvenancePage
      termId={route.term.id}
      hiddenAt={route.term.hiddenAt}
      hiddenReason={route.term.hiddenReason}
    />
  )
}
