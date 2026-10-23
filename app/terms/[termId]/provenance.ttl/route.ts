import { currentContentViewer } from "@/lib/content-access"
import { buildTermProvenance } from "@/lib/provenance"
import { provenanceTurtle } from "@/lib/provenance-rdf"

// Public serialization. Matches the public provenance page (voter
// identities are event-level and votes do not appear in the graph).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ termId: string }> }
) {
  const viewerId = await currentContentViewer()
  const { termId } = await params
  const prov = await buildTermProvenance(Number(termId), {
    anonymizeVoters: true,
    viewerId
  })
  if (!prov) return new Response("Not found", { status: 404 })

  return new Response(provenanceTurtle(prov), {
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "Content-Type": "text/turtle; charset=utf-8"
    }
  })
}
