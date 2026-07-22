import { createHash, timingSafeEqual } from "node:crypto"
import { db, usersTable } from "@yamz/db"
import { getDevAuthUsers, isDevAuthEnabled } from "@/lib/dev-auth"
import { getSession } from "@/lib/session"
import { eq, sql } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

const sameSecret = (submitted: string, expected: string) => {
  const submittedDigest = createHash("sha256").update(submitted).digest()
  const expectedDigest = createHash("sha256").update(expected).digest()
  return timingSafeEqual(submittedDigest, expectedDigest)
}

const loginRedirect = (request: NextRequest, error: string) =>
  NextResponse.redirect(new URL(`/dev-login?error=${error}`, request.url), 303)

export const POST = async (request: NextRequest) => {
  if (!isDevAuthEnabled()) return new Response("Not found", { status: 404 })

  const expectedPassword = process.env.DEV_AUTH_PASSWORD
  if (!expectedPassword) return loginRedirect(request, "configuration")

  let users
  try {
    users = getDevAuthUsers()
  } catch {
    return loginRedirect(request, "configuration")
  }

  const form = await request.formData()
  const username = String(form.get("username") ?? "").trim().toLowerCase()
  const password = String(form.get("password") ?? "")
  const configuredUser = users.find((candidate) => candidate.username === username)

  if (!configuredUser || !sameSecret(password, expectedPassword))
    return loginRedirect(request, "invalid")

  let user = await db.query.usersTable.findFirst({
    where: sql`lower(${usersTable.email}) = ${configuredUser.email}`
  })

  if (!user) {
    const [inserted] = await db
      .insert(usersTable)
      .values({
        name: configuredUser.name,
        email: configuredUser.email,
        role: "user"
      })
      .returning()
    user = inserted
  } else if (!user.name) {
    const [updated] = await db
      .update(usersTable)
      .set({ name: configuredUser.name })
      .where(eq(usersTable.id, user.id))
      .returning()
    user = updated
  }

  const session = await getSession()
  session.id = user!.id
  await session.save()

  return NextResponse.redirect(new URL("/profile", request.url), 303)
}
