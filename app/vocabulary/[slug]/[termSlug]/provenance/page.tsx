import {
  provenanceRouteMetadata,
  PublicTermProvenanceRoute
} from "@/app/vocabulary/_provenance-routes"
import type { Metadata } from "next"

type TermParams = { slug: string; termSlug: string }

export async function generateMetadata({
  params
}: {
  params: Promise<TermParams>
}): Promise<Metadata> {
  const { slug, termSlug } = await params
  return provenanceRouteMetadata(slug, termSlug)
}

export default async function ProvenancePage({
  params
}: {
  params: Promise<TermParams>
}) {
  const { slug, termSlug } = await params
  return <PublicTermProvenanceRoute vocabularySlug={slug} termSlug={termSlug} />
}
