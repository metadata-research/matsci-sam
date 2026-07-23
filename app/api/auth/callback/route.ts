import { timingSafeEqual } from "node:crypto"
import { db, usersTable } from "@yamz/db"
import {
  createGoogleOAuthClient,
  getGoogleAuthAccessMode,
  getGoogleAuthAllowedEmails,
  getGoogleClientId
} from "@/lib/apis/google"
import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { NextRequest } from "next/server"
import { eq, sql } from "drizzle-orm"

const stateMatches = (submitted: string, expected: string) => {
  const submittedBuffer = Buffer.from(submitted)
  const expectedBuffer = Buffer.from(expected)
  return (
    submittedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(submittedBuffer, expectedBuffer)
  )
}

export const GET = async (req: NextRequest) => {
  const session = await getSession()
  const submittedState = req.nextUrl.searchParams.get("state")
  const expectedState = session.googleOAuthState

  delete session.googleOAuthState
  await session.save()

  if (
    !submittedState ||
    !expectedState ||
    !stateMatches(submittedState, expectedState)
  )
    return new Response("Invalid Google authentication state.", { status: 400 })

  if (req.nextUrl.searchParams.has("error"))
    return new Response("Google sign-in was not completed.", { status: 400 })

  const code = req.nextUrl.searchParams.get("code")
  if (!code)
    return new Response("Google did not return an authorization code.", {
      status: 400
    })

  const oauth = createGoogleOAuthClient()
  const token = await oauth.getToken(code)
  const idToken = token.tokens.id_token
  if (!idToken)
    return new Response("Google did not return an identity token.", {
      status: 400
    })

  const ticket = await oauth.verifyIdToken({
    idToken,
    audience: getGoogleClientId()
  })
  const userInfo = ticket.getPayload()
  if (!userInfo)
    return new Response("Google identity verification failed.", { status: 403 })

  const {
    sub: userId,
    name,
    email,
    given_name: givenName,
    family_name: familyName,
    email_verified: emailVerified
  } = userInfo
  if (!userId || !email || !emailVerified)
    return new Response("Google did not return a verified email address.", {
      status: 403
    })

  const normalizedEmail = email.trim().toLowerCase()
  let user = await db.query.usersTable.findFirst({
    where: eq(usersTable.googleId, userId)
  })

  // A development identity is created with the same email but without a
  // Google ID. Attach OAuth to that row so its existing authorship survives
  // the transition to production authentication.
  if (!user) {
    user = await db.query.usersTable.findFirst({
      where: sql`lower(${usersTable.email}) = ${normalizedEmail}`
    })
  }

  const isNewUserAllowed =
    getGoogleAuthAccessMode() === "open" ||
    getGoogleAuthAllowedEmails().has(normalizedEmail)
  if (!user && !isNewUserAllowed)
    return new Response("This Google account is not authorized.", {
      status: 403
    })

  if (user?.googleId && user.googleId !== userId)
    throw new Error(
      "That email is already associated with another Google account"
    )

  if (user) {
    const [updated] = await db
      .update(usersTable)
      .set({
        googleId: userId,
        name: name || user.name,
        email: normalizedEmail,
        firstName: user.firstName || givenName || null,
        lastName: user.lastName || familyName || null
      })
      .where(eq(usersTable.id, user.id))
      .returning()
    user = updated
  } else {
    const [inserted] = await db
      .insert(usersTable)
      .values({
        googleId: userId,
        name: name || "",
        email: normalizedEmail,
        firstName: givenName || null,
        lastName: familyName || null
      })
      .returning()
    user = inserted
  }

  session.id = user!.id
  await session.save()

  redirect("/profile")
}
