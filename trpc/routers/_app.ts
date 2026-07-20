import { baseProcedure, createTRPCRouter } from "../init"
import { tagsRouter } from "./tags"
import { userRouter } from "./user"
import { definitionsRouter } from "./definitions"
import { commentsRouter } from "./comments"
import { adminRouter } from "./admin"
import { termsRouter } from "./terms"
import { refinementsRouter } from "./refinements"
import { z } from "zod"
import { db, definitionsTable, termsTable, usersTable } from "@yamz/db"
import { desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm"
import { authenticatedProcedure } from "../procedures"
import { votesRouter } from "./votes"

export const appRouter = createTRPCRouter({
  tags: tagsRouter,
  user: userRouter,
  definitions: definitionsRouter,
  refinements: refinementsRouter,
  votes: votesRouter,
  terms: termsRouter,
  comments: commentsRouter,
  admin: adminRouter,
  me: authenticatedProcedure.query(async ({ ctx }) => {
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, ctx.userId)
    })

    return user
  }),
  logout: baseProcedure.mutation(async ({ ctx }) => {
    ctx.session.destroy()
    await ctx.session.save()

    return { ok: true }
  }),
  search: {
    terms: baseProcedure
      .input(
        z
          .object({ query: z.string(), limit: z.number().default(10) })
          .optional()
      )
      .query(async ({ input }) => {
        const { query, limit } = input || { query: "", limit: 10 }

        const results = await db
          .select({
            ...getTableColumns(termsTable),
            count: sql<number>`count(*)`.as("count")
          })
          .from(termsTable)
          .rightJoin(
            definitionsTable,
            eq(termsTable.id, definitionsTable.termId)
          )
          .where(ilike(termsTable.term, `%${query}%`))
          .limit(limit)
          .groupBy(termsTable.id)

        return results
      }),
    definitions: baseProcedure
      .input(
        z
          .object({ query: z.string(), limit: z.number().default(10) })
          .optional()
      )
      .query(async ({ input }) => {
        const { query, limit } = input || { query: "", limit: 10 }

        const results = await db
          .select({
            ...getTableColumns(definitionsTable),
            isAi: usersTable.isAi,
            term: termsTable.term
          })
          .from(termsTable)
          .innerJoin(
            definitionsTable,
            eq(termsTable.id, definitionsTable.termId)
          )
          .innerJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
          .where(or(ilike(definitionsTable.definition, `%${query}%`)))
          .limit(limit)
          .orderBy(desc(definitionsTable.createdAt))

        return results
      }),
    all: baseProcedure
      .input(
        z
          .object({ query: z.string(), limit: z.number().default(10) })
          .optional()
      )
      .query(async ({ input }) => {
        const { query, limit } = input || { query: "", limit: 10 }

        const results = await db
          .select()
          .from(termsTable)
          .innerJoin(
            definitionsTable,
            eq(termsTable.id, definitionsTable.termId)
          )
          .where(
            or(
              ilike(termsTable.term, `%${query}%`),
              ilike(definitionsTable.definition, `%${query}%`)
            )
          )
          .limit(limit)
          .orderBy(desc(definitionsTable.createdAt))

        return results
      })
  }
})

// export type definition of API
export type AppRouter = typeof appRouter
