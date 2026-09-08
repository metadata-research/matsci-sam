import { eq } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { db, studiesTable, communityMembersTable, usersTable } from "@yamz/db"
import { lockStudy, stepsOfStudy } from "./survey-queries"
import { lockMembershipIn } from "./community-queries"
import { studyState } from "./communities"
import { allowsStudySelfEnrollment } from "./study-protocol"

// Called only by the authenticated join mutation. Opening a page never joins
// a community, consumes an invitation, or records a participant response.
export const joinOpenStudy = async (studySlug: string, userId: number) => {
  const study = await db.query.studiesTable.findFirst({
    columns: { id: true },
    where: eq(studiesTable.slug, studySlug)
  })
  if (!study)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This study doesn't exist"
    })
  return db.transaction(async (tx) => {
    const locked = await lockStudy(tx, study.id)
    if (!locked || !allowsStudySelfEnrollment(locked.slug))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This study requires an invitation."
      })
    if (studyState(locked) !== "open")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This study is not accepting participants."
      })
    if ((await stepsOfStudy(tx, locked.id)).length === 0)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The study activity is not ready yet."
      })
    const existing = await lockMembershipIn(tx, locked.communityId, userId)
    if (!existing) {
      await tx
        .insert(communityMembersTable)
        .values({
          communityId: locked.communityId,
          userId,
          addedById: userId,
          role: "member"
        })
        .onConflictDoNothing()
      await tx
        .update(usersTable)
        .set({ activeCommunityId: locked.communityId })
        .where(eq(usersTable.id, userId))
    }
    return { studySlug: locked.slug, communitySlug: locked.communitySlug }
  })
}
