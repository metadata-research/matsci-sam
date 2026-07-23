import { isDevAuthEnabled } from "@/lib/dev-auth"

export const GET = async () => {
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
