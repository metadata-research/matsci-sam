import { z } from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import {
  db,
  termsTable,
  votesTable,
  definitionsTable,
  editsTable,
  chatsTable,
  usersTable,
  commentsTable,
  tagsTable,
  tagsToDefinitions
} from "@yamz/db"
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm"
import { adminProcedure, authenticatedProcedure } from "../procedures"
import { revalidatePath } from "next/cache"
import { reviseDefinition } from "@/lib/apis/ollama"
import { after } from "next/server"

export const definitionsRouter = createTRPCRouter({
  create: authenticatedProcedure
    .input(
      z.object({
        term: z.string().nonempty("Term is required"),
        definition: z.string().nonempty("You must give a definition"),
        examples: z.string().nonempty("You must give an example")
      })
    )
    .mutation(async ({ ctx: { userId: authorId }, input }) => {
      const { term, definition } = await db.transaction(async (tx) => {
        // normalize the term
        const term = input.term.trim().toLowerCase()

        let dbTerm = await tx.query.termsTable.findFirst({
          where: eq(termsTable.term, term)
        })
        if (!dbTerm) {
          //first time term has been defined, so create it
          const [insertedTerm] = await tx
            .insert(termsTable)
            .values({ term })
            .returning()

          // insert the ai chat
          await tx.insert(chatsTable).values({
            role: "user",
            userId: authorId,
            message: `<term>\n${term}\n<example>\n${input.examples}`,
            termId: insertedTerm.id
          })

          after(() => {
            // Automatically create AI definition on new term creation
            reviseDefinition(insertedTerm.id)
          })

          dbTerm = insertedTerm
        }

        const [insertedDefinition] = await tx
          .insert(definitionsTable)
          .values({
            termId: dbTerm.id,
            authorId,
            definition: input.definition,
            example: input.examples
          })
          .returning()

        return { term: dbTerm, definition: insertedDefinition }
      })

      revalidatePath("/terms")
      revalidatePath(`/terms/${term.id}`)

      return { term, definition }
    }),
  edit: authenticatedProcedure
    .input(
      z.object({
        id: z.number(),
        definition: z.string(),
        example: z.string()
      })
    )
    .mutation(
      async ({ ctx: { userId }, input: { id, definition, example } }) => {
        const res = await db.transaction(async (tx) => {
          const where = and(
            eq(definitionsTable.authorId, userId),
            eq(definitionsTable.id, id)
          )

          // find the old definition
          const def = await db.query.definitionsTable.findFirst({
            where
          })

          if (!def) throw new Error("Definition doesn't exist")

          // update it
          const [updatedDef] = await tx
            .update(definitionsTable)
            .set({ definition, example })
            .where(where)
            .returning()

          await db.insert(editsTable).values({
            definitionId: def.id,
            definition: def.definition,
            newDefinition: definition
          })

          return updatedDef
        })

        return res
      }
    ),
  get: baseProcedure
    .input(z.object({ definitionId: z.number() }))
    .query(async ({ ctx: { userId }, input: { definitionId } }) => {
      const definitionsQuery = db
        .select({
          ...getTableColumns(definitionsTable),
          author: {
            name: usersTable.name,
            isAi: usersTable.isAi
          },
          term: termsTable.term,
          vote: userId
            ? sql<"up" | "down" | null>`${votesTable.kind}`.as("vote")
            : sql<"up" | "down" | null>`null`.as("vote")
        })
        .from(definitionsTable)
        .where(eq(definitionsTable.id, definitionId))
        .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
        .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))

      if (userId)
        definitionsQuery.leftJoin(
          votesTable,
          and(
            eq(votesTable.userId, userId),
            eq(votesTable.definitionId, definitionsTable.id)
          )
        )

      const [def] = await definitionsQuery

      return def
    }),
  mine: authenticatedProcedure.query(async ({ ctx: { userId } }) => {
    const definitionsQuery = db.query.definitionsTable.findMany({
      where: eq(definitionsTable.authorId, userId),
      with: { term: true },
      orderBy: desc(definitionsTable.createdAt)
    })

    return await definitionsQuery
  }),
  list: baseProcedure
    .input(z.object({ termId: z.number() }))
    .query(async ({ ctx: { userId }, input: { termId } }) => {
      const definitionsQuery = db
        .select({
          ...getTableColumns(definitionsTable),
          isAi: usersTable.isAi,
          comments: sql<number>`(SELECT count(*) FROM ${commentsTable} WHERE ${commentsTable.definitionId} = ${definitionsTable.id})`
            .mapWith(Number)
            .as("comments"),
          vote: userId
            ? sql<"up" | "down" | null>`${votesTable.kind}`.as("vote")
            : sql<"up" | "down" | null>`null`.as("vote")
        })
        .from(definitionsTable)
        .where(and(eq(definitionsTable.termId, termId)))
        .innerJoin(usersTable, eq(definitionsTable.authorId, usersTable.id))
        .orderBy(desc(definitionsTable.score))

      if (userId)
        definitionsQuery.leftJoin(
          votesTable,
          and(
            eq(votesTable.userId, userId),
            eq(votesTable.definitionId, definitionsTable.id)
          )
        )

      return await definitionsQuery
    }),
  delete: adminProcedure
    .input(z.number())
    .mutation(async ({ input: definitionId }) => {
      // start a tx so if something fails, everything will get restored
      return await db.transaction(async (tx) => {
        await tx
          .delete(commentsTable)
          .where(eq(commentsTable.definitionId, definitionId))

        await tx
          .delete(votesTable)
          .where(eq(votesTable.definitionId, definitionId))

        await tx
          .delete(editsTable)
          .where(eq(editsTable.definitionId, definitionId))

        await tx
          .delete(tagsToDefinitions)
          .where(eq(tagsToDefinitions.definitionId, definitionId))

        const [deletedDef] = await tx
          .delete(definitionsTable)
          .where(eq(definitionsTable.id, definitionId))
          .returning()

        // check if there exists any other definitions
        const otherDef = await tx.query.definitionsTable.findFirst({
          where: eq(definitionsTable.termId, deletedDef.termId)
        })

        // if there arent, delete the term as well so that a new
        // AI def will be created when its redefined
        if (!otherDef) {
          await tx
            .delete(chatsTable)
            .where(eq(chatsTable.termId, deletedDef.termId))

          await tx
            .delete(termsTable)
            .where(eq(termsTable.id, deletedDef.termId))
        }

        return deletedDef
      })
    })
})
