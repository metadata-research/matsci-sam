import { db, termsTable } from "@yamz/db"
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"

/*
 * The base of the hash nodes of the provenance record of a term: a person
 * who acted on the term is <this>#user_<id>, and a model named by the string
 * it ran under is <this>#model_<string>. The document that describes those
 * nodes is the PROV-O Turtle at /terms/<id>/provenance.ttl, so the base
 * redirects there and a consumer following an agent IRI gets it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const term = await db.query.termsTable.findFirst({
    where: eq(termsTable.slug, slug),
    columns: { id: true }
  })
  if (!term) return new Response("Not found", { status: 404 })

  return NextResponse.redirect(
    new URL(`/terms/${term.id}/provenance.ttl`, request.url),
    308
  )
}
