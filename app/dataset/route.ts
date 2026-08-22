import { buildAllGraphs, lastProjectedGraphs } from "@/lib/graph/projector"

// The dataset at its own IRI: the VoID and SPARQL service description that
// is the meta graph. With a projection in this process it is the document
// the store holds, with the time and counts of that projection; without one
// (a deployment with no store) it is built from the database on request and
// dated by that build. /dataset.ttl, the older single-document dump, stays
// as it is.
export async function GET() {
  const meta = lastProjectedGraphs()?.meta ?? (await buildAllGraphs()).meta
  return new Response(meta, {
    headers: { "Content-Type": "text/turtle; charset=utf-8" }
  })
}
