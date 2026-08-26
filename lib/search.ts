import {
  communityCollectionsTable,
  conceptSchemesTable,
  conceptsTable,
  definitionsTable,
  definitionExamplesTable,
  statementsTable,
  termsTable
} from "@yamz/db"
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import { currentFeaturedExampleText } from "./definition-example-queries"
import {
  SEARCH_HEADLINE_OPTIONS,
  type SearchMatchSource
} from "./search-evidence"

/*
 * Search is full-text (see migration 0013), designed to stay useful as the
 * vocabulary grows. Three signals combine:
 *
 *   1. Full-text over term names, definition bodies, and featured examples.
 *      The legacy definition expression remains byte-identical to its GIN
 *      index; a separate branch admits normalized featured examples.
 *   2. Trigram similarity on term names, which catches typos and partial words
 *      that full-text misses -- FTS matches whole lexemes, so "austenit" finds
 *      nothing without it.
 *   3. Exact/prefix tiers on the term name, so typing a term's exact name puts
 *      it first regardless of how the statistical ranking falls out.
 *
 * Term results are term-centric: a term matches if its name matches by full
 * text or trigram, or if any of its definitions or active examples matches.
 * Definition results are narrower: a term-name hit admits its definitions, but
 * a body/example hit admits only the definition that contains that evidence.
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

// Must match migration 0013's indexed expressions exactly. This remains the
// indexed match branch while the current ranking vector below uses the
// normalized featured-example projection.
const termVector = sql`to_tsvector('english', ${termsTable.term})`
const indexedDefinitionVector = sql`(setweight(to_tsvector('english', ${definitionsTable.definition}), 'B') || setweight(to_tsvector('english', ${definitionsTable.example}), 'C'))`

const currentDefinitionVector = () =>
  sql`(setweight(to_tsvector('english', ${definitionsTable.definition}), 'B') || setweight(to_tsvector('english', ${currentFeaturedExampleText()}), 'C'))`

// websearch_to_tsquery never throws on user input -- it handles quoted phrases,
// OR, and leading `-`, and degrades to an empty query rather than erroring on
// punctuation soup. plainto_tsquery would drop the operators; to_tsquery throws.
const tsQuery = (query: string) =>
  sql`websearch_to_tsquery('english', ${query})`

const termTextMatch = (query: string) => sql`${termVector} @@ ${tsQuery(query)}`

const definitionBodyVector = sql`to_tsvector('english', ${definitionsTable.definition})`
const definitionBodyMatch = (query: string) =>
  sql`${definitionBodyVector} @@ ${tsQuery(query)}`

const featuredExampleVector = () =>
  sql`to_tsvector('english', ${currentFeaturedExampleText()})`
const featuredExampleMatch = (query: string) =>
  sql`${featuredExampleVector()} @@ ${tsQuery(query)}`

const activeExampleMatch = (query: string) => sql`exists (
  select 1
  from ${definitionExamplesTable} search_example
  where search_example."definitionId" = ${definitionsTable.id}
    and search_example."withdrawnAt" is null
    and to_tsvector('english', search_example.text) @@ ${tsQuery(query)}
)`

const headline = (document: SQL, query: string) =>
  sql<string>`ts_headline('english', ${document}, ${tsQuery(query)}, ${SEARCH_HEADLINE_OPTIONS})`

const activeExampleHeadline = (query: string) => sql<string | null>`(
  select ts_headline(
    'english',
    search_example.text,
    ${tsQuery(query)},
    ${SEARCH_HEADLINE_OPTIONS}
  )
  from ${definitionExamplesTable} search_example
  where search_example."definitionId" = ${definitionsTable.id}
    and search_example."withdrawnAt" is null
    and to_tsvector('english', search_example.text) @@ ${tsQuery(query)}
  order by ts_rank(
    to_tsvector('english', search_example.text),
    ${tsQuery(query)}
  ) desc, search_example.id
  limit 1
)`

// The ids of terms the query matches. Each UNION branch is a single-table
// predicate over an indexed expression (terms_fts_idx, terms_trgm_idx,
// definitions_fts_idx respectively). The definition-body branch uses the
// indexed legacy vector as a candidate set, then discards hits found only in a
// superseded legacy example. The fourth branch searches every active normalized
// example, with a final compatibility branch for records not backfilled yet.
// `%` uses pg_trgm's similarity threshold.
const matchingTermIds = (query: string) => sql`(
  select ${termsTable.id} from ${termsTable}
    where ${termVector} @@ ${tsQuery(query)}
  union
  select ${termsTable.id} from ${termsTable}
    where ${termsTable.term} % ${query}
  union
  select ${definitionsTable.termId} from ${definitionsTable}
    where ${indexedDefinitionVector} @@ ${tsQuery(query)}
      and to_tsvector('english', ${definitionsTable.definition}) @@ ${tsQuery(query)}
  union
  select ${definitionsTable.termId} from ${definitionsTable}
    where to_tsvector('english', ${currentFeaturedExampleText()}) @@ ${tsQuery(query)}
  union
  select ${definitionsTable.termId}
    from ${definitionExamplesTable}
    inner join ${definitionsTable}
      on ${definitionsTable.id} = ${definitionExamplesTable.definitionId}
    where ${definitionExamplesTable.withdrawnAt} is null
      and to_tsvector('english', ${definitionExamplesTable.text}) @@ ${tsQuery(query)}
)`

export const searchMatch = (query: string) =>
  sql`${termsTable.id} in ${matchingTermIds(query)}`

// Definition results must carry their own evidence unless the term name is the
// match. This avoids returning every sibling definition merely because one of
// them contains the searched word.
const matchingDefinitionIds = (query: string) => sql`(
  select ${definitionsTable.id} from ${definitionsTable}
    where ${indexedDefinitionVector} @@ ${tsQuery(query)}
      and ${definitionBodyVector} @@ ${tsQuery(query)}
  union
  select ${definitionsTable.id} from ${definitionsTable}
    where ${featuredExampleVector()} @@ ${tsQuery(query)}
  union
  select ${definitionExamplesTable.definitionId}
    from ${definitionExamplesTable}
    where ${definitionExamplesTable.withdrawnAt} is null
      and to_tsvector('english', ${definitionExamplesTable.text}) @@ ${tsQuery(query)}
)`

export const definitionSearchMatch = (query: string) => sql`(
  ${termTextMatch(query)}
  or ${termsTable.term} % ${query}
  or ${definitionsTable.id} in ${matchingDefinitionIds(query)}
)`

export const definitionMatchSource = (query: string) =>
  sql<SearchMatchSource>`case
    when ${termTextMatch(query)} then 'term'
    when ${definitionBodyMatch(query)} then 'definition'
    when ${featuredExampleMatch(query)} then 'example'
    when ${activeExampleMatch(query)} then 'example'
    else 'similar'
  end`

export const definitionMatchHeadline = (query: string) => sql<string>`case
  when ${termTextMatch(query)} then ${headline(sql`${termsTable.term}`, query)}
  when ${definitionBodyMatch(query)} then ${headline(sql`${definitionsTable.definition}`, query)}
  when ${featuredExampleMatch(query)} then ${headline(currentFeaturedExampleText(), query)}
  when ${activeExampleMatch(query)} then ${activeExampleHeadline(query)}
  else ${termsTable.term}
end`

// search.terms groups all definitions of one term. bool_or and filtered
// array_agg retain the best visible evidence without adding a second query per
// result row.
export const termMatchSourceGrouped = (query: string) =>
  sql<SearchMatchSource>`case
    when ${termTextMatch(query)} then 'term'
    when bool_or(${definitionBodyMatch(query)}) then 'definition'
    when bool_or(${featuredExampleMatch(query)}) then 'example'
    when bool_or(${activeExampleMatch(query)}) then 'example'
    else 'similar'
  end`

export const termMatchHeadlineGrouped = (query: string) => sql<string>`case
  when ${termTextMatch(query)} then ${headline(sql`${termsTable.term}`, query)}
  when bool_or(${definitionBodyMatch(query)}) then
    (array_agg(
      ${headline(sql`${definitionsTable.definition}`, query)}
      order by ts_rank(${definitionBodyVector}, ${tsQuery(query)}) desc
    ) filter (where ${definitionBodyMatch(query)}))[1]
  when bool_or(${featuredExampleMatch(query)}) then
    (array_agg(
      ${headline(currentFeaturedExampleText(), query)}
      order by ts_rank(${featuredExampleVector()}, ${tsQuery(query)}) desc
    ) filter (where ${featuredExampleMatch(query)}))[1]
  when bool_or(${activeExampleMatch(query)}) then
    (array_agg(${activeExampleHeadline(query)})
      filter (where ${activeExampleMatch(query)}))[1]
  else ${termsTable.term}
end`

export type SearchFacet = {
  key: string
  name: string
  slug: string
  schemeSlug: string
  schemeTitle: string
}

export const searchFacetKey = sql<string>`${conceptSchemesTable.slug} || ':' || ${conceptsTable.slug}`

export const termFacets = () => sql<SearchFacet[]>`coalesce((
  select jsonb_agg(
    jsonb_build_object(
      'key', facet_scheme.slug || ':' || facet.slug,
      'name', facet."prefLabel",
      'slug', facet.slug,
      'schemeSlug', facet_scheme.slug,
      'schemeTitle', facet_scheme.title
    ) order by facet_scheme.id, facet.id
  )
  from ${statementsTable} facet_statement
  join ${conceptsTable} facet
    on facet.id = facet_statement."objectConceptId"
  join ${conceptSchemesTable} facet_scheme
    on facet_scheme.id = facet."schemeId"
  where facet_statement.predicate = 'dcterms:subject'
    and facet_statement."subjectTermId" = "terms"."id"
    and facet_statement."retractedAt" is null
    and facet_scheme."attachesAt" = 'term'
    and facet.status = 'approved'
), '[]'::jsonb)`

// Multiple concepts in the same facet scheme are alternatives. The current
// PSPP scheme is the only term-level scheme; when another is added this helper
// can be extended to AND the scheme groups while retaining OR within each.
export const facetTermScope = (facetKeys: string[]) => {
  if (facetKeys.length === 0) return undefined

  return sql`${termsTable.id} in (
    select ${statementsTable.subjectTermId}
    from ${statementsTable}
    join ${conceptsTable}
      on ${conceptsTable.id} = ${statementsTable.objectConceptId}
    join ${conceptSchemesTable}
      on ${conceptSchemesTable.id} = ${conceptsTable.schemeId}
    where ${and(
      eq(statementsTable.predicate, "dcterms:subject"),
      isNull(statementsTable.retractedAt),
      eq(conceptSchemesTable.attachesAt, "term"),
      eq(conceptsTable.status, "approved"),
      inArray(searchFacetKey, facetKeys)
    )}
  )`
}

// Statistical relevance: term-name hits carry weight 'A', body/example B and C.
const textRank = (query: string) =>
  sql<number>`ts_rank(setweight(${termVector}, 'A') || ${currentDefinitionVector()}, ${tsQuery(query)})`

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

/*
 * Terms owned by one vocabulary namespace. The active-community homepage and
 * Browse view use this boundary; a collection can still reference terms from
 * other namespaces without making them local.
 */
export const vocabularyTermScope = (vocabularySlug: string) =>
  eq(termsTable.vocabularySlug, vocabularySlug)

/*
 * Terms referenced by the collections on a community's worklist. This is a
 * worklist relation, not ownership and not a SKOS equivalence assertion.
 */
export const communityReferenceScope = (communityId: number) =>
  sql`${termsTable.id} in (
    select ${statementsTable.objectTermId}
    from ${statementsTable}
    join ${communityCollectionsTable}
      on ${communityCollectionsTable.collectionId} = ${statementsTable.subjectCollectionId}
    where ${statementsTable.predicate} = 'skos:member'
      and ${statementsTable.retractedAt} is null
      and ${communityCollectionsTable.communityId} = ${communityId}
      and ${communityCollectionsTable.removedAt} is null
  )`
