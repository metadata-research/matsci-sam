import { buildAllGraphs } from "@/lib/graph/projector"

// The dataset's VoID and SPARQL service description, rebuilt from the current
// public content. The build time and counts describe this response rather than
// a potentially older external-store projection.
export async function GET() {
  const meta = (await buildAllGraphs()).meta
  return new Response(meta, {
    headers: {
      "Content-Type": "text/turtle; charset=utf-8",
      "Cache-Control": "no-store"
    }
  })
}
