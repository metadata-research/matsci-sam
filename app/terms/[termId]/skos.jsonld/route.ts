import { currentContentViewer } from "@/lib/content-access"
import { buildTermSkos, loadKos, termJsonLd } from "@/lib/skos"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ termId: string }> }
) {
  const viewerId = await currentContentViewer()
  const { termId } = await params
  const kos = await loadKos({ includeHidden: true, viewerId })
  const skos = await buildTermSkos(Number(termId), kos, { viewerId })
  if (!skos) return new Response("Not found", { status: 404 })

  return Response.json(termJsonLd(skos, kos), {
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "Content-Type": "application/ld+json; charset=utf-8"
    }
  })
}
