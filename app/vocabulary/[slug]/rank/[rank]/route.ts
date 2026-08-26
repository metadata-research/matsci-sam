import { redirectDefinitionAtRank } from "@/app/vocabulary/_route-handlers"
import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; rank: string }> }
) {
  const { slug, rank } = await params
  return redirectDefinitionAtRank(request, DEFAULT_VOCABULARY_SLUG, slug, rank)
}
