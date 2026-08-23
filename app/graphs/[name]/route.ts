import { buildContentGraph } from "@/lib/graph/documents"
import { isGraphName } from "@/lib/graph/names"
import { buildAllGraphs, lastProjectedGraphs } from "@/lib/graph/projector"

// One named graph of the dataset as Turtle, so a consumer without SPARQL can
// fetch exactly one graph. With a projection in this process it is the
// document the projector wrote to the store under this IRI; without one it
// is built from the database on request, and only that graph is built,
// except for the meta graph, which counts the other four.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  if (!isGraphName(name)) return new Response("Not found", { status: 404 })

  const projected = lastProjectedGraphs()
  const turtle = projected
    ? projected[name]
    : name === "meta"
      ? (await buildAllGraphs()).meta
      : await buildContentGraph(name)
  return new Response(turtle, {
    headers: { "Content-Type": "text/turtle; charset=utf-8" }
  })
}
