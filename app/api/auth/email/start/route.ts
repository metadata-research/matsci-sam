import { db, emailAuthTokensTable } from "@yamz/db"
import { and, eq, gt, isNull, lt } from "drizzle-orm"
import { after, NextRequest, NextResponse } from "next/server"
import {
  createEmailAuthToken,
  EmailAddressSchema,
  emailAuthTokenExpiry,
  getAuthSiteUrl,
  hashEmailAuthToken,
  isEmailAuthEnabled
} from "@/lib/email-auth"
import { sendEmailSignInLink } from "@/lib/email"

const genericRedirect = () =>
  NextResponse.redirect(new URL("/register/check-email", getAuthSiteUrl()), 303)

export const POST = async (request: NextRequest) => {
  if (!isEmailAuthEnabled()) return new Response("Not found", { status: 404 })

  const expectedOrigin = getAuthSiteUrl().origin
  if (request.headers.get("origin") !== expectedOrigin)
    return new Response("Invalid request origin.", { status: 403 })

  const form = await request.formData()
  const parsed = EmailAddressSchema.safeParse(form.get("email"))
  if (!parsed.success) return genericRedirect()

  const email = parsed.data
  const now = new Date().toISOString()
  await db
    .delete(emailAuthTokensTable)
    .where(lt(emailAuthTokensTable.expiresAt, now))

  const recentThreshold = new Date(Date.now() - 60 * 1000).toISOString()
  const [recent] = await db
    .select({ tokenHash: emailAuthTokensTable.tokenHash })
    .from(emailAuthTokensTable)
    .where(
      and(
        eq(emailAuthTokensTable.email, email),
        gt(emailAuthTokensTable.createdAt, recentThreshold)
      )
    )
    .limit(1)
  if (recent) return genericRedirect()

  const token = createEmailAuthToken()
  const tokenHash = hashEmailAuthToken(token)

  await db.transaction(async (tx) => {
    await tx
      .update(emailAuthTokensTable)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailAuthTokensTable.email, email),
          isNull(emailAuthTokensTable.usedAt)
        )
      )
    await tx.insert(emailAuthTokensTable).values({
      tokenHash,
      email,
      expiresAt: emailAuthTokenExpiry()
    })
  })

  after(async () => {
    try {
      await sendEmailSignInLink({ email, token })
    } catch {
      await db
        .delete(emailAuthTokensTable)
        .where(eq(emailAuthTokensTable.tokenHash, tokenHash))
      console.error("Passwordless authentication email delivery failed")
    }
  })

  return genericRedirect()
}
