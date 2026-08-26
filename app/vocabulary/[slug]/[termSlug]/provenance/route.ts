import { findNondefaultVocabulary } from "@/app/vocabulary/_data"
import { redirectTermProvenance } from "@/app/vocabulary/_route-handlers"

export async function GET(
  request: Request,
  {
    params
  }: {
    params: Promise<{ slug: string; termSlug: string }>
  }
) {
  const { slug, termSlug } = await params
  if (!(await findNondefaultVocabulary(slug)))
    return new Response("Not found", { status: 404 })
  return redirectTermProvenance(request, slug, termSlug)
}
