import { isDevAuthEnabled } from "@/lib/dev-auth"
import { NextResponse } from "next/server"

export const GET = async () => {
  if (isDevAuthEnabled())
    return new Response(null, {
      status: 307,
      headers: { Location: "/dev-login" }
    })

  const { OAuthURL } = await import("@/lib/apis/google")
  return NextResponse.redirect(OAuthURL)
}
