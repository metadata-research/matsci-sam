import "server-only"
import { cache } from "react"
import { eq } from "drizzle-orm"
import { db, usersTable } from "@yamz/db"
import { getSession } from "@/lib/session"

/**
 * Return the account attached to the current request, if any.
 *
 * React's request cache lets the root layout and header share this lookup
 * without querying the session and users table twice.
 */
export const getCurrentUser = cache(async () => {
  const session = await getSession()

  if (!session.id) return null

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.id))
    .limit(1)

  return user ?? null
})
