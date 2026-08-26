import {
  DEFAULT_VOCABULARY_SLUG,
  termPath,
  termUri,
  vocabularyUri
} from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"
import type { Metadata } from "next"
import { notFound, permanentRedirect } from "next/navigation"
import { findNondefaultVocabulary, findVocabularyTermRoute } from "../_data"
import { VocabularySchemePage, VocabularyTermPage } from "../_pages"

type HybridVocabularyParams = { slug: string }

const resolveHybridRoute = async (slug: string) => {
  const [vocabulary, termRoute] = await Promise.all([
    findNondefaultVocabulary(slug),
    findVocabularyTermRoute(DEFAULT_VOCABULARY_SLUG, slug)
  ])
  return { vocabulary, termRoute }
}

export async function generateMetadata({
  params
}: {
  params: Promise<HybridVocabularyParams>
}): Promise<Metadata> {
  const { slug } = await params
  const { vocabulary, termRoute } = await resolveHybridRoute(slug)

  if (vocabulary)
    return {
      title: vocabulary.title + " vocabulary | " + SITE_NAME,
      description:
        vocabulary.description ??
        "Terms defined in the " + vocabulary.title + " vocabulary.",
      alternates: { canonical: vocabularyUri(vocabulary.slug) }
    }

  if (termRoute)
    return {
      title: termRoute.term.term + " | " + SITE_NAME,
      alternates: {
        canonical: termUri(termRoute.term.slug, termRoute.term.vocabularySlug)
      }
    }

  return { title: SITE_NAME }
}

export default async function HybridVocabularyPage({
  params
}: {
  params: Promise<HybridVocabularyParams>
}) {
  const { slug } = await params
  const { vocabulary, termRoute } = await resolveHybridRoute(slug)

  // Non-default vocabulary slugs are reserved from the default term namespace,
  // so this precedence is deterministic while retaining every legacy term URL.
  if (vocabulary) return <VocabularySchemePage vocabulary={vocabulary} />
  if (termRoute?.isAlias)
    permanentRedirect(
      termPath(termRoute.term.slug, termRoute.term.vocabularySlug)
    )
  if (termRoute) return <VocabularyTermPage term={termRoute.term} />
  notFound()
}
