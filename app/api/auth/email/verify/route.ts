import { db, emailAuthTokensTable, usersTable } from "@yamz/db"
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm"
import { hashEmailAuthToken, isEmailAuthEnabled } from "@/lib/email-auth"
import { getSession } from "@/lib/session"

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export const POST = async (request: Request) => {
  if (!isEmailAuthEnabled()) return new Response("Not found", { status: 404 })

  let token = ""
  try {
    const body = (await request.json()) as { token?: unknown }
    token = typeof body.token === "string" ? body.token : ""
  } catch {
    // The response below intentionally treats malformed and invalid tokens the
    // same way.
  }

  if (!TOKEN_PATTERN.test(token))
    return Response.json(
      { error: "This sign-in link is invalid." },
      {
        status: 400
      }
    )

  const tokenHash = hashEmailAuthToken(token)
  const now = new Date().toISOString()
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
      .returning({ email: emailAuthTokensTable.email })
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
    } else {
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

    if (!user) throw new Error("Verified account could not be created")

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
      needsProfile: !user.firstName || !user.lastName
    }
  })

  if (!result)
    return Response.json(
      { error: "This sign-in link is invalid or has expired." },
      { status: 400 }
    )

  const session = await getSession()
  session.id = result.userId
  await session.save()

  return Response.json({
    redirectTo: result.needsProfile ? "/profile/edit?welcome=1" : "/profile"
  })
}
