import { buildTermSkos, termJsonLd } from "@/lib/skos"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ termId: string }> }
) {
  const { termId } = await params
  const skos = await buildTermSkos(Number(termId))
  if (!skos) return new Response("Not found", { status: 404 })

  return Response.json(termJsonLd(skos), {
    headers: { "Content-Type": "application/ld+json; charset=utf-8" }
  })
}
