import { z } from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import { authenticatedProcedure } from "../procedures"
import { db, definitionsTable, tagsTable, tagsToDefinitions } from "@yamz/db"
import { and, eq, getTableColumns } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import { TAG_MAX_LENGTH } from "@/lib/input-limits"
import { contributorProcedure } from "../procedures"

export const tagsRouter = createTRPCRouter({
  create: contributorProcedure
    .input(z.object({ name: z.string().trim().min(1).max(TAG_MAX_LENGTH) }))
    .mutation(async ({ input }) => {
      const [tag] = await db
        .insert(tagsTable)
        .values({ name: input.name })
        .returning()

      revalidatePath(`/tags`)

      return tag
    }),
  get: baseProcedure
    .input(z.object({ definitionId: z.number() }))
    .query(async ({ input: { definitionId } }) => {
      return await db
        .select(getTableColumns(tagsTable))
        .from(tagsToDefinitions)
        .where(eq(tagsToDefinitions.definitionId, definitionId))
        .innerJoin(tagsTable, eq(tagsToDefinitions.tagId, tagsTable.id))
    }),
  // toggles a tag on a given term
  toggle: authenticatedProcedure
    .input(
      z.object({
        tagId: z.number(),
        definitionId: z.number()
      })
    )
    .mutation(async ({ ctx: { userId }, input: { definitionId, tagId } }) => {
      const [definition] = await db
        .select({
          authorId: definitionsTable.authorId,
          exists: tagsToDefinitions.definitionId
        })
        .from(definitionsTable)
        .leftJoin(
          tagsToDefinitions,
          and(
            eq(definitionsTable.id, tagsToDefinitions.definitionId),
            eq(tagsToDefinitions.tagId, tagId)
          )
        )
        .where(eq(definitionsTable.id, definitionId))
        .limit(1)

      // if the term doesn't exist, throw an error
      if (!definition)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This term doesn't exist"
        })

      // if the user isn't the author, throw an error
      if (definition.authorId != userId)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not the owner of this term"
        })

      if (definition.exists)
        // relation exists - delete it
        await db
          .delete(tagsToDefinitions)
          .where(
            and(
              eq(tagsToDefinitions.definitionId, definitionId),
              eq(tagsToDefinitions.tagId, tagId)
            )
          )
      else
        // relation doesn't exist - insert
        await db
          .insert(tagsToDefinitions)
          .values({ definitionId, tagId })
          .onConflictDoNothing()

      return { ok: true }
    }),
  getAll: baseProcedure.query(async () => {
    return await db.select().from(tagsTable)
  })
})
