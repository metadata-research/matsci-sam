import {
  completeOrcidAuthorization,
  isOrcidAuthEnabled
} from "@/lib/apis/orcid"
import {
  connectOrcidAccount,
  findOrcidAccountUserId
} from "@/lib/orcid-account"
import { isEmailAccountCreationEnabled } from "@/lib/email-auth"
import { getSession } from "@/lib/session"
import { revalidatePath } from "next/cache"
import { NextRequest, NextResponse } from "next/server"
import { authPathWithReturnTo, normalizeAuthReturnTo } from "@/lib/auth-return"

const redirectTo = (request: NextRequest, path: string) =>
  NextResponse.redirect(new URL(path, request.url))

export const GET = async (request: NextRequest) => {
  if (!isOrcidAuthEnabled()) return new Response("Not found", { status: 404 })

  const session = await getSession()
  const pending = session.orcidOAuth
  delete session.orcidOAuth
  await session.save()

  if (!pending || Date.now() - pending.startedAt > 10 * 60 * 1000)
    return new Response("The ORCID authentication request has expired.", {
      status: 400
    })

  const returnTo = normalizeAuthReturnTo(pending.returnTo)

  if (request.nextUrl.searchParams.has("error"))
    return redirectTo(
      request,
      pending.intent === "connect"
        ? "/profile?orcid=cancelled"
        : (returnTo ?? "/?orcid=cancelled")
    )

  let tokens
  try {
    tokens = await completeOrcidAuthorization(request, pending)
  } catch {
    return new Response("ORCID authentication could not be verified.", {
      status: 400
    })
  }

  if (pending.intent === "connect") {
    if (!session.id)
      return new Response("Your session expired before ORCID was connected.", {
        status: 401
      })

    try {
      await connectOrcidAccount({ userId: session.id, tokens })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "ORCID could not be connected"
      return new Response(message, { status: 409 })
    }

    revalidatePath("/profile")
    revalidatePath(`/people/${session.id}`)
    return redirectTo(request, "/profile?orcid=connected")
  }

  const userId = await findOrcidAccountUserId(tokens.orcidId)
  if (!userId) {
    if (isEmailAccountCreationEnabled())
      return redirectTo(
        request,
        authPathWithReturnTo("/register?source=orcid", returnTo)
      )
    return new Response(
      "This ORCID iD is not connected to an account. Sign in with Google first, then connect ORCID from your profile.",
      { status: 403 }
    )
  }

  await connectOrcidAccount({ userId, tokens })
  session.id = userId
  await session.save()
  return redirectTo(request, returnTo ?? "/profile")
}
