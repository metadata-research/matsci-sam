import { baseProcedure, createTRPCRouter } from "../init"
import { collectionsRouter } from "./collections"
import { communitiesRouter } from "./communities"
import { tagsRouter } from "./tags"
import { userRouter } from "./user"
import { definitionsRouter } from "./definitions"
import { commentsRouter } from "./comments"
import { feedbackRouter } from "./feedback"
import { adminRouter } from "./admin"
import { termsRouter } from "./terms"
import { discussionRouter } from "./discussion"
import { surveysRouter } from "./surveys"
import { examplesRouter } from "./examples"
import { aiAssistRouter } from "./ai-assist"
import { z } from "zod"
import {
  aiModelsTable,
  commentsTable,
  conceptSchemesTable,
  conceptsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  statementsTable,
  termsTable,
  usersTable,
  vocabulariesTable,
  votesTable
} from "@yamz/db"
import { and, asc, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm"
import { authenticatedProcedure } from "../procedures"
import { votesRouter } from "./votes"
// Match/order machinery shared with the Browse page; see lib/search.ts for
// the full design rationale (FTS + trigram + tiers, index-backed via a
// term-id UNION).
import {
  definitionMatchHeadline,
  definitionMatchSource,
  definitionSearchMatch,
  facetTermScope,
  searchMatch,
  searchFacetKey,
  searchOrder,
  searchOrderGrouped,
  termFacets,
  termMatchHeadlineGrouped,
  termMatchSourceGrouped
} from "@/lib/search"
import {
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_RESULT_MAX_LIMIT
} from "@/lib/input-limits"
import { currentFeaturedExampleText } from "@/lib/definition-example-queries"
import {
  parseSearchHeadline,
  type SearchMatchSource
} from "@/lib/search-evidence"

const searchQuerySchema = z.string().trim().max(SEARCH_QUERY_MAX_LENGTH)
const searchLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(SEARCH_RESULT_MAX_LIMIT)
  .default(10)
const searchFacetKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*:[a-z0-9][a-z0-9_-]*$/)
const searchFacetsSchema = z.array(searchFacetKeySchema).max(20).default([])

