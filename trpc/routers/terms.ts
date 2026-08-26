import { db, termsTable, vocabulariesTable } from "@yamz/db"
import { baseProcedure, createTRPCRouter } from "../init"
import { z } from "zod"
import { buildTermProvenance } from "@/lib/provenance"
import { activeCommunityFor } from "@/lib/community-queries"
import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"
import { asc, eq } from "drizzle-orm"

export const termsRouter = createTRPCRouter({
  // Public read-only PROV-O view; voter identities are withheld (the admin
  // endpoint admin.provenance keeps full detail)
  provenance: baseProcedure
    .input(z.number())
    .query(async ({ input: termId }) =>
      buildTermProvenance(termId, { anonymizeVoters: true })
    ),
  list: baseProcedure.query(async ({ ctx: { userId } }) => {
    const active = userId ? await activeCommunityFor(db, userId) : null
    const targetVocabularySlug =
      active?.vocabularySlug ?? DEFAULT_VOCABULARY_SLUG

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
