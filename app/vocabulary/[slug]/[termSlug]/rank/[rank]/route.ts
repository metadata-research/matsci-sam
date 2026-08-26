import { findNondefaultVocabulary } from "@/app/vocabulary/_data"
import { redirectDefinitionAtRank } from "@/app/vocabulary/_route-handlers"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  {
    params
  }: {
    params: Promise<{ slug: string; termSlug: string; rank: string }>
  }
) {
  const { slug, termSlug, rank } = await params
  if (!(await findNondefaultVocabulary(slug)))
    return new Response("Not found", { status: 404 })
  return redirectDefinitionAtRank(request, slug, termSlug, rank)
}
