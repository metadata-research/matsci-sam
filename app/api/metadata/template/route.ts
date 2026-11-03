import { db } from "@yamz/db"
import { getCurrentUser } from "@/lib/current-user"
import { standardXmlResponse } from "@/lib/standard-xml-export"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return standardXmlResponse(db, request, (await getCurrentUser())?.id ?? null)
}
