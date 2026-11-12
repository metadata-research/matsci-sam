import {
  createOrcidAuthorization,
  isOrcidAuthEnabled,
  isOrcidAccountCreationEnabled,
  type OrcidAuthorizationIntent
} from "@/lib/apis/orcid"
import { getSession } from "@/lib/session"
import { NextRequest, NextResponse } from "next/server"
import { normalizeAuthReturnTo } from "@/lib/auth-return"
import { publicRedirect } from "@/lib/public-redirect"

export const GET = async (request: NextRequest) => {
  if (!isOrcidAuthEnabled()) return new Response("Not found", { status: 404 })

  const requestedIntent = request.nextUrl.searchParams.get("intent")
  const intent: OrcidAuthorizationIntent =
    requestedIntent === "connect" || requestedIntent === "signup"
      ? requestedIntent
      : "login"
  const session = await getSession()
  const returnTo = normalizeAuthReturnTo(
    request.nextUrl.searchParams.get("returnTo")
  )
  if (intent === "signup") {
    if (!isOrcidAccountCreationEnabled())
      return new Response("ORCID account creation is not enabled.", {
        status: 403
      })
    if (session.id) return publicRedirect(returnTo ?? "/profile")
  }
  if (intent === "connect" && !session.id)
    return new Response("Sign in before connecting an ORCID iD.", {
      status: 401
    })

  const authorization = await createOrcidAuthorization()
  session.orcidOAuth = {
    ...authorization.state,
    intent,
    ...(intent === "connect" ? { initiatingUserId: session.id } : {}),
    startedAt: Date.now(),
    ...(returnTo ? { returnTo } : {})
  }
  await session.save()

  return NextResponse.redirect(authorization.url)
}
