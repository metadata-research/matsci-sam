import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { getSession } from "@/lib/session"
import { getAuthSiteUrl } from "@/lib/email-auth"
import {
  inspectSourceDocument,
  checkOwnedSource,
  retrySourceOcr
} from "@/lib/source-documents"
import { readBoundedContributionBody } from "@/lib/contribution-file-validation"
import { correctOwnedSource } from "@/lib/source-document-corrections"
export const runtime = "nodejs"
type Context = { params: Promise<{ id: string }> }
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("check"),
    extractionId: z.string().uuid(),
    aliases: z.array(z.string().trim().min(1).max(200)).max(20).default([])
  }),
  z.object({ action: z.literal("ocr") }),
  z.object({
    action: z.literal("correct"),
    extractionId: z.string().uuid(),
    text: z.string().min(1).max(200000)
  })
])
function failure(error: unknown) {
  const status =
    error instanceof TRPCError ? (error.code === "NOT_FOUND" ? 404 : 400) : 500
  return Response.json(
    {
      error:
        error instanceof TRPCError
          ? error.message
          : "The source could not be read. Please try again."
    },
    {
      status,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" }
    }
  )
}
export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success)
    return new Response("Not found", { status: 404 })
  const checkId = new URL(request.url).searchParams.get("checkId") ?? undefined
  if (checkId && !z.string().uuid().safeParse(checkId).success)
    return new Response("Not found", { status: 404 })
  try {
    return Response.json(
      await inspectSourceDocument(id, (await getSession()).id, checkId),
      { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } }
    )
  } catch (error) {
    return failure(error)
  }
}
export async function POST(request: Request, context: Context) {
  if (request.headers.get("origin") !== getAuthSiteUrl().origin)
    return Response.json({ error: "Invalid request origin." }, { status: 403 })
  const session = await getSession()
  if (!session.id)
    return Response.json(
      { error: "Log in to process a source." },
      { status: 401 }
    )
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success)
    return new Response("Not found", { status: 404 })
  let input: z.infer<typeof bodySchema>
  try {
    input = bodySchema.parse(
      JSON.parse(
        (await readBoundedContributionBody(request, 1300000)).toString("utf8")
      )
    )
  } catch {
    return Response.json(
      { error: "Check the source details and try again." },
      { status: 400 }
    )
  }
  try {
    const result =
      input.action === "correct"
        ? await correctOwnedSource({
            fileId: id,
            userId: session.id,
            extractionId: input.extractionId,
            text: input.text
          })
        : input.action === "ocr"
          ? await retrySourceOcr(id, session.id)
          : await checkOwnedSource({
              fileId: id,
              extractionId: input.extractionId,
              userId: session.id,
              aliases: input.aliases
            })
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" }
    })
  } catch (error) {
    return failure(error)
  }
}
