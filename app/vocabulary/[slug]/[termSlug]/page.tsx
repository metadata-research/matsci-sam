import {
  findNondefaultVocabulary,
  findVocabularyTermRoute
} from "@/app/vocabulary/_data"
import { VocabularyTermPage } from "@/app/vocabulary/_pages"
import { termPath, termUri } from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"
import type { Metadata } from "next"
import { notFound, permanentRedirect } from "next/navigation"

type NamespacedTermParams = {
  slug: string
  termSlug: string
}

const resolveNamespacedTerm = async (
  vocabularySlug: string,
  termSlug: string
) => {
  const [vocabulary, term] = await Promise.all([
    findNondefaultVocabulary(vocabularySlug),
    findVocabularyTermRoute(vocabularySlug, termSlug)
  ])
  if (!vocabulary || !term) notFound()
  return term
}

export async function generateMetadata({
  params
}: {
  params: Promise<NamespacedTermParams>
}): Promise<Metadata> {
  const { slug, termSlug } = await params
  const { term } = await resolveNamespacedTerm(slug, termSlug)

  return {
    title: term.term + ": " + term.vocabularyTitle + " | " + SITE_NAME,
    alternates: {
      canonical: termUri(term.slug, term.vocabularySlug)
    }
  }
}

export default async function NamespacedTermPage({
  params
}: {
  params: Promise<NamespacedTermParams>
}) {
  const { slug, termSlug } = await params
  const route = await resolveNamespacedTerm(slug, termSlug)
  if (route.isAlias)
    permanentRedirect(termPath(route.term.slug, route.term.vocabularySlug))
  const { term } = route
  return <VocabularyTermPage term={term} />
}
