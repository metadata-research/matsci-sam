import { db, emailAuthTokensTable, usersTable } from "@yamz/db"
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm"
import {
  getAuthSiteUrl,
  hashEmailAuthToken,
  isEmailAuthEnabled
} from "@/lib/email-auth"
import { getSession } from "@/lib/session"
import { normalizeAuthReturnTo, profileCompletionPath } from "@/lib/auth-return"
import {
  createEmailAuthConfirmation,
  matchesEmailAuthConfirmation
} from "@/lib/email-auth-confirmation"

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export const POST = async (request: Request) => {
  if (!isEmailAuthEnabled()) return new Response("Not found", { status: 404 })

  if (request.headers.get("origin") !== getAuthSiteUrl().origin)
    return new Response("Invalid request origin.", { status: 403 })
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    return new Response("Expected a JSON request.", { status: 415 })

  let token = ""
  let returnTo: string | null = null
  let action: unknown
  let challenge: unknown
  try {
    const body = (await request.json()) as {
      token?: unknown
      returnTo?: unknown
      action?: unknown
      challenge?: unknown
    }
    token = typeof body.token === "string" ? body.token : ""
    returnTo = normalizeAuthReturnTo(body.returnTo)
    action = body.action
    challenge = body.challenge
  } catch {
    // The response below intentionally treats malformed and invalid tokens the
    // same way.
  }

  if (
    !TOKEN_PATTERN.test(token) ||
    (action !== "prepare" && action !== "confirm")
  )
    return Response.json(
      { error: "This sign-in link is invalid." },
      {
        status: 400
      }
    )

  const tokenHash = hashEmailAuthToken(token, returnTo)
  const now = new Date().toISOString()
  const session = await getSession()

  // Inspecting a link never consumes it, creates an account or changes identity.
  // The challenge is bound to this browser, destination digest and current user.
  if (action === "prepare") {
    const [pending] = await db
      .select()
      .from(emailAuthTokensTable)
      .where(
        and(
          eq(emailAuthTokensTable.tokenHash, tokenHash),
          isNull(emailAuthTokensTable.usedAt),
          gt(emailAuthTokensTable.expiresAt, now)
        )
      )
      .limit(1)
    if (!pending)
      return Response.json(
        { error: "This sign-in link is invalid or has expired." },
        { status: 400 }
      )
    const [target] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          sql`lower(${usersTable.email}) = ${pending.email}`,
          eq(usersTable.isAi, false)
        )
      )
      .limit(1)
    if (!target && !pending.allowAccountCreation)
      return Response.json(
        { error: "This sign-in link is invalid or has expired." },
        { status: 400 }
      )
    session.emailAuthConfirmation = createEmailAuthConfirmation(
      tokenHash,
      session.id
    )
    await session.save()
    return Response.json(
      {
        email: pending.email,
        challenge: session.emailAuthConfirmation.challenge,
        createsAccount: !target,
        switchesAccount: !!session.id && session.id !== target?.id
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  }

  if (
    !matchesEmailAuthConfirmation(
      session.emailAuthConfirmation,
      tokenHash,
      challenge,
      session.id
    )
  )
    return Response.json(
      { error: "Check this link again before confirming your account." },
      { status: 409 }
    )

  const result = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(emailAuthTokensTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailAuthTokensTable.tokenHash, tokenHash),
          isNull(emailAuthTokensTable.usedAt),
          gt(emailAuthTokensTable.expiresAt, now)
        )
      )
      .returning({
        email: emailAuthTokensTable.email,
        allowAccountCreation: emailAuthTokensTable.allowAccountCreation
      })
    if (!claimed) return null

    const [existingUser] = await tx
      .select()
      .from(usersTable)
      .where(
        and(
          sql`lower(${usersTable.email}) = ${claimed.email}`,
          eq(usersTable.isAi, false)
        )
      )
      .limit(1)
    let user = existingUser
    let isNewAccount = false

    if (user) {
      const [updatedUser] = await tx
        .update(usersTable)
        .set({
          email: claimed.email,
          emailVerifiedAt: user.emailVerifiedAt || now
        })
        .where(eq(usersTable.id, user.id))
        .returning()
      user = updatedUser
    } else if (claimed.allowAccountCreation) {
      const [insertedUser] = await tx
        .insert(usersTable)
        .values({
          name: "",
          email: claimed.email,
          emailVerifiedAt: now
        })
        .onConflictDoNothing()
        .returning()
      user = insertedUser
      isNewAccount = !!insertedUser

      if (!user) {
        const [concurrentUser] = await tx
          .select()
          .from(usersTable)
          .where(
            and(
              sql`lower(${usersTable.email}) = ${claimed.email}`,
              eq(usersTable.isAi, false)
            )
          )
          .limit(1)
        user = concurrentUser
      }
    }

    if (!user) return null

    await tx
      .update(emailAuthTokensTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailAuthTokensTable.email, claimed.email),
          ne(emailAuthTokensTable.tokenHash, tokenHash),
          isNull(emailAuthTokensTable.usedAt)
        )
      )

    return {
      userId: user.id,
      isNewAccount
    }
  })

  if (!result)
    return Response.json(
      { error: "This sign-in link is invalid or has expired." },
      { status: 400 }
    )

  delete session.emailAuthConfirmation
  session.id = result.userId
  await session.save()

  return Response.json({
    redirectTo: result.isNewAccount
      ? profileCompletionPath(returnTo)
      : (returnTo ?? "/profile")
  })
}
