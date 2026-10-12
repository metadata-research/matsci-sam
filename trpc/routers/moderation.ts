import { z } from "zod"
import { db } from "@yamz/db"
import { revalidatePath } from "next/cache"
import {
  changeTermVisibility,
  listTermVisibility,
  termVisibilityHistory
} from "@/lib/term-visibility"
import { adminProcedure } from "../procedures"
import { createTRPCRouter } from "../init"

export const moderationRouter = createTRPCRouter({
  terms: adminProcedure
    .input(
      z
        .object({
          query: z.string().trim().max(200).optional(),
          status: z.enum(["all", "listed", "hidden"]).default("all")
        })
        .default({ status: "all" })
    )
    .query(({ input }) => listTermVisibility(input)),
  history: adminProcedure
    .input(z.number().int().positive())
    .query(({ input }) => termVisibilityHistory(input)),
  setVisibility: adminProcedure
    .input(
      z.object({
        termId: z.number().int().positive(),
        hidden: z.boolean(),
        reason: z.string().trim().min(1).max(1000),
        expectedVersion: z.number().int().nonnegative()
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await db.transaction((tx) =>
        changeTermVisibility(tx, { ...input, actorId: ctx.userId })
      )
      if (result.changed) revalidatePath("/", "layout")
      return result
    })
})
