import { TRPCError } from "@trpc/server"
import { baseProcedure } from "./init"
import { GetUser } from "@/lib/crud"

export const authenticatedProcedure = baseProcedure.use((opts) => {
  if (!opts.ctx.userId)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be logged in to perform this action"
    })

  return opts.next({
    ctx: {
      userId: opts.ctx.userId!
    }
  })
})

export const contributorProcedure = authenticatedProcedure.use(async (opts) => {
  const user = await GetUser(opts.ctx.userId)

  if (!user?.name?.trim())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Complete your profile before contributing."
    })

  return opts.next()
})

export const adminProcedure = authenticatedProcedure.use(async (opts) => {
  const user = await GetUser(opts.ctx.userId)

  if (user?.role !== "admin")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to perform this action"
    })

  return opts.next()
})
