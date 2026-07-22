import { EditProfileSchema } from "@/lib/schemas/profile"
import { createTRPCRouter } from "../init"
import { authenticatedProcedure } from "../procedures"
import { db, usersTable } from "@yamz/db"
import { eq } from "drizzle-orm"

export const userRouter = createTRPCRouter({
  edit: authenticatedProcedure
    .input(EditProfileSchema)
    .mutation(async ({ input: data, ctx: { userId } }) => {
      const name = `${data.firstName} ${data.lastName}`

      await db
        .update(usersTable)
        .set({
          name,
          firstName: data.firstName,
          lastName: data.lastName,
          affiliation: data.affiliation || null
        })
        .where(eq(usersTable.id, userId))

      return { ok: true }
    })
})
