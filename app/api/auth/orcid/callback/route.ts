import {
  completeOrcidAuthorization,
  describeOrcidFailure,
  isOrcidAuthEnabled,
  isOrcidAccountCreationEnabled
} from "@/lib/apis/orcid"
import {
  connectOrcidAccount,
  findOrcidAccountUserId,
  registerOrcidAccount,
  OrcidAccountError
} from "@/lib/orcid-account"
import { isAccountCreationEnabled } from "@/lib/account-creation"
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
        : authPathWithReturnTo(
            pending.intent === "signup"
              ? "/register?orcid=cancelled"
              : "/login?orcid=cancelled",
            returnTo
          )
    )
  if (providerError !== null)
    return new Response(
      OAUTH_ERROR_CODE.test(providerError)
        ? `ORCID could not complete the request (${providerError}).`
        : "ORCID could not complete the request.",
      { status: 400 }
    )

  const connectingUserId = pending.intent === "connect" ? session.id : undefined
  if (pending.intent === "signup") {
    if (!isOrcidAccountCreationEnabled())
      return new Response("ORCID account creation is not enabled.", {
        status: 403
      })
    // Signup starts signed out. Another tab signing in must not attach this
    // identity to, or replace, that account during the OAuth round trip.
    if (session.id)
      return new Response(
        "Your account changed. Continue with the account you signed in to, or sign out and start again.",
        { status: 409 }
      )
  }
  if (pending.intent === "connect") {
    if (!connectingUserId)
      return new Response("Your session expired before ORCID was connected.", {
        status: 401
      })
    if (pending.initiatingUserId !== connectingUserId)
      return new Response(
        "Your account changed or this connection request is no longer valid. Start connecting ORCID again from your profile.",
        { status: 409 }
      )
  }

  let tokens
  try {
    tokens = await completeOrcidAuthorization(request.nextUrl.search, pending)
  } catch (error) {
    console.error(`ORCID authorization failed. ${describeOrcidFailure(error)}`)
    return new Response("ORCID authentication could not be verified.", {
      status: 400
    })
  }

  if (connectingUserId !== undefined) {
    try {
      await connectOrcidAccount({ userId: connectingUserId, tokens })
    } catch (error) {
      const message =
        error instanceof OrcidAccountError
          ? error.message
          : "ORCID could not be connected."
      return new Response(message, { status: 409 })
    }

    revalidatePath("/profile")
    revalidatePath(`/people/${connectingUserId}`)
    return publicRedirect("/profile?orcid=connected")
  }

  if (pending.intent === "signup") {
    let account
    try {
      account = await registerOrcidAccount({ tokens })
    } catch (error) {
      return new Response(
        error instanceof OrcidAccountError
          ? error.message
          : "Your ORCID account could not be created. Please try again.",
        { status: 409 }
      )
    }
    session.id = account.userId
    await session.save()
    return publicRedirect(
      account.isNewAccount
        ? profileCompletionPath(returnTo)
        : (returnTo ?? "/profile")
    )
  }

  const userId = await findOrcidAccountUserId(tokens.orcidId)
  if (!userId) {
    if (isAccountCreationEnabled())
      return publicRedirect(
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
  return publicRedirect(returnTo ?? "/profile")
}
