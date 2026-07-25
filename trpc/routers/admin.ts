import {
  chatsTable,
  commentsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  feedbackStatusEnum,
  refinementsTable,
  siteFeedbackTable,
  termsTable,
  userRoleEnum,
  usersTable,
  votesTable
} from "@yamz/db"
import { wolframConfigured, wolframQuery } from "@/lib/apis/wolfram"
import { buildTermProvenance } from "@/lib/provenance"
import { createTRPCRouter } from "../init"
import { adminProcedure } from "../procedures"
import { reviseDefinition } from "@/lib/apis/ollama"
import { z } from "zod"
import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import {
  getConfiguredServiceHealth,
  getOllamaHealth,
  getServiceHealth
} from "@/lib/admin/integration-readiness"

export const adminRouter = createTRPCRouter({
  ollama: adminProcedure.query(() => getOllamaHealth()),
  serviceHealth: adminProcedure.query(() => getServiceHealth()),
  feedbackInbox: adminProcedure
    .input(
      z
        .object({
          status: z.enum(["open", "resolved", "all"]).default("open"),
          cursor: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(50)
        })
        .optional()
    )
    .query(async ({ input }) => {
      const status = input?.status ?? "open"
      const limit = input?.limit ?? 50
      const rows = await db.query.siteFeedbackTable.findMany({
        where: and(
          status === "all" ? undefined : eq(siteFeedbackTable.status, status),
          input?.cursor ? lt(siteFeedbackTable.id, input.cursor) : undefined
        ),
        with: {
          author: { columns: { id: true, name: true } },
          resolver: { columns: { id: true, name: true } }
        },
        orderBy: desc(siteFeedbackTable.id),
        limit: limit + 1
      })
      const hasMore = rows.length > limit
      const items = hasMore ? rows.slice(0, limit) : rows

      return {
        items,
        nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null
      }
    }),
  setFeedbackStatus: adminProcedure
    .input(
      z.object({
        feedbackId: z.number().int().positive(),
        status: z.enum(feedbackStatusEnum.enumValues)
      })
    )
    .mutation(async ({ input, ctx }) => {
      const resolved = input.status === "resolved"
      const [updated] = await db
        .update(siteFeedbackTable)
        .set({
          status: input.status,
          resolvedAt: resolved ? sql`now()` : null,
          resolvedByUserId: resolved ? ctx.userId : null
        })
        .where(eq(siteFeedbackTable.id, input.feedbackId))
        .returning({
          id: siteFeedbackTable.id,
          status: siteFeedbackTable.status,
          resolvedAt: siteFeedbackTable.resolvedAt,
          resolvedByUserId: siteFeedbackTable.resolvedByUserId
        })

      if (!updated)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No such feedback submission"
        })

      return updated
    }),
  chats: adminProcedure.input(z.number()).query(async ({ input: termId }) => {
    return await db.query.chatsTable.findMany({
      where: eq(chatsTable.termId, termId),
      with: { author: { columns: { name: true } } },
      orderBy: [asc(chatsTable.createdAt), asc(chatsTable.id)]
    })
  }),
  terms: adminProcedure.query(async () => {
    const chatsQ = db
      .select()
      .from(chatsTable)
      .limit(1)
      .where(eq(chatsTable.termId, termsTable.id))
      .orderBy(desc(chatsTable.createdAt))
      .as("chats")

    const defCountsQ = db
      .select({
        total: sql<number>`count(*)`.mapWith(Number).as("total"),
        ai: sql<number>`count(*) FILTER (WHERE ${usersTable.isAi})`
          .mapWith(Number)
          .as("ai")
      })
      .from(definitionsTable)
      .leftJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
      .where(eq(definitionsTable.termId, termsTable.id))
      .as("defCounts")

    const commentsQ = db
      .select({
        count: sql<number>`count(*)`.mapWith(Number).as("count")
      })
      .from(commentsTable)
      .innerJoin(
        definitionsTable,
        eq(commentsTable.definitionId, definitionsTable.id)
      )
      .where(eq(definitionsTable.termId, termsTable.id))
      .as("termComments")

    const x = await db
      .select({
        id: termsTable.id,
        term: termsTable.term,
        slug: termsTable.slug,
        pending: sql<boolean>`${chatsQ.role} = 'user'`.as("pending"),
        definitions: defCountsQ.total,
        aiDefinitions: defCountsQ.ai,
        comments: commentsQ.count
      })
      .from(termsTable)
      .leftJoinLateral(chatsQ, sql`TRUE`)
      .leftJoinLateral(defCountsQ, sql`TRUE`)
      .leftJoinLateral(commentsQ, sql`TRUE`)
      .orderBy(asc(termsTable.term))

    return x
  }),
  run: adminProcedure.input(z.number()).mutation(async ({ input: termId }) => {
    const { insertedChat } = await reviseDefinition(termId)

    return insertedChat
  }),
  refinementQueue: adminProcedure.query(async () => {
    return await db
      .select({
        id: refinementsTable.id,
        definitionId: refinementsTable.definitionId,
        definitionNumber: definitionsTable.definitionNumber,
        round: refinementsTable.round,
        status: refinementsTable.status,
        createdAt: refinementsTable.createdAt,
        term: termsTable.term,
        termSlug: termsTable.slug,
        authorName: usersTable.name
      })
      .from(refinementsTable)
      .innerJoin(
        definitionsTable,
        eq(refinementsTable.definitionId, definitionsTable.id)
      )
      .innerJoin(termsTable, eq(definitionsTable.termId, termsTable.id))
      .leftJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
      .where(inArray(refinementsTable.status, ["pending", "failed"]))
      .orderBy(desc(refinementsTable.createdAt), desc(refinementsTable.id))
  }),
  provenance: adminProcedure
    .input(z.number())
    .query(async ({ input: termId }) => {
      const provenance = await buildTermProvenance(termId)
      if (!provenance)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such term" })

      return provenance
    }),
  stats: adminProcedure.query(async () => {
    const [terms, definitions, users, votes] = await Promise.all([
      db.$count(termsTable),
      db.$count(definitionsTable),
      db.$count(usersTable),
      db.$count(votesTable)
    ])

    return { terms, definitions, users, votes }
  }),
  overview: adminProcedure.query(async () => {
    const [
      terms,
      definitions,
      people,
      votes,
      chats,
      refinementAttention,
      recentActivity
    ] = await Promise.all([
      db.$count(termsTable),
      db.$count(definitionsTable),
      db.$count(usersTable, eq(usersTable.isAi, false)),
      db.$count(votesTable),
      db
        .select({
          id: chatsTable.id,
          termId: chatsTable.termId,
          role: chatsTable.role
        })
        .from(chatsTable)
        .orderBy(desc(chatsTable.createdAt), desc(chatsTable.id)),
      db
        .select({ status: refinementsTable.status })
        .from(refinementsTable)
        .where(inArray(refinementsTable.status, ["pending", "failed"])),
      db
        .select({
          id: definitionRevisionsTable.id,
          definitionId: definitionRevisionsTable.definitionId,
          definitionNumber: definitionsTable.definitionNumber,
          version: definitionRevisionsTable.version,
          source: definitionRevisionsTable.source,
          model: definitionRevisionsTable.model,
          createdAt: definitionRevisionsTable.createdAt,
          termId: termsTable.id,
          term: termsTable.term,
          slug: termsTable.slug,
          editorName: usersTable.name,
          editorIsAi: usersTable.isAi
        })
        .from(definitionRevisionsTable)
        .innerJoin(
          definitionsTable,
          eq(definitionRevisionsTable.definitionId, definitionsTable.id)
        )
        .innerJoin(termsTable, eq(definitionsTable.termId, termsTable.id))
        .leftJoin(
          usersTable,
          eq(definitionRevisionsTable.editorId, usersTable.id)
        )
        .where(ne(definitionRevisionsTable.source, "legacy"))
        .orderBy(
          desc(definitionRevisionsTable.createdAt),
          desc(definitionRevisionsTable.id)
        )
        .limit(5)
    ])

    const latestTermChats = new Map<number, (typeof chats)[number]>()
    for (const chat of chats)
      if (!latestTermChats.has(chat.termId))
        latestTermChats.set(chat.termId, chat)

    const termThreadsWaiting = Array.from(latestTermChats.values()).filter(
      ({ role }) => role === "user"
    ).length
    const pendingRefinements = refinementAttention.filter(
      ({ status }) => status === "pending"
    ).length
    const failedRefinements = refinementAttention.filter(
      ({ status }) => status === "failed"
    ).length

    return {
      totals: { terms, definitions, people, votes },
      generationAttention: {
        termThreadsWaiting,
        pendingRefinements,
        failedRefinements,
        waiting: termThreadsWaiting + pendingRefinements
      },
      recentActivity
    }
  }),
  integrations: adminProcedure.query(async () => {
    return {
      wolfram: {
        configured: wolframConfigured()
      },
      services: getConfiguredServiceHealth()
    }
  }),
  wolframTest: adminProcedure.mutation(async () => {
    const content = await wolframQuery(
      "What is the melting point of titanium in kelvin? Answer in one sentence."
    )

    return { content }
  }),
  users: adminProcedure.query(async () => {
    return await db.query.usersTable.findMany({
      columns: {
        id: true,
        name: true,
        email: true,
        isAi: true,
        isProfilePublic: true,
        role: true,
        weight: true,
        createdAt: true
      },
      orderBy: asc(usersTable.id)
    })
  }),
  updateUser: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        role: z.enum(userRoleEnum.enumValues).optional(),
        weight: z.number().min(0).optional()
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.userId && input.role && input.role !== "admin")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot remove your own admin access"
        })

      const [updated] = await db
        .update(usersTable)
        .set({ role: input.role, weight: input.weight })
        .where(eq(usersTable.id, input.userId))
        .returning()

      if (!updated)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such user" })

      return { ok: true }
    })
})
