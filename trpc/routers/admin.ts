import { chatsTable, commentsTable, db, definitionsTable, termsTable, userRoleEnum, usersTable, votesTable } from "@yamz/db";
import { wolframConfigured, wolframMaskedKey, wolframQuery } from "@/lib/apis/wolfram";
import { createTRPCRouter } from "../init";
import { adminProcedure } from "../procedures";
import { ollama, OllamaModel, reviseDefinition } from "@/lib/apis/ollama";
import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const adminRouter = createTRPCRouter({
  ollama: adminProcedure.query(async () => {
    const response = await ollama.show({ model: OllamaModel })
      .then(model => ({ ok: true as const, model }))
      .catch(err => ({ ok: false as const, message: String(err) }))

    return response
  }),
  chats: adminProcedure.input(z.number()).query(async ({ input: termId }) => {
    return await db.query.chatsTable.findMany({
      where: eq(chatsTable.termId, termId),
    });
  }),
  terms: adminProcedure.query(async () => {
    const chatsQ = db
      .select()
      .from(chatsTable)
      .limit(1)
      .where(eq(chatsTable.termId, termsTable.id))
      .orderBy(desc(chatsTable.createdAt))
      .as("chats");

    const defCountsQ = db
      .select({
        total: sql<number>`count(*)`.mapWith(Number).as("total"),
        ai: sql<number>`count(*) FILTER (WHERE ${usersTable.isAi})`
          .mapWith(Number)
          .as("ai"),
      })
      .from(definitionsTable)
      .leftJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
      .where(eq(definitionsTable.termId, termsTable.id))
      .as("defCounts");

    const commentsQ = db
      .select({
        count: sql<number>`count(*)`.mapWith(Number).as("count"),
      })
      .from(commentsTable)
      .innerJoin(
        definitionsTable,
        eq(commentsTable.definitionId, definitionsTable.id),
      )
      .where(eq(definitionsTable.termId, termsTable.id))
      .as("termComments");

    const x = await db
      .select({
        id: termsTable.id,
        term: termsTable.term,
        pending: sql<boolean>`${chatsQ.role} = 'user'`.as("pending"),
        definitions: defCountsQ.total,
        aiDefinitions: defCountsQ.ai,
        comments: commentsQ.count,
      })
      .from(termsTable)
      .leftJoinLateral(chatsQ, sql`TRUE`)
      .leftJoinLateral(defCountsQ, sql`TRUE`)
      .leftJoinLateral(commentsQ, sql`TRUE`);

    return x;
  }),
  run: adminProcedure.input(z.number()).mutation(async ({ input: termId }) => {
    const { insertedChat } = await reviseDefinition(termId)

    return insertedChat;
  }),
  stats: adminProcedure.query(async () => {
    const [terms, definitions, users, votes] = await Promise.all([
      db.$count(termsTable),
      db.$count(definitionsTable),
      db.$count(usersTable),
      db.$count(votesTable),
    ]);

    return { terms, definitions, users, votes };
  }),
  integrations: adminProcedure.query(async () => {
    return {
      wolfram: {
        configured: wolframConfigured(),
        maskedKey: wolframMaskedKey(),
      },
    };
  }),
  wolframTest: adminProcedure.mutation(async () => {
    const content = await wolframQuery(
      "What is the melting point of titanium in kelvin? Answer in one sentence.",
    );

    return { content };
  }),
  users: adminProcedure.query(async () => {
    return await db.query.usersTable.findMany({
      columns: {
        id: true,
        name: true,
        email: true,
        isAi: true,
        role: true,
        weight: true,
        createdAt: true,
      },
      orderBy: asc(usersTable.id),
    });
  }),
  updateUser: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        role: z.enum(userRoleEnum.enumValues).optional(),
        weight: z.number().min(0).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.userId && input.role && input.role !== "admin")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot remove your own admin access",
        });

      const [updated] = await db
        .update(usersTable)
        .set({ role: input.role, weight: input.weight })
        .where(eq(usersTable.id, input.userId))
        .returning();

      if (!updated)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such user" });

      return { ok: true };
    }),
});
