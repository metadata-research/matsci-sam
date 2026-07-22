import { redirect } from "next/navigation"
import { getSession } from "./session"
import { db, usersTable } from "@yamz/db"
import { eq } from "drizzle-orm"

export const auth = async () => {
  const sesh = await getSession()
  if (!sesh.id) redirect("/api/login")

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, sesh.id)
  })

  return { sesh, user }
}
