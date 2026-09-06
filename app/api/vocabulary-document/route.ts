import { vocabularyDocumentResponse } from "@/lib/vocabulary-document-response"

export const dynamic = "force-dynamic"
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  return vocabularyDocumentResponse(
    params.get("resource") ?? "",
    params.get("format"),
    params.get("provenance") === "true"
  )
}
