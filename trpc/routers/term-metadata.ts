import { z } from "zod"
import { createTRPCRouter, baseProcedure } from "../init"
import {
  contributorProcedure,
  authenticatedProcedure,
  adminProcedure
} from "../procedures"
import {
  addTermMetadata,
  getTermMetadata,
  retractTermMetadata,
  reviewTermMetadata
} from "@/lib/term-metadata"
import { termMetadataInputSchema } from "@/lib/term-metadata-validation"
import { markGraphsDirty } from "@/lib/graph/projector"

// Proposals and rejected suggestions never reach a public graph. Mark only
// accepted changes. A retracted accepted assertion still has public history.
export const termMetadataRouter = createTRPCRouter({
  get: baseProcedure
    .input(z.object({ termId: z.number().int().positive() }))
    .query(({ input, ctx }) => getTermMetadata(input.termId, ctx.userId)),
  add: contributorProcedure
    .meta({ marksGraphs: false })
    .input(termMetadataInputSchema)
    .mutation(async ({ input, ctx }) => {
      const row = await addTermMetadata(ctx.userId, input)
      if (row.status === "accepted") markGraphsDirty()
      return row
    }),
  retract: authenticatedProcedure
    .meta({ marksGraphs: false })
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const row = await retractTermMetadata(ctx.userId, input.id)
      if (row.status === "accepted") markGraphsDirty()
      return row
    }),
  review: adminProcedure
    .meta({ marksGraphs: false })
    .input(
      z.object({
        id: z.string().uuid(),
        decision: z.enum(["accept", "reject"])
      })
    )
    .mutation(async ({ input, ctx }) => {
      const row = await reviewTermMetadata(ctx.userId, input.id, input.decision)
      if (row.status === "accepted") markGraphsDirty()
      return row
    })
})
