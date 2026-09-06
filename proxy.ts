import { NextRequest, NextResponse } from "next/server"
import {
  preferredRepresentation,
  vocabularyDocument
} from "./lib/vocabulary-http"
import { SITE_URL } from "./lib/site"

export function proxy(request: NextRequest) {
  if (!["GET", "HEAD"].includes(request.method)) return NextResponse.next()
  const doc = vocabularyDocument(request.nextUrl.pathname)
  if (!doc) return NextResponse.next()
  if (doc.format) {
    const url = request.nextUrl.clone()
    url.pathname = "/api/vocabulary-document"
    url.search = ""
    url.searchParams.set("resource", doc.resource)
    url.searchParams.set("format", doc.format)
    if (doc.provenance) url.searchParams.set("provenance", "true")
    return NextResponse.rewrite(url)
  }
  const representation = preferredRepresentation(request.headers.get("accept"))
  if (!representation)
    return new Response("Not acceptable", {
      status: 406,
      headers: { Vary: "Accept", "Cache-Control": "no-store" }
    })
  if (representation !== "html") {
    const response = NextResponse.redirect(
      new URL(
        `${doc.resource}/${doc.provenance ? "provenance" : "skos"}.${representation}`,
        SITE_URL
      ),
      303
    )
    response.headers.set("Cache-Control", "no-store")
    response.headers.set("Vary", "Accept")
    return response
  }
  const response = NextResponse.next()
  response.headers.append("Vary", "Accept")
  return response
}
export const config = { matcher: ["/vocabulary/:path*"] }
