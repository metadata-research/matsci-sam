import { z } from "zod"
import { authenticatedProcedure } from "../procedures"
import { createTRPCRouter } from "../init"
import { collectionsTable, db, statementsTable, termsTable } from "@yamz/db"
import { and, eq, isNull, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import { GetUser } from "@/lib/crud"
import { mayAssertIn, mayCreateCollection } from "@/lib/kos"
import { uniqueSlug } from "@/lib/slug"
import { collectionPath, collectionsIndexPath } from "@/lib/public-identifiers"
import {
  lockCollectionMembershipRow,
  reserveCollectionMembership
} from "@/lib/collection-membership-lock"

/*
 * Collections: a named set of terms, gathered for a purpose.
 *
 * Separate from the tags router because a collection is not a tag. A tag
 * classifies a term; a collection groups terms without saying anything about
 * what they mean. They share only the statements table.
 *
 * Every membership change follows the same shape as tags.setFacet: load the
 * row, check the rule, then assert or retract inside one transaction. Nothing
 * is deleted, here or anywhere else in the ledger.
 */

const TITLE_MAX = 120
const DESCRIPTION_MAX = 2000

const loadCollection = async (id: number) => {
  const [row] = await db
    .select({
      id: collectionsTable.id,
      slug: collectionsTable.slug,
      title: collectionsTable.title,
      assertableBy: collectionsTable.assertableBy,
      retiredAt: collectionsTable.retiredAt
    })
    .from(collectionsTable)
    .where(eq(collectionsTable.id, id))
    .limit(1)
  return row ?? null
}

// A retired collection accepts no change until it is restored, so every
// mutation below funnels through the same two refusals.
const requireEditable = async (collectionId: number, userId: number) => {
  const collection = await loadCollection(collectionId)
  if (!collection)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This collection doesn't exist"
    })
  if (collection.retiredAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This collection has been retired"
    })

  const user = await GetUser(userId)
  if (!mayAssertIn(collection, user ?? null))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This collection is curated"
    })

  return collection
}

const requireCurator = async (userId: number) => {
  const user = await GetUser(userId)
  if (user?.role !== "admin")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a curator can retire or restore a collection"
    })
}

