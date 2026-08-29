import { createHash, timingSafeEqual } from "node:crypto"
import { db, usersTable } from "@yamz/db"
import { getDevAuthUsers, isDevAuthEnabled } from "@/lib/dev-auth"
import { getSession } from "@/lib/session"
import { eq, sql } from "drizzle-orm"
import { NextRequest } from "next/server"
import { authPathWithReturnTo, normalizeAuthReturnTo } from "@/lib/auth-return"

const sameSecret = (submitted: string, expected: string) => {
  const submittedDigest = createHash("sha256").update(submitted).digest()
  const expectedDigest = createHash("sha256").update(expected).digest()
  return timingSafeEqual(submittedDigest, expectedDigest)
}

const loginRedirect = (error: string, returnTo: string | null = null) =>
  new Response(null, {
    status: 303,
    headers: {
      Location: authPathWithReturnTo(`/dev-login?error=${error}`, returnTo)
    }
  })

export const POST = async (request: NextRequest) => {
  if (!isDevAuthEnabled()) return new Response("Not found", { status: 404 })

  const expectedPassword = process.env.DEV_AUTH_PASSWORD
  if (!expectedPassword) return loginRedirect("configuration")

  let users
  try {
    users = getDevAuthUsers()
  } catch {
    return loginRedirect("configuration")
  }

  const form = await request.formData()
  const returnTo = normalizeAuthReturnTo(form.get("returnTo"))
  const username = String(form.get("username") ?? "")
    .trim()
    .toLowerCase()
  const password = String(form.get("password") ?? "")
  const configuredUser = users.find(
    (candidate) => candidate.username === username
  )

  if (!configuredUser || !sameSecret(password, expectedPassword))
    return loginRedirect("invalid", returnTo)

  const [firstName, ...lastNameParts] = configuredUser.name.split(/\s+/)
  const lastName = lastNameParts.join(" ") || null

  let user = await db.query.usersTable.findFirst({
    where: sql`lower(${usersTable.email}) = ${configuredUser.email}`
  })

  if (!user) {
    const [inserted] = await db
      .insert(usersTable)
      .values({
        name: configuredUser.name,
        firstName,
        lastName,
        email: configuredUser.email,
        role: "user"
      })
      .returning()
    user = inserted
  } else if (!user.name || !user.firstName || !user.lastName) {
    const [updated] = await db
      .update(usersTable)
      .set({
        name: user.name || configuredUser.name,
        firstName: user.firstName || firstName,
        lastName: user.lastName || lastName
      })
      .where(eq(usersTable.id, user.id))
      .returning()
    user = updated
  }

  const session = await getSession()
  session.id = user!.id
  await session.save()

  return new Response(null, {
    status: 303,
    headers: { Location: returnTo ?? "/profile" }
  })
}
