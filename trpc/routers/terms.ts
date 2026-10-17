import { db, termsTable, vocabulariesTable } from "@yamz/db"
import { baseProcedure, createTRPCRouter } from "../init"
import { z } from "zod"
import { buildTermProvenance } from "@/lib/provenance"
import { activeCommunityFor } from "@/lib/community-queries"
import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"
import { asc, eq } from "drizzle-orm"
import { termIsListed } from "@/lib/term-visibility"
import { TRPCError } from "@trpc/server"
import { requireSetupVocabularyForContribution } from "@/lib/setup-service"

export const termsRouter = createTRPCRouter({
  // Public read-only PROV-O view. Voter identities are withheld (the admin
  // endpoint admin.provenance keeps full detail)
  provenance: baseProcedure
    .input(z.number())
    .query(async ({ input: termId }) =>
      buildTermProvenance(termId, { anonymizeVoters: true })
    ),
  list: baseProcedure
    .input(
      z.object({ vocabularySlug: z.string().trim().min(1).max(200) }).optional()
    )
    .query(async ({ ctx: { userId }, input }) => {
      if (input?.vocabularySlug) {
        if (!userId)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Sign in to choose a contribution vocabulary."
          })
        await requireSetupVocabularyForContribution(
          db,
          input.vocabularySlug,
          userId
        )
      }
      const active =
        !input?.vocabularySlug && userId
          ? await activeCommunityFor(db, userId)
          : null
      const targetVocabularySlug =
        input?.vocabularySlug ??
        active?.vocabularySlug ??
        DEFAULT_VOCABULARY_SLUG

      const [terms, targetVocabulary] = await Promise.all([
        db
          .select({
            value: termsTable.term,
            id: termsTable.id,
            slug: termsTable.slug,
            vocabularySlug: termsTable.vocabularySlug,
            vocabularyTitle: vocabulariesTable.title
          })
          .from(termsTable)
          .innerJoin(
            vocabulariesTable,
            eq(vocabulariesTable.slug, termsTable.vocabularySlug)
          )
          .where(termIsListed())
          .orderBy(asc(termsTable.term), asc(vocabulariesTable.title)),
        db.query.vocabulariesTable.findFirst({
          columns: { slug: true, title: true, isDefault: true },
          where: eq(vocabulariesTable.slug, targetVocabularySlug)
        })
      ])

      if (!targetVocabulary)
        throw new Error("The contribution vocabulary is not configured")

      return { terms, targetVocabulary }
    })
})
