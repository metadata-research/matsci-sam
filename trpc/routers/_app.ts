import { baseProcedure, createTRPCRouter } from "../init"
import { tagsRouter } from "./tags"
import { userRouter } from "./user"
import { definitionsRouter } from "./definitions"
import { commentsRouter } from "./comments"
import { adminRouter } from "./admin"
import { termsRouter } from "./terms"
import { refinementsRouter } from "./refinements"
import { discussionRouter } from "./discussion"
import { z } from "zod"
import { db, definitionsTable, termsTable, usersTable } from "@yamz/db"
import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm"
import { authenticatedProcedure } from "../procedures"
import { votesRouter } from "./votes"
// Match/order machinery shared with the Browse page; see lib/search.ts for
// the full design rationale (FTS + trigram + tiers, index-backed via a
// term-id UNION).
import { searchMatch, searchOrder, searchOrderGrouped } from "@/lib/search"

export const appRouter = createTRPCRouter({
  tags: tagsRouter,
  user: userRouter,
  definitions: definitionsRouter,
  refinements: refinementsRouter,
  votes: votesRouter,
  terms: termsRouter,
  comments: commentsRouter,
  admin: adminRouter,
  discussion: discussionRouter,
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
          // An empty query is a browse, not a search: websearch_to_tsquery("")
          // matches nothing, so skip the predicate entirely and list terms
          // alphabetically. The homepage and the unfiltered /terms page both
          // rely on this.
          .where(query.trim() ? searchMatch(query) : undefined)
          .limit(limit)
          .groupBy(termsTable.id)
          .orderBy(
            ...(query.trim()
              ? [...searchOrderGrouped(query), asc(termsTable.term)]
              : [asc(termsTable.term)])
          )

        return results
      }),
    definitions: baseProcedure
      .input(
        z
          .object({
            query: z.string(),
            limit: z.number().default(10),
            // Author filter for the /search filter panel. Applied in SQL rather
            // than on the returned rows, so it narrows before LIMIT -- filtering
            // client-side would silently drop matches past the limit.
            author: z.enum(["all", "human", "ai"]).default("all")
          })
          .optional()
      )
      .query(async ({ input }) => {
        const { query, limit, author } = input || {
          query: "",
          limit: 10,
          author: "all" as const
        }

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
          // Empty query keeps the newest-first browse the homepage prefetches.
          .where(
            and(
              query.trim() ? searchMatch(query) : undefined,
              author === "all"
                ? undefined
                : eq(usersTable.isAi, author === "ai")
            )
          )
          .limit(limit)
          .orderBy(
            ...(query.trim()
              ? [...searchOrder(query), desc(definitionsTable.createdAt)]
              : [desc(definitionsTable.createdAt)])
          )

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
          // Empty query keeps the newest-first browse the homepage prefetches.
          .where(query.trim() ? searchMatch(query) : undefined)
          .limit(limit)
          .orderBy(
            ...(query.trim()
              ? [...searchOrder(query), desc(definitionsTable.createdAt)]
              : [desc(definitionsTable.createdAt)])
          )

        return results
      })
  }
})

// export type definition of API
export type AppRouter = typeof appRouter
