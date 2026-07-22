import { isDevAuthEnabled } from "@/lib/dev-auth"
import { NextResponse } from "next/server"

export const GET = async (request: Request) => {
  if (isDevAuthEnabled())
    return NextResponse.redirect(new URL("/dev-login", request.url))

  const { OAuthURL } = await import("@/lib/apis/google")
  return NextResponse.redirect(OAuthURL)
}
