import { isOrcidAuthEnabled } from "@/lib/apis/orcid"
import { getAuthSiteUrl } from "@/lib/email-auth"
import { disconnectOrcidAccount, OrcidAccountError } from "@/lib/orcid-account"
import { publicRedirect } from "@/lib/public-redirect"
import { getSession } from "@/lib/session"
import { revalidatePath } from "next/cache"
import { NextRequest } from "next/server"

export const POST = async (request: NextRequest) => {
  if (!isOrcidAuthEnabled()) return new Response("Not found", { status: 404 })
  if (request.headers.get("origin") !== getAuthSiteUrl().origin)
    return new Response("Invalid request origin.", { status: 403 })

  const session = await getSession()
  if (!session.id)
    return new Response("Authentication required.", { status: 401 })

  try {
    await disconnectOrcidAccount(session.id)
  } catch (error) {
    const message =
      error instanceof OrcidAccountError
        ? error.message
        : "ORCID could not be disconnected."
    return new Response(message, { status: 409 })
  }

  revalidatePath("/profile")
  revalidatePath(`/people/${session.id}`)
  return publicRedirect("/profile?orcid=disconnected", 303)
}
