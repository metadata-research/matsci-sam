import { redirectTermProvenance } from "@/app/vocabulary/_route-handlers"
import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"

/*
 * The base of the hash nodes of the provenance record of a term. It redirects
 * to the public PROV-O document while retaining the legacy concept IRI.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  return redirectTermProvenance(request, DEFAULT_VOCABULARY_SLUG, slug)
}
