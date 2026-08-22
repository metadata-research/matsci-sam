import { isGraphName } from "@/lib/graph/names"
import { buildAllGraphs } from "@/lib/graph/projector"

// One named graph of the dataset as Turtle, built from the database on
// request: the same document the projector writes to the store under this
// IRI, so a consumer without SPARQL can fetch exactly one graph.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  if (!isGraphName(name)) return new Response("Not found", { status: 404 })

  const graphs = await buildAllGraphs()
  return new Response(graphs[name], {
    headers: { "Content-Type": "text/turtle; charset=utf-8" }
  })
}
