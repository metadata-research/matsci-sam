import { revalidatePath } from "next/cache"
import { TRPCError } from "@trpc/server"
import {
  collectionsTable,
  communitiesTable,
  communityCollectionsTable,
  db,
  studiesTable
} from "@yamz/db"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { createTRPCRouter } from "../init"
import { adminProcedure } from "../procedures"
import {
  STUDY_INSTRUCTIONS_MAX,
  STUDY_TITLE_MAX,
  normalizeStudyInstructions,
  studyWindowError
} from "@/lib/study-editor"
import { uniqueSlug } from "@/lib/slug"
import { setStudyRetired, updateStudyDetails } from "@/lib/study-update"
import { setStudyCandidateExcluded } from "@/lib/study-candidates"
import {
  collectionsIndexPath,
  communityPath,
  studiesIndexPath,
  studyPath
} from "@/lib/public-identifiers"

const nullableDateTime = z.string().datetime({ offset: true }).nullable()
const expectedDateTime = z.string().nullable()
const expectedStudySchema = z.object({
  title: z.string(),
  welcome: z.string().nullable(),
  opensAt: expectedDateTime,
  closesAt: expectedDateTime,
  retiredAt: expectedDateTime
})

const throwWindowError = (opensAt: string | null, closesAt: string | null) => {
  const error = studyWindowError(opensAt, closesAt)
  if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error })
}

const adminStudyPath = (id: number) => `/admin/studies/${id}`

const revalidateStudyPaths = (study: {
  id: number
  slug: string
  communitySlug: string
}) => {
  revalidatePath("/admin/studies")
  revalidatePath(adminStudyPath(study.id))
  revalidatePath(studiesIndexPath)
  revalidatePath(studyPath(study.slug))
  revalidatePath(communityPath(study.communitySlug))
}

export const adminStudiesRouter = createTRPCRouter({
  setCandidateExcluded: adminProcedure
    .meta({ marksGraphs: false })
    .input(
      z.object({
        studyId: z.number().int().positive(),
        definitionId: z.number().int().positive(),
        excluded: z.boolean(),
        expectedExclusionId: z.number().int().positive().nullable(),
        reason: z.string().trim().min(1).max(1000)
      })
    )
    .mutation(async ({ ctx: { userId }, input }) => {
      const result = await setStudyCandidateExcluded({ ...input, userId })
      revalidatePath(adminStudyPath(input.studyId))
      return result
    }),

  create: adminProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(STUDY_TITLE_MAX),
        instructions: z.string().max(STUDY_INSTRUCTIONS_MAX),
        communityId: z.number().int().positive(),
        collectionId: z.number().int().positive(),
        opensAt: nullableDateTime,
        closesAt: nullableDateTime
      })
    )
    .mutation(async ({ ctx: { userId }, input }) => {
      throwWindowError(input.opensAt, input.closesAt)
      const welcome = normalizeStudyInstructions(input.instructions)

      const created = await db.transaction(async (tx) => {
        const [community] = await tx
          .select({
            id: communitiesTable.id,
            slug: communitiesTable.slug,
            retiredAt: communitiesTable.retiredAt
          })
          .from(communitiesTable)
          .where(eq(communitiesTable.id, input.communityId))
          .limit(1)
          .for("update")
        if (!community)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This community does not exist."
          })
        if (community.retiredAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose an active community."
          })

        const [collection] = await tx
          .select({
            id: collectionsTable.id,
            retiredAt: collectionsTable.retiredAt
          })
          .from(collectionsTable)
          .where(eq(collectionsTable.id, input.collectionId))
          .limit(1)
          .for("update")
        if (!collection)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This collection does not exist."
          })
        if (collection.retiredAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose an active collection."
          })

        const takenRows = await tx
          .select({ slug: studiesTable.slug })
          .from(studiesTable)
        const taken = new Set(takenRows.map((row) => row.slug))
        let slug = uniqueSlug(input.title, taken, "study")
        let study: { id: number; slug: string } | undefined

        // ON CONFLICT keeps a concurrent study with the same normalized title
        // from aborting the transaction. Add the next stable suffix and retry.
        for (let attempt = 0; attempt < 25 && !study; attempt++) {
          const [inserted] = await tx
            .insert(studiesTable)
            .values({
              slug,
              communityId: community.id,
              collectionId: collection.id,
              title: input.title,
              welcome,
              opensAt: input.opensAt,
              closesAt: input.closesAt,
              createdById: userId
            })
            .onConflictDoNothing()
            .returning({ id: studiesTable.id, slug: studiesTable.slug })
          study = inserted
          if (!study) {
            taken.add(slug)
            slug = uniqueSlug(input.title, taken, "study")
          }
        }
        if (!study)
          throw new TRPCError({
            code: "CONFLICT",
            message: "A unique address could not be assigned. Try again."
          })

        await tx
          .insert(communityCollectionsTable)
          .values({
            communityId: community.id,
            collectionId: collection.id,
            addedById: userId
          })
          .onConflictDoNothing()

        return { ...study, communitySlug: community.slug }
      })

      revalidateStudyPaths(created)
      revalidatePath(collectionsIndexPath)
      revalidatePath("/terms")
      return created
    }),

  update: adminProcedure
    .input(
      z.object({
        studyId: z.number().int().positive(),
        expected: expectedStudySchema,
        title: z.string().trim().min(1).max(STUDY_TITLE_MAX).optional(),
        instructions: z.string().max(STUDY_INSTRUCTIONS_MAX).optional(),
        opensAt: nullableDateTime.optional(),
        closesAt: nullableDateTime.optional()
      })
    )
    .mutation(async ({ input }) => {
      const updated = await updateStudyDetails({
        studyId: input.studyId,
        expected: input.expected,
        title: input.title,
        instructions: input.instructions,
        opensAt: input.opensAt,
        closesAt: input.closesAt
      })

      revalidateStudyPaths(updated)
      return { ok: true }
    }),

  setRetired: adminProcedure
    .input(
      z.object({
        studyId: z.number().int().positive(),
        retired: z.boolean(),
        expectedRetiredAt: expectedDateTime
      })
    )
    .mutation(async ({ input }) => {
      const updated = await setStudyRetired({
        studyId: input.studyId,
        retired: input.retired,
        expectedRetiredAt: input.expectedRetiredAt
      })

      revalidateStudyPaths(updated)
      return { ok: true }
    })
})
