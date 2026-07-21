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
  tagsToDefinitions,
  refinementsTable,
  coauthorsTable
} from "@yamz/db"
import { and, desc, eq, getTableColumns, like, sql } from "drizzle-orm"
import { slugify, uniqueSlug } from "@/lib/slug"
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
        examples: z.string().nonempty("You must give an example"),
        // The interactive add flow: no term-level auto-AI definition; the
        // author refines their own definition on the definition page instead
        interactive: z.boolean().default(false)
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
          // First time this term has been defined, so create it -- with its
          // public slug. Distinct terms can normalize to the same slug
          // ("Band Gap" vs "band gap"), so check what is taken and let
          // uniqueSlug() number the collision the way OED numbers homographs.
          // Read inside the transaction so a concurrent insert cannot slip a
          // colliding slug in between; the unique index is the backstop.
          const conflicting = await tx
            .select({ slug: termsTable.slug })
            .from(termsTable)
            .where(like(termsTable.slug, `${slugify(term)}%`))

          const [insertedTerm] = await tx
            .insert(termsTable)
            .values({
              term,
              slug: uniqueSlug(term, new Set(conflicting.map((c) => c.slug)))
            })
            .returning()

          if (!input.interactive) {
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
          }

          dbTerm = insertedTerm
        }

        const [insertedDefinition] = await tx
          .insert(definitionsTable)
          .values({
            termId: dbTerm.id,
            authorId,
            definition: input.definition,
            example: input.examples,
            createdVia: input.interactive ? "interactive" : "classic"
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
          termSlug: termsTable.slug,
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
      if (!def) return def

      // Additional authors (the model, for accepted AI refinements)
      const coauthors = await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          isAi: usersTable.isAi
        })
        .from(coauthorsTable)
        .innerJoin(usersTable, eq(usersTable.id, coauthorsTable.userId))
        .where(eq(coauthorsTable.definitionId, def.id))

      // The AI-refined version derived from this definition, if any
      const refinedVersion = await db.query.definitionsTable.findFirst({
        columns: { id: true },
        where: eq(definitionsTable.refinedFromId, def.id)
      })

      return { ...def, coauthors, refinedVersionId: refinedVersion?.id ?? null }
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
          author: usersTable.name,
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
        // Highest voted first, newest breaking ties. The tiebreak matters:
        // score alone left equal-scored definitions in whatever order the
        // planner returned, so the one shown first -- the term's default --
        // could change between requests.
        .orderBy(desc(definitionsTable.score), desc(definitionsTable.createdAt))

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
        // everything that references a single definition row
        const deleteDefinitionRows = async (id: number) => {
          await tx
            .delete(commentsTable)
            .where(eq(commentsTable.definitionId, id))

          await tx.delete(votesTable).where(eq(votesTable.definitionId, id))

          await tx.delete(editsTable).where(eq(editsTable.definitionId, id))

          await tx
            .delete(tagsToDefinitions)
            .where(eq(tagsToDefinitions.definitionId, id))

          await tx
            .delete(refinementsTable)
            .where(eq(refinementsTable.definitionId, id))

          await tx
            .delete(coauthorsTable)
            .where(eq(coauthorsTable.definitionId, id))

          const [deleted] = await tx
            .delete(definitionsTable)
            .where(eq(definitionsTable.id, id))
            .returning()

          return deleted
        }

        // refined versions reference their original via refinedFromId, so
        // they must go first
        const refinedChildren = await tx.query.definitionsTable.findMany({
          where: eq(definitionsTable.refinedFromId, definitionId)
        })
        for (const child of refinedChildren)
          await deleteDefinitionRows(child.id)

        const deletedDef = await deleteDefinitionRows(definitionId)

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
