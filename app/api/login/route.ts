import { isDevAuthEnabled } from "@/lib/dev-auth"
import { isEmailAuthEnabled } from "@/lib/email-auth"
import { isOrcidAuthEnabled } from "@/lib/apis/orcid"

export const GET = async () => {
  if (isEmailAuthEnabled() || isOrcidAuthEnabled())
    return new Response(null, {
      status: 307,
      headers: { Location: "/login" }
    })

  if (isDevAuthEnabled())
    return new Response(null, {
      status: 307,
      headers: { Location: "/dev-login" }
    })

  return new Response(null, {
    status: 307,
    headers: { Location: "/api/auth/google" }
  })
}
