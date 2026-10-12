import {
  provenanceRouteMetadata,
  PublicTermProvenanceRoute
} from "@/app/vocabulary/_provenance-routes"
import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"
import type { Metadata } from "next"

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  return provenanceRouteMetadata(DEFAULT_VOCABULARY_SLUG, slug)
}

export default async function ProvenancePage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return (
    <PublicTermProvenanceRoute
      vocabularySlug={DEFAULT_VOCABULARY_SLUG}
      termSlug={slug}
    />
  )
}
