import { vocabularyDocumentResponse } from "@/lib/vocabulary-document-response"

export const dynamic = "force-dynamic"
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ document: string[] }> }
) {
  // Read the matched route parameters: Request.url retains the incoming URL
  // for a next.config rewrite, including any caller-supplied query parameters.
  const [kind, format, ...resource] = (await params).document
  if (!["skos", "provenance"].includes(kind))
    return new Response("Not found", { status: 404 })
  return vocabularyDocumentResponse(
    "/" + resource.join("/"), format, kind === "provenance"
  )
}
