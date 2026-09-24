import { z } from "zod"
import { getSession } from "@/lib/session"
import { getAuthSiteUrl } from "@/lib/email-auth"
import {
  readContributionFile,
  removePendingContributionFile
} from "@/lib/contribution-files"
import { contributionFileDownloadHeaders } from "@/lib/contribution-file-validation"

export const runtime = "nodejs"
type Context = { params: Promise<{ id: string }> }
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success)
    return new Response("Not found", { status: 404 })
  const session = await getSession()
  const file = await readContributionFile(id, session.id)
  if (!file) return new Response("Not found", { status: 404 })
  return new Response(new Uint8Array(file.bytes), {
    headers: contributionFileDownloadHeaders(
      file.filename,
      file.mediaType,
      file.byteSize
    )
  })
}
export async function DELETE(request: Request, context: Context) {
  if (request.headers.get("origin") !== getAuthSiteUrl().origin)
    return Response.json({ error: "Invalid request origin." }, { status: 403 })
  const session = await getSession()
  if (!session.id)
    return Response.json({ error: "Log in to remove a file." }, { status: 401 })
  const { id } = await context.params
  if (
    !z.string().uuid().safeParse(id).success ||
    !(await removePendingContributionFile(id, session.id))
  )
    return Response.json({ error: "Pending file not found." }, { status: 404 })
  return new Response(null, { status: 204 })
}
