import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { db } from "@yamz/db"
import { getCurrentUser } from "@/lib/current-user"
import { getMatcoreField } from "@/lib/matcore-workflow"

export const dynamic = "force-dynamic"
const uuid = z.string().uuid()

/** A revision-pinned JSON snapshot, not a JSON Schema or validation claim. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ fieldId: string }> }
) {
  const { fieldId } = await params
  const query = new URL(request.url).searchParams
  const revisionId = query.get("revisionId") ?? undefined
  if (
    !uuid.safeParse(fieldId).success ||
    (revisionId !== undefined && !uuid.safeParse(revisionId).success) ||
    [...query.keys()].some((key) => key !== "revisionId") ||
    query.getAll("revisionId").length > 1
  )
    return new Response("Invalid metadata field address", { status: 400 })
  try {
    const user = await getCurrentUser()
    const record = await getMatcoreField(
      db,
      fieldId,
      revisionId,
      user?.id ?? null
    )
    const revision = record.revisions.find(
      (item) => item.id === record.selectedRevisionId
    )!
    const document = {
      format: "matsci-sam-field-specification",
      formatVersion: 1,
      field: record.field,
      revision,
      sourceRelease: record.sourceRelease,
      sourceOccurrence: record.sourceOccurrence,
      profileContext: record.profileContext,
      baseline: record.baseline,
      history: record.history.filter(
        (event) => event.revisionId === revision.id
      ),
      statusNote: record.profileContext
        ? "A MatSci-SAM community proposal with its local review status. This document does not represent official MatCore adoption or an executable validation schema."
        : "A MatSci-SAM community field proposal with its local review status. This document is not an executable validation schema."
    }
    return Response.json(document, {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename="metadata-field-${fieldId}-${revision.id}.json"`
      }
    })
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND")
      return new Response("Metadata field unavailable", { status: 404 })
    throw error
  }
}
