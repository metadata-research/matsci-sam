import { db, usersTable } from "@yamz/db"
import { getSession } from "@/lib/session"
import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"

const DEV_EMAIL = "dev@localhost"

// Local-testing login that skips Google OAuth. Only exists in development —
// production builds return 404.
export const GET = async () => {
  if (process.env.NODE_ENV === "production")
    return new Response("Not found", { status: 404 })

  let user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, DEV_EMAIL)
  })

  if (!user) {
    const [inserted] = await db
      .insert(usersTable)
      .values({ name: "Dev User", email: DEV_EMAIL, role: "admin" })
      .returning()
    user = inserted
  }

  const session = await getSession()
  session.id = user!.id
  await session.save()

  redirect("/profile")
}
