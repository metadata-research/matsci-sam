import { z } from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import { authenticatedProcedure } from "../procedures"
import {
  coauthorsTable,
  commentsTable,
  db,
  definitionsTable,
  termsTable,
  usersTable
} from "@yamz/db"
import { desc, eq, inArray, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import {
  OllamaModel,
  RefineSystemPrompt,
  runLLM
} from "@/lib/apis/ollama"
import { GetModelUser } from "@/lib/crud"

/*
 * Feed for the /discussion page: the most-recent terms, each paired with the
 * definition a comment should attach to.
 *
 * Comments target the term's AI definition when it has one, because commenting
 * on an AI definition feeds the model a revision (see comments.create). That is
 * the "dialog with the model" the page is for. Terms with no AI definition fall
 * back to their highest-voted definition, where a comment is an ordinary one.
 */
export const discussionRouter = createTRPCRouter({
  recent: baseProcedure
    .input(
      z.object({ limit: z.number().min(1).max(50).default(8) }).optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 8

      const terms = await db
        .select({
          id: termsTable.id,
          term: termsTable.term,
          slug: termsTable.slug,
          createdAt: termsTable.createdAt
        })
        .from(termsTable)
        .orderBy(desc(termsTable.createdAt))
        .limit(limit)

      const termIds = terms.map((t) => t.id)
      if (termIds.length === 0) return []

      const defs = await db
        .select({
          termId: definitionsTable.termId,
          definitionId: definitionsTable.id,
          definition: definitionsTable.definition,
          example: definitionsTable.example,
          model: definitionsTable.model,
          isAi: usersTable.isAi,
          score: definitionsTable.score,
          comments: sql<number>`(
            SELECT count(*) FROM ${commentsTable}
            WHERE ${commentsTable.definitionId} = ${definitionsTable.id}
          )`
            .mapWith(Number)
            .as("comments")
        })
        .from(definitionsTable)
        .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
        .where(inArray(definitionsTable.termId, termIds))

      // One definition per term to discuss: prefer the AI definition, then the
      // highest score.
      const chosen = new Map<number, (typeof defs)[number]>()
      for (const d of defs) {
        const cur = chosen.get(d.termId)
        const better =
          !cur ||
          (d.isAi && !cur.isAi) ||
          (d.isAi === cur.isAi && d.score > cur.score)
        if (better) chosen.set(d.termId, d)
      }

      // Keep recency order; drop the rare term with no definitions at all.
      return terms
        .map((t) => ({ ...t, def: chosen.get(t.id) ?? null }))
        .filter((t): t is typeof t & { def: NonNullable<typeof t.def> } =>
          Boolean(t.def)
        )
    }),

  /*
   * Single-shot revision suggestion for the discussion page.
   *
   * Deliberately separate from the refinements router: that flow is a
   * multi-round negotiation scoped to a definition's own author
   * (getOwnedOriginal), and refinementsTable has no userId, so two people
   * refining the same definition would collide on round numbers and the
   * "a round is already pending" guard. Here anyone may propose a revision to
   * any definition, so this suggests without persisting; the caller decides.
   */
  suggest: authenticatedProcedure
    .input(
      z.object({ definitionId: z.number(), comment: z.string().nonempty() })
    )
    .mutation(async ({ input: { definitionId, comment } }) => {
      const original = await db.query.definitionsTable.findFirst({
        where: eq(definitionsTable.id, definitionId),
        with: { term: true }
      })

      if (!original)
        throw new TRPCError({ code: "NOT_FOUND", message: "No such definition" })

      const result = await runLLM(
        [
          {
            role: "user",
            content: `<term>\n${original.term.term}\n\n<definition>\n${original.definition}\n\n<example>\n${original.example}`
          },
          { role: "user", content: `<feedback>\n${comment}` }
        ],
        RefineSystemPrompt
      )

      if (!result)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The model returned an invalid response"
        })

      return { ...result, model: OllamaModel }
    }),

  /*
   * Publish an accepted suggestion as a new definition of the same term,
   * derived from the original and credited to the accepting user with the
   * model as coauthor. The comment that prompted it is recorded alongside, so
   * the rationale stays with the discussion.
   */
  acceptSuggestion: authenticatedProcedure
    .input(
      z.object({
        definitionId: z.number(),
        comment: z.string().nonempty(),
        definition: z.string().nonempty(),
        example: z.string().nonempty()
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: { definitionId, comment, definition, example }
      }) => {
        const original = await db.query.definitionsTable.findFirst({
          where: eq(definitionsTable.id, definitionId)
        })

        if (!original)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No such definition"
          })

        const modelUser = await GetModelUser(OllamaModel)

        const created = await db.transaction(async (tx) => {
          await tx.insert(commentsTable).values({
            definitionId,
            userId,
            message: comment
          })

          const [inserted] = await tx
            .insert(definitionsTable)
            .values({
              termId: original.termId,
              authorId: userId,
              definition,
              example,
              model: OllamaModel,
              prompt: RefineSystemPrompt,
              refinedFromId: original.id,
              createdVia: "interactive"
            })
            .returning()

          await tx
            .insert(coauthorsTable)
            .values({ definitionId: inserted.id, userId: modelUser.id })

          return inserted
        })

        revalidatePath("/discussion")
        revalidatePath(`/definition/${created.id}`)

        return created
      }
    )
})
