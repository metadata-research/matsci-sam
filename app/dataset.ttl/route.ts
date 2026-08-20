import { matCoreBlocksTurtle } from "@/lib/matcore-export"
import { loadSchemeDocument, renderSchemeTurtle } from "@/lib/skos"

/*
 * Every entity this application publishes, as one Turtle document: the
 * vocabulary scheme, each term with its definitions and revisions, the
 * knowledge-organization layer (concept schemes, concepts, collections), and
 * the MatCore element set with its Dublin Core crosswalk.
 *
 * renderSchemeTurtle already appends the knowledge-organization blocks, so
 * /tags.ttl is a subset of what it produces and only MatCore has to be added
 * here. /vocabulary.ttl and /tags.ttl stay as they are: a consumer wanting one
 * layer should not have to filter the whole graph.
 *
 * Not included: the PROV-O history, which is served per term at
 * /terms/{id}/provenance.ttl. It is an order of magnitude larger than the
 * vocabulary and describes activities rather than the published entities.
 */
export async function GET() {
  const document = renderSchemeTurtle(await loadSchemeDocument())

  return new Response(`${document}\n${matCoreBlocksTurtle()}`, {
    headers: { "Content-Type": "text/turtle; charset=utf-8" }
  })
}
