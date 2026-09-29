import {
  completeOrcidAuthorization,
  describeOrcidFailure,
  isOrcidAuthEnabled
} from "@/lib/apis/orcid"
import {
  connectOrcidAccount,
  findOrcidAccountUserId,
  OrcidAccountError
} from "@/lib/orcid-account"
import { isEmailAccountCreationEnabled } from "@/lib/email-auth"
import { publicRedirect } from "@/lib/public-redirect"
import { getSession } from "@/lib/session"
import { revalidatePath } from "next/cache"
import { NextRequest } from "next/server"
import {
  authPathWithReturnTo,
  normalizeAuthReturnTo,
  profileCompletionPath
} from "@/lib/auth-return"

// OAuth error codes are lowercase words joined by underscores. Anything else
// is not echoed back.
const OAUTH_ERROR_CODE = /^[a-z_]{1,64}$/

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
  const providerError = request.nextUrl.searchParams.get("error")

  // A person who declines at ORCID returns with access_denied. Any other
  // error is a failed request, which the cancellation notice would misreport.
  if (providerError === "access_denied")
    return publicRedirect(
      pending.intent === "connect"
        ? "/profile?orcid=cancelled"
        : authPathWithReturnTo("/login?orcid=cancelled", returnTo)
    )
  if (providerError !== null)
    return new Response(
      OAUTH_ERROR_CODE.test(providerError)
        ? `ORCID could not complete the request (${providerError}).`
        : "ORCID could not complete the request.",
      { status: 400 }
    )

  let tokens
  try {
    tokens = await completeOrcidAuthorization(request.nextUrl.search, pending)
  } catch (error) {
    console.error(`ORCID authorization failed. ${describeOrcidFailure(error)}`)
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
        error instanceof OrcidAccountError
          ? error.message
          : "ORCID could not be connected."
      return new Response(message, { status: 409 })
    }

    revalidatePath("/profile")
    revalidatePath(`/people/${session.id}`)
    return publicRedirect("/profile?orcid=connected")
  }

  const userId = await findOrcidAccountUserId(tokens.orcidId)
  if (!userId) {
    if (isEmailAccountCreationEnabled())
      return publicRedirect(
        authPathWithReturnTo("/register?source=orcid", returnTo)
      )
    return new Response(
      "This ORCID iD is not connected to an account. Sign in with Google first, then connect ORCID from your profile.",
      { status: 403 }
    )
  }

  const { needsProfile } = await connectOrcidAccount({ userId, tokens })
  session.id = userId
  await session.save()
  return publicRedirect(
    needsProfile ? profileCompletionPath(returnTo) : (returnTo ?? "/profile")
  )
}
