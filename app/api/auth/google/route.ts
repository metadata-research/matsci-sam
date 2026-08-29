import { randomBytes } from "node:crypto"
import { createGoogleAuthorizationUrl } from "@/lib/apis/google"
import { getSession } from "@/lib/session"
import { NextRequest, NextResponse } from "next/server"
import { normalizeAuthReturnTo } from "@/lib/auth-return"

export const GET = async (request: NextRequest) => {
  const session = await getSession()
  const state = randomBytes(32).toString("hex")
  const returnTo = normalizeAuthReturnTo(
    request.nextUrl.searchParams.get("returnTo")
  )

  session.googleOAuthState = state
  if (returnTo) session.authReturnTo = returnTo
  else delete session.authReturnTo
  await session.save()

  return NextResponse.redirect(createGoogleAuthorizationUrl(state))
}
