import { buildContentGraph } from "@/lib/graph/documents"
import { isGraphName } from "@/lib/graph/names"
import { buildAllGraphs } from "@/lib/graph/projector"

// One named graph of the current public dataset as Turtle. Build from live
// access-filtered SQL so a previously public community cannot remain in a
// cached response. The meta graph counts all four content graphs.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params
  if (!isGraphName(name)) return new Response("Not found", { status: 404 })

  // Never serve a projection cached before a community privacy change.
  const turtle =
    name === "meta"
      ? (await buildAllGraphs()).meta
      : await buildContentGraph(name)
  return new Response(turtle, {
    headers: {
      "Content-Type": "text/turtle; charset=utf-8",
      "Cache-Control": "no-store"
    }
  })
}
