import { buildAllGraphs } from "@/lib/graph/projector"

// The dataset at its own IRI: the VoID and SPARQL service description that
// is the meta graph, with the counts of the graphs as built right now.
// /dataset.ttl, the older single-document dump, stays as it is.
export async function GET() {
  const graphs = await buildAllGraphs()
  return new Response(graphs.meta, {
    headers: { "Content-Type": "text/turtle; charset=utf-8" }
  })
}
