import { definitionsTable, termsTable } from "@yamz/db"
import { desc, sql } from "drizzle-orm"

/*
 * Search is full-text (see migration 0013), designed to stay useful as the
 * vocabulary grows. Three signals combine:
 *
 *   1. Full-text over term names, definition bodies, and examples. The
 *      expressions below are byte-identical to the indexed ones, which is what
 *      lets Postgres use the GIN indexes.
 *   2. Trigram similarity on term names, which catches typos and partial words
 *      that full-text misses -- FTS matches whole lexemes, so "austenit" finds
 *      nothing without it.
 *   3. Exact/prefix tiers on the term name, so typing a term's exact name puts
 *      it first regardless of how the statistical ranking falls out.
 *
 * Matching is term-centric: the match set is a UNION of term ids, one branch
 * per signal, so each branch can use its own GIN index (a single OR spanning
 * the terms/definitions join cannot be index-backed -- Postgres cannot
 * bitmap-OR across tables). A term matches if its name matches by full text
 * or trigram, or if any of its definitions matches by body or example; every
 * definition of a matching term is then in scope, with ranking putting the
 * actually-matching definitions first.
 *
 * Term names outrank definition bodies because the ranked vector applies weight
 * 'A' to the term and the definition vector is stored at 'B'/'C'. ts_rank's
 * default weight array ({0.1, 0.2, 0.4, 1.0} for D,C,B,A) does the rest, so
 * relative importance lives in the weights rather than in hand-tuned
 * multipliers.
 */

// `%` and `_` are LIKE metacharacters. The query is parameterized, but the
// pattern it lands in is still interpreted, so a typed `_` would act as a
// single-character wildcard. Backslash is LIKE's default escape character.
export const escapeLike = (value: string) =>
  value.replace(/[\\%_]/g, (c) => `\\${c}`)

// Must match migration 0013's indexed expressions exactly.
const termVector = sql`to_tsvector('english', ${termsTable.term})`
const definitionVector = sql`(setweight(to_tsvector('english', ${definitionsTable.definition}), 'B') || setweight(to_tsvector('english', ${definitionsTable.example}), 'C'))`

// websearch_to_tsquery never throws on user input -- it handles quoted phrases,
// OR, and leading `-`, and degrades to an empty query rather than erroring on
// punctuation soup. plainto_tsquery would drop the operators; to_tsquery throws.
const tsQuery = (query: string) => sql`websearch_to_tsquery('english', ${query})`

// The ids of terms the query matches. Each UNION branch is a single-table
// predicate over an indexed expression (terms_fts_idx, terms_trgm_idx,
// definitions_fts_idx respectively), so all three stay index-backed as the
// vocabulary grows. `%` uses pg_trgm's similarity threshold (typos).
const matchingTermIds = (query: string) => sql`(
  select ${termsTable.id} from ${termsTable}
    where ${termVector} @@ ${tsQuery(query)}
  union
  select ${termsTable.id} from ${termsTable}
    where ${termsTable.term} % ${query}
  union
  select ${definitionsTable.termId} from ${definitionsTable}
    where ${definitionVector} @@ ${tsQuery(query)}
)`

export const searchMatch = (query: string) =>
  sql`${termsTable.id} in ${matchingTermIds(query)}`

// Statistical relevance: term-name hits carry weight 'A', body/example B and C.
const textRank = (query: string) =>
  sql<number>`ts_rank(setweight(${termVector}, 'A') || ${definitionVector}, ${tsQuery(query)})`

// Deterministic tiers layered above the statistical rank, so an exact name
// match always wins even if some long definition scores higher on ts_rank.
// Lowest sorts first.
const relevance = (query: string) => {
  const like = escapeLike(query)

  return sql<number>`
    case
      when lower(${termsTable.term}) = lower(${query}) then 0
      when lower(${termsTable.term}) like lower(${`${like}%`}) then 1
      else 2
    end`
}

// Ordering shared by every search procedure: exact/prefix tier, then full-text
// relevance, then how close the term name is as a string (which is what orders
// fuzzy typo matches, since those have no full-text rank at all).
export const searchOrder = (query: string) => [
  relevance(query),
  desc(textRank(query)),
  desc(sql`similarity(${termsTable.term}, ${query})`)
]

// search.terms collapses many definitions into one row per term, so the
// definition-side rank has to be aggregated -- ungrouped it fails with
// "column d.definition must appear in the GROUP BY clause". max() picks each
// term's best-matching definition. Terms columns need no aggregate: grouping by
// the primary key makes them functionally dependent.
export const searchOrderGrouped = (query: string) => [
  relevance(query),
  desc(sql`max(${textRank(query)})`),
  desc(sql`similarity(${termsTable.term}, ${query})`)
]
