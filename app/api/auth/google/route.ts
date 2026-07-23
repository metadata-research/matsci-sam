import { randomBytes } from "node:crypto"
import { createGoogleAuthorizationUrl } from "@/lib/apis/google"
import { getSession } from "@/lib/session"
import { NextResponse } from "next/server"

export const GET = async () => {
  const session = await getSession()
  const state = randomBytes(32).toString("hex")

  session.googleOAuthState = state
  await session.save()

  return NextResponse.redirect(createGoogleAuthorizationUrl(state))
}