export const appRouter = createTRPCRouter({
  tags: tagsRouter,
  collections: collectionsRouter,
  communities: communitiesRouter,
  user: userRouter,
  definitions: definitionsRouter,
  votes: votesRouter,
  terms: termsRouter,
  comments: commentsRouter,
  feedback: feedbackRouter,
  admin: adminRouter,
  discussion: discussionRouter,
  surveys: surveysRouter,
  examples: examplesRouter,
  aiAssist: aiAssistRouter,
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
          .object({
            query: searchQuerySchema,
            limit: searchLimitSchema,
            facets: searchFacetsSchema
          })
          .optional()
      )
      .query(async ({ input }) => {
        const { query = "", limit = 10, facets = [] } = input ?? {}
        const hasQuery = query.trim().length > 0

        const results = await db
          .select({
            ...getTableColumns(termsTable),
            vocabularyTitle: vocabulariesTable.title,
            facets: termFacets().as("facets"),
            matchSource: hasQuery
              ? termMatchSourceGrouped(query).as("matchSource")
              : sql<SearchMatchSource | null>`null`.as("matchSource"),
            matchHeadline: hasQuery
              ? termMatchHeadlineGrouped(query).as("matchHeadline")
              : sql<string | null>`null`.as("matchHeadline"),
            count: sql<number>`cast(count(*) as int)`
              .mapWith(Number)
              .as("count")
          })
          .from(termsTable)
          .innerJoin(
            definitionsTable,
            eq(termsTable.id, definitionsTable.termId)
          )
          .innerJoin(
            vocabulariesTable,
            eq(vocabulariesTable.slug, termsTable.vocabularySlug)
          )
          // An empty query is a browse, not a search: websearch_to_tsquery("")
          // matches nothing, so skip the predicate entirely and list terms
          // alphabetically. The homepage and the unfiltered /terms page both
          // rely on this.
          .where(
            and(
              hasQuery ? searchMatch(query) : undefined,
              facetTermScope(facets)
            )
          )
          .limit(limit)
          .groupBy(termsTable.id, vocabulariesTable.slug)
          .orderBy(
            ...(query.trim()
              ? [...searchOrderGrouped(query), asc(termsTable.term)]
              : [asc(termsTable.term)])
          )

        return results.map(({ matchSource, matchHeadline, ...result }) => ({
          ...result,
          matchEvidence:
            matchSource && matchHeadline
              ? {
                  source: matchSource,
                  parts: parseSearchHeadline(matchHeadline)
                }
              : null
        }))
      }),
    // Collection membership can reference any hosted vocabulary. Keep this
    // lookup deliberately global and lightweight rather than coupling the
    // collection picker to the richer search-results payload.
    termLookup: baseProcedure
      .input(
        z
          .object({ query: searchQuerySchema, limit: searchLimitSchema })
          .optional()
      )
      .query(async ({ input }) => {
        const { query = "", limit = 10 } = input ?? {}

        return await db
          .select({
            id: termsTable.id,
            term: termsTable.term,
            slug: termsTable.slug,
            vocabularySlug: termsTable.vocabularySlug,
            vocabularyTitle: vocabulariesTable.title,
            count: sql<number>`cast(count(*) as int)`.mapWith(Number)
          })
          .from(termsTable)
          .innerJoin(
            definitionsTable,
            eq(termsTable.id, definitionsTable.termId)
          )
          .innerJoin(
            vocabulariesTable,
            eq(vocabulariesTable.slug, termsTable.vocabularySlug)
          )
          .where(query.trim() ? searchMatch(query) : undefined)
          .groupBy(termsTable.id, vocabulariesTable.slug)
          .orderBy(
            ...(query.trim()
              ? [...searchOrderGrouped(query), asc(termsTable.term)]
              : [asc(termsTable.term)])
          )
          .limit(limit)
      }),
    facets: baseProcedure
      .input(z.object({ query: searchQuerySchema }).optional())
      .query(async ({ input }) => {
        const query = input?.query ?? ""

        return await db
          .select({
            id: conceptsTable.id,
            key: searchFacetKey.as("key"),
            name: conceptsTable.prefLabel,
            slug: conceptsTable.slug,
            schemeSlug: conceptSchemesTable.slug,
            schemeTitle: conceptSchemesTable.title,
            count: sql<number>`cast(count(distinct ${termsTable.id}) as int)`
              .mapWith(Number)
              .as("count")
          })
          .from(conceptsTable)
          .innerJoin(
            conceptSchemesTable,
            eq(conceptSchemesTable.id, conceptsTable.schemeId)
          )
          .leftJoin(
            statementsTable,
            and(
              eq(statementsTable.objectConceptId, conceptsTable.id),
              eq(statementsTable.predicate, "dcterms:subject"),
              isNull(statementsTable.retractedAt)
            )
          )
          .leftJoin(
            termsTable,
            and(
              eq(termsTable.id, statementsTable.subjectTermId),
              query.trim() ? searchMatch(query) : undefined
            )
          )
          .where(
            and(
              eq(conceptSchemesTable.attachesAt, "term"),
              eq(conceptsTable.status, "approved")
            )
          )
          .groupBy(conceptsTable.id, conceptSchemesTable.id)
          .orderBy(asc(conceptSchemesTable.id), asc(conceptsTable.id))
      }),
    definitions: baseProcedure
      .input(
        z
          .object({
            query: searchQuerySchema,
            limit: searchLimitSchema,
            // Author filter for the /search filter panel. Applied in SQL rather
            // than on the returned rows, so it narrows before LIMIT -- filtering
            // client-side would silently drop matches past the limit.
            author: z.enum(["all", "human", "ai"]).default("all"),
            facets: searchFacetsSchema
          })
          .optional()
      )
      .query(async ({ ctx: { userId }, input }) => {
        const {
          query = "",
          limit = 10,
          author = "all" as const,
          facets = []
        } = input ?? {}
        const hasQuery = query.trim().length > 0

        // Comment count and viewer vote mirror definitions.list, so the same
        // Definition card offers the same options here as on a term page.
        const resultsQuery = db
          .select({
            ...getTableColumns(definitionsTable),
            example: currentFeaturedExampleText().as("example"),
            revisionId: definitionRevisionsTable.id,
            version: definitionRevisionsTable.version,
            isAi: usersTable.isAi,
            author: usersTable.name,
            authorProfilePublic: usersTable.isProfilePublic,
            authorModelSlug: aiModelsTable.slug,
            term: termsTable.term,
            termSlug: termsTable.slug,
            termVocabularySlug: termsTable.vocabularySlug,
            termVocabularyTitle: vocabulariesTable.title,
            facets: termFacets().as("facets"),
            matchSource: hasQuery
              ? definitionMatchSource(query).as("matchSource")
              : sql<SearchMatchSource | null>`null`.as("matchSource"),
            matchHeadline: hasQuery
              ? definitionMatchHeadline(query).as("matchHeadline")
              : sql<string | null>`null`.as("matchHeadline"),
            comments:
              sql<number>`(SELECT count(*) FROM ${commentsTable} WHERE ${commentsTable.definitionId} = ${definitionsTable.id})`
                .mapWith(Number)
                .as("comments"),
            vote: userId
              ? sql<"up" | "down" | null>`${votesTable.kind}`.as("vote")
              : sql<"up" | "down" | null>`null`.as("vote")
          })
          .from(termsTable)
          .innerJoin(
            definitionsTable,
            eq(termsTable.id, definitionsTable.termId)
          )
          .innerJoin(
            vocabulariesTable,
            eq(vocabulariesTable.slug, termsTable.vocabularySlug)
          )
          .innerJoin(
            definitionRevisionsTable,
            eq(definitionRevisionsTable.id, definitionsTable.currentRevisionId)
          )
          .innerJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
          // A model author carries its own identity row.
          .leftJoin(aiModelsTable, eq(aiModelsTable.userId, usersTable.id))
          // Empty query keeps the newest-first browse the homepage prefetches.
          .where(
            and(
              hasQuery ? definitionSearchMatch(query) : undefined,
              facetTermScope(facets),
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

        if (userId)
          resultsQuery.leftJoin(
            votesTable,
            and(
              eq(votesTable.userId, userId),
              eq(votesTable.revisionId, definitionRevisionsTable.id)
            )
          )

        const results = await resultsQuery
        return results.map(({ matchSource, matchHeadline, ...result }) => ({
          ...result,
          matchEvidence:
            matchSource && matchHeadline
              ? {
                  source: matchSource,
                  parts: parseSearchHeadline(matchHeadline)
                }
              : null
        }))
      }),
    all: baseProcedure
      .input(
        z
          .object({ query: searchQuerySchema, limit: searchLimitSchema })
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
