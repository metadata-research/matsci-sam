import { schemeTurtle } from "@/lib/skos"

// The whole dictionary as one skos:ConceptScheme document.
export async function GET() {
  return new Response(await schemeTurtle(), {
    headers: { "Content-Type": "text/turtle; charset=utf-8" }
  })
}
