import {
  createOrcidAuthorization,
  isOrcidAuthEnabled,
  type OrcidAuthorizationIntent
} from "@/lib/apis/orcid"
import { getSession } from "@/lib/session"
import { NextRequest, NextResponse } from "next/server"

export const GET = async (request: NextRequest) => {
  if (!isOrcidAuthEnabled()) return new Response("Not found", { status: 404 })

  const intent: OrcidAuthorizationIntent =
    request.nextUrl.searchParams.get("intent") === "connect"
      ? "connect"
      : "login"
  const session = await getSession()
  if (intent === "connect" && !session.id)
    return new Response("Sign in before connecting an ORCID iD.", {
      status: 401
    })

  const authorization = await createOrcidAuthorization()
  session.orcidOAuth = {
    ...authorization.state,
    intent,
    startedAt: Date.now()
  }
  await session.save()

  return NextResponse.redirect(authorization.url)
}
