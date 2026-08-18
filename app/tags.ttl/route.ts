import { kosTurtle } from "@/lib/kos-export"
import { loadKos } from "@/lib/skos"

// The whole knowledge-organization layer as one document: concept schemes,
// concepts with their hierarchy and external mappings, and collections.
export async function GET() {
  return new Response(kosTurtle(await loadKos()), {
    headers: { "Content-Type": "text/turtle; charset=utf-8" }
  })
}
