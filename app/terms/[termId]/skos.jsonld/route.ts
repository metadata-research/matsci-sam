import { buildTermSkos, loadKos, termJsonLd } from "@/lib/skos"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ termId: string }> }
) {
  const { termId } = await params
  const kos = await loadKos()
  const skos = await buildTermSkos(Number(termId), kos)
  if (!skos) return new Response("Not found", { status: 404 })

  return Response.json(termJsonLd(skos, kos), {
    headers: { "Content-Type": "application/ld+json; charset=utf-8" }
  })
}
