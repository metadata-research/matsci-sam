import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { db } from "@yamz/db"
import { getSession } from "@/lib/session"
import { getAuthSiteUrl } from "@/lib/email-auth"
import { assignImportSource } from "@/lib/import-drafts"
import { readBoundedContributionBody } from "@/lib/contribution-file-validation"

export const runtime = "nodejs"
const inputSchema = z
  .object({
    sourceKey: z.string().trim().min(1).max(100).optional(),
    targets: z
      .array(
        z
          .object({
            draftId: z.string().uuid(),
            expectedVersion: z.number().int().positive(),
            mutationId: z.string().uuid()
          })
          .strict()
      )
      .min(1)
      .max(50)
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.targets.map((target) => target.draftId)).size ===
      input.targets.length,
    "Select each draft once."
  )

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (request.headers.get("origin") !== getAuthSiteUrl().origin)
    return Response.json({ error: "Invalid request origin." }, { status: 403 })
  const session = await getSession()
  if (!session.id)
    return Response.json(
      { error: "Log in to assign sources." },
      { status: 401 }
    )
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success)
    return Response.json({ error: "Source not found." }, { status: 404 })
  let input: z.infer<typeof inputSchema>
  try {
    input = inputSchema.parse(
      JSON.parse(
        (await readBoundedContributionBody(request, 20000)).toString("utf8")
      )
    )
  } catch {
    return Response.json(
      { error: "Check the selected drafts and try again." },
      { status: 400 }
    )
  }
  try {
    const result = await db.transaction((tx) =>
      assignImportSource(tx, { ...input, sourceFileId: id }, session.id!)
    )
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" }
    })
  } catch (error) {
    const statuses: Partial<Record<TRPCError["code"], number>> = {
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      UNAUTHORIZED: 401,
      CONFLICT: 409,
      TOO_MANY_REQUESTS: 429
    }
    const status =
      error instanceof TRPCError ? (statuses[error.code] ?? 400) : 500
    return Response.json(
      {
        error:
          error instanceof TRPCError
            ? error.message
            : "The sources could not be assigned. Please try again."
      },
      { status, headers: { "Cache-Control": "private, no-store" } }
    )
  }
}
