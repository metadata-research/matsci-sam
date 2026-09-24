import { getSession } from "@/lib/session"
import { getAuthSiteUrl } from "@/lib/email-auth"
import {
  storeContributionFile,
  listPendingContributionFiles
} from "@/lib/contribution-files"
import { contributionFileMetadataSchema } from "@/lib/contribution-file-types"
import {
  ContributionFileError,
  readContributionUpload
} from "@/lib/contribution-file-validation"

export const runtime = "nodejs"
export async function POST(request: Request) {
  if (request.headers.get("origin") !== getAuthSiteUrl().origin)
    return Response.json({ error: "Invalid request origin." }, { status: 403 })
  const session = await getSession()
  if (!session.id)
    return Response.json({ error: "Log in to attach a file." }, { status: 401 })
  try {
    const upload = await readContributionUpload(request)
    const metadata = contributionFileMetadataSchema.safeParse(upload.metadata)
    if (!metadata.success)
      throw new ContributionFileError(
        "Give the file a title and a short explanation of how it relates to the term."
      )
    const file = await storeContributionFile({
      userId: session.id,
      metadata: metadata.data,
      bytes: upload.bytes,
      declaredType: upload.declaredType
    })
    return Response.json(file, {
      status: 201,
      headers: { "Cache-Control": "no-store" }
    })
  } catch (error) {
    if (error instanceof ContributionFileError)
      return Response.json({ error: error.message }, { status: error.status })
    console.error(
      "Contribution file upload failed",
      error instanceof Error ? error.name : "Unknown error"
    )
    return Response.json(
      { error: "The file could not be saved. Please try again." },
      { status: 500 }
    )
  }
}

export async function GET() {
  const session = await getSession()
  if (!session.id)
    return Response.json(
      { error: "Log in to see pending files." },
      { status: 401 }
    )
  return Response.json(await listPendingContributionFiles(session.id), {
    headers: { "Cache-Control": "private, no-store" }
  })
}
