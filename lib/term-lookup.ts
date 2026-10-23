import { vocabularyContentVisible } from "./community-access"
import { db, definitionsTable, termsTable, vocabulariesTable } from "@yamz/db"
import { and, asc, eq, ilike, or, sql } from "drizzle-orm"
import { escapeLike, searchMatch, searchOrderGrouped } from "./search"
import { termIsListed } from "./term-visibility"

type LookupDatabase =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Public, cross-vocabulary suggestions for search and collection pickers. */
export async function lookupTerms(
  input: { query?: string; limit?: number } = {},
  database: LookupDatabase = db,
  viewerId: number | null = null
) {
  const query = input.query?.trim() ?? ""

  return database
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      vocabularySlug: termsTable.vocabularySlug,
      vocabularyTitle: vocabulariesTable.title,
      count: sql<number>`cast(count(*) as int)`.mapWith(Number)
    })
    .from(termsTable)
    .innerJoin(definitionsTable, eq(termsTable.id, definitionsTable.termId))
    .innerJoin(
      vocabulariesTable,
      eq(vocabulariesTable.slug, termsTable.vocabularySlug)
    )
    .where(
      and(
        termIsListed(),
        vocabularyContentVisible(termsTable.vocabularySlug, viewerId),
        query
          ? or(
              // Short prefixes often miss both whole-word FTS and trigram
              // similarity thresholds. Plain-column ILIKE can use the term
              // trigram index without changing the full-search predicate.
              ilike(termsTable.term, `${escapeLike(query)}%`),
              searchMatch(query)
            )
          : undefined
      )
    )
    .groupBy(termsTable.id, vocabulariesTable.slug)
    .orderBy(
      ...(query ? searchOrderGrouped(query) : []),
      asc(termsTable.term),
      asc(vocabulariesTable.title),
      asc(termsTable.id)
    )
    .limit(input.limit ?? 10)
}
