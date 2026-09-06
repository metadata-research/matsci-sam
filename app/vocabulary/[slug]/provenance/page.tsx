import { TermProvenancePage } from "@/components/provenance/page"
import { findVocabularyTermRoute } from "@/app/vocabulary/_data"
import { termPath, DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"
import { notFound, permanentRedirect } from "next/navigation"
export default async function ProvenancePage({
  params
}: {
  params: Promise<{ slug: string; termSlug?: string }>
}) {
  const { slug, termSlug } = await params
  const route = await findVocabularyTermRoute(
    termSlug ? slug : DEFAULT_VOCABULARY_SLUG,
    termSlug ?? slug
  )
  if (!route) notFound()
  if (route.isAlias)
    permanentRedirect(
      termPath(route.term.slug, route.term.vocabularySlug) + "/provenance"
    )
  return <TermProvenancePage termId={route.term.id} />
}
