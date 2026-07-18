import { chatsTable, db, definitionsTable, termsTable, usersTable } from "@yamz/db";
import { createTRPCRouter } from "../init";
import { adminProcedure } from "../procedures";
import { ollama, OllamaModel, reviseDefinition } from "@/lib/apis/ollama";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";

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

    const aiDefQ = db
      .select({ model: definitionsTable.model })
      .from(definitionsTable)
      .innerJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
      .limit(1)
      .where(and(eq(definitionsTable.termId, termsTable.id), eq(usersTable.isAi, true)))
      .as("aiDef");

    const x = await db
      .select({
        id: termsTable.id,
        term: termsTable.term,
        pending: sql<boolean>`${chatsQ.role} = 'user'`.as("pending"),
        model: aiDefQ.model,
      })
      .from(termsTable)
      .leftJoinLateral(chatsQ, sql`TRUE`)
      .leftJoinLateral(aiDefQ, sql`TRUE`);

    return x;
  }),
  run: adminProcedure.input(z.number()).mutation(async ({ input: termId }) => {
    const { insertedChat } = await reviseDefinition(termId)

    return insertedChat;
  }),
});
