import { buildTermSkos, termTurtle } from "@/lib/skos"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ termId: string }> }
) {
  const { termId } = await params
  const skos = await buildTermSkos(Number(termId))
  if (!skos) return new Response("Not found", { status: 404 })

  return new Response(termTurtle(skos), {
    headers: { "Content-Type": "text/turtle; charset=utf-8" }
  })
}
