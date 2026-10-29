import { z } from "zod"
import { revalidatePath } from "next/cache"
import { db } from "@yamz/db"
import { baseProcedure, createTRPCRouter } from "../init"
import { authenticatedProcedure } from "../procedures"
import {
  createReviewSchema,
  saveReviewSchema
} from "@/lib/community-review-types"
import {
  reviewCandidates,
  createCommunityReview,
  listCommunityReviews,
  requestedCommunityReviews,
  getCommunityReview,
  saveCommunityReview,
  communityReviewResults,
  suggestFromReview,
  closeCommunityReview,
  createReviewInvitation,
  acceptReviewInvitation,
  revokeReviewInvitation,
  listReviewInvitations
} from "@/lib/community-reviews"

const identity = z.object({ id: z.string().uuid() }).strict()
const mutation = authenticatedProcedure.meta({ marksGraphs: false })
export const communityReviewsRouter = createTRPCRouter({
  candidates: authenticatedProcedure
    .input(
      createReviewSchema.pick({
        communityId: true,
        area: true,
        referenceReleaseId: true
      })
    )
    .query(({ input, ctx }) => reviewCandidates(db, input, ctx.userId)),
  list: baseProcedure
    .input(z.object({ communityId: z.number().int().positive() }))
    .query(({ input, ctx }) =>
      listCommunityReviews(db, input.communityId, ctx.userId ?? null)
    ),
  get: baseProcedure
    .input(identity)
    .query(({ input, ctx }) =>
      getCommunityReview(db, input.id, ctx.userId ?? null)
    ),
  requested: authenticatedProcedure
    .input(
      z
        .object({
          communityId: z.number().int().positive(),
          area: z.string().trim().max(80).optional()
        })
        .strict()
    )
    .query(({ input, ctx }) =>
      requestedCommunityReviews(db, input.communityId, ctx.userId, input.area)
    ),
  create: mutation
    .input(createReviewSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await db.transaction((tx) =>
        createCommunityReview(tx, input, ctx.userId)
      )
      revalidatePath("/communities", "layout")
      return result
    }),
  close: mutation
    .input(identity)
    .mutation(({ input, ctx }) =>
      db.transaction((tx) => closeCommunityReview(tx, input.id, ctx.userId))
    ),
  save: mutation
    .input(saveReviewSchema)
    .mutation(({ input, ctx }) =>
      db.transaction((tx) => saveCommunityReview(tx, input, ctx.userId))
    ),
  results: authenticatedProcedure
    .input(identity)
    .query(({ input, ctx }) =>
      communityReviewResults(db, input.id, ctx.userId)
    ),
  suggest: mutation
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      db.transaction((tx) => suggestFromReview(tx, input.itemId, ctx.userId))
    ),
  invite: mutation
    .input(
      z
        .object({
          roundId: z.string().uuid(),
          days: z.number().int().min(1).max(30).default(14)
        })
        .strict()
    )
    .mutation(({ input, ctx }) =>
      db.transaction((tx) =>
        createReviewInvitation(tx, input.roundId, input.days, ctx.userId)
      )
    ),
  invitations: authenticatedProcedure
    .input(identity)
    .query(({ input, ctx }) => listReviewInvitations(db, input.id, ctx.userId)),
  revokeInvitation: mutation
    .input(identity)
    .mutation(({ input, ctx }) =>
      db.transaction((tx) => revokeReviewInvitation(tx, input.id, ctx.userId))
    ),
  acceptInvitation: mutation
    .input(
      z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict()
    )
    .mutation(async ({ input, ctx }) => {
      const result = await db.transaction((tx) =>
        acceptReviewInvitation(tx, input.token, ctx.userId)
      )
      revalidatePath("/", "layout")
      return result
    })
})
