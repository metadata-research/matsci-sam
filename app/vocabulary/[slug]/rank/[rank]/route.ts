import {
  findDefinitionAtRank,
  parsePositivePublicNumber
} from "@/lib/public-definition-resolution"
import { definitionPath } from "@/lib/public-identifiers"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; rank: string }> }
) {
  const { slug, rank: rankParam } = await params
  const rank = parsePositivePublicNumber(rankParam)
  if (!rank) return new Response("Not found", { status: 404 })

  const definition = await findDefinitionAtRank(slug, rank)
  if (!definition) return new Response("Not found", { status: 404 })

  // A rank is a live query result, not a persistent identity. Use a temporary
  // redirect so clients re-evaluate the ranking on every request.
  const response = NextResponse.redirect(
    new URL(
      definitionPath(definition.termSlug, definition.definitionNumber),
      request.url
    ),
    307
  )
  response.headers.set("Cache-Control", "no-store")
  return response
}