export const collectionsRouter = createTRPCRouter({
  create: authenticatedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(TITLE_MAX),
        description: z.string().trim().max(DESCRIPTION_MAX).optional()
      })
    )
    .mutation(async ({ ctx: { userId }, input: { title, description } }) => {
      const user = await GetUser(userId)
      if (!mayCreateCollection(user ?? null))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only a curator can create a collection"
        })

      const taken = await db
        .select({ slug: collectionsTable.slug })
        .from(collectionsTable)
      const slug = uniqueSlug(title, new Set(taken.map((row) => row.slug)))
      if (!slug)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That title does not produce a usable address"
        })

      const [created] = await db
        .insert(collectionsTable)
        .values({
          slug,
          title,
          description: description || null,
          // A curator's collection stays curated. One created under an open
          // deployment belongs to the contributor who made it.
          assertableBy: user?.role === "admin" ? "curator" : "contributor",
          createdById: userId
        })
        .returning({
          id: collectionsTable.id,
          slug: collectionsTable.slug
        })

      revalidatePath(collectionsIndexPath)

      return created
    }),

  update: authenticatedProcedure
    .input(
      z.object({
        collectionId: z.number().int(),
        title: z.string().trim().min(1).max(TITLE_MAX).optional(),
        description: z.string().trim().max(DESCRIPTION_MAX).nullish()
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: { collectionId, title, description }
      }) => {
        const collection = await requireEditable(collectionId, userId)

        // The slug is not derived again. A published address stays put even
        // when the title it came from changes.
        await db
          .update(collectionsTable)
          .set({
            ...(title === undefined ? {} : { title }),
            ...(description === undefined
              ? {}
              : { description: description || null })
          })
          .where(eq(collectionsTable.id, collectionId))

        revalidatePath(collectionsIndexPath)
        revalidatePath(collectionPath(collection.slug))

        return { ok: true }
      }
    ),

  setMember: authenticatedProcedure
    .input(
      z.object({
        collectionId: z.number().int(),
        termId: z.number().int(),
        on: z.boolean()
      })
    )
    .mutation(
      async ({ ctx: { userId }, input: { collectionId, termId, on } }) => {
        const collection = await requireEditable(collectionId, userId)

        const [term] = await db
          .select({ id: termsTable.id, slug: termsTable.slug })
          .from(termsTable)
          .where(eq(termsTable.id, termId))
          .limit(1)
        if (!term)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This term doesn't exist"
          })

        await db.transaction(async (tx) => {
          await reserveCollectionMembership(tx, collectionId)
          const lockedCollection = await lockCollectionMembershipRow(
            tx,
            collectionId
          )
          if (!lockedCollection)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "This collection doesn't exist"
            })
          if (lockedCollection.retiredAt)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "This collection has been retired"
            })

          const [active] = await tx
            .select({ id: statementsTable.id })
            .from(statementsTable)
            .where(
              and(
                eq(statementsTable.predicate, "skos:member"),
                eq(statementsTable.subjectCollectionId, collectionId),
                eq(statementsTable.objectTermId, termId),
                isNull(statementsTable.retractedAt)
              )
            )
            .limit(1)

          if (on && !active)
            await tx
              .insert(statementsTable)
              .values({
                predicate: "skos:member",
                subjectCollectionId: collectionId,
                objectTermId: termId,
                assertedById: userId
              })
              .onConflictDoNothing()
          else if (!on && active) {
            const [retracted] = await tx
              .update(statementsTable)
              .set({ retractedAt: sql`now()`, retractedById: userId })
              .where(
                and(
                  eq(statementsTable.id, active.id),
                  isNull(statementsTable.retractedAt)
                )
              )
              .returning({ id: statementsTable.id })
            if (!retracted)
              throw new TRPCError({
                code: "CONFLICT",
                message: "The collection membership changed. Try again."
              })
          }
        })

        revalidatePath(collectionsIndexPath)
        revalidatePath(collectionPath(collection.slug))

        return { ok: true, on }
      }
    ),

  // Retiring is not a membership change, so it binds a curator whatever the
  // collection says about who may assert into it.
  retire: authenticatedProcedure
    .input(z.object({ collectionId: z.number().int() }))
    .mutation(async ({ ctx: { userId }, input: { collectionId } }) => {
      await requireCurator(userId)
      const collection = await loadCollection(collectionId)
      if (!collection)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This collection doesn't exist"
        })

      await db.transaction(async (tx) => {
        await tx
          .update(collectionsTable)
          .set({ retiredAt: sql`now()` })
          .where(eq(collectionsTable.id, collectionId))

        // Membership is retracted rather than removed, so what the collection
        // held stays legible after it is retired.
        await tx
          .update(statementsTable)
          .set({ retractedAt: sql`now()`, retractedById: userId })
          .where(
            and(
              eq(statementsTable.predicate, "skos:member"),
              eq(statementsTable.subjectCollectionId, collectionId),
              isNull(statementsTable.retractedAt)
            )
          )
      })

      revalidatePath(collectionsIndexPath)
      revalidatePath(collectionPath(collection.slug))

      return { ok: true }
    }),

  // Restoring returns the collection, not its membership. The retracted rows
  // stay retracted: re-asserting them would claim a curator added each term
  // back, which nobody did.
  restore: authenticatedProcedure
    .input(z.object({ collectionId: z.number().int() }))
    .mutation(async ({ ctx: { userId }, input: { collectionId } }) => {
      await requireCurator(userId)
      const collection = await loadCollection(collectionId)
      if (!collection)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This collection doesn't exist"
        })

      await db
        .update(collectionsTable)
        .set({ retiredAt: null })
        .where(eq(collectionsTable.id, collectionId))

      revalidatePath(collectionsIndexPath)
      revalidatePath(collectionPath(collection.slug))

      return { ok: true }
    })
})
