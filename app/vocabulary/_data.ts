import "server-only"

import {
  communitiesTable,
  communityCollectionsTable,
  db,
  definitionsTable,
  statementsTable,
  termRouteAliasesTable,
  termsTable,
  vocabulariesTable
} from "@yamz/db"
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm"
import { cache } from "react"

export type VocabularyPageRecord = {
  slug: string
  title: string
  description: string | null
  isDefault: boolean
  retiredAt: string | null
  community: {
    id: number
    slug: string
    title: string
  } | null
}

export const findVocabulary = cache(
  async (slug: string): Promise<VocabularyPageRecord | null> => {
    const [row] = await db
      .select({
        slug: vocabulariesTable.slug,
        title: vocabulariesTable.title,
        description: vocabulariesTable.description,
        isDefault: vocabulariesTable.isDefault,
        retiredAt: vocabulariesTable.retiredAt,
        communityId: communitiesTable.id,
        communitySlug: communitiesTable.slug,
        communityTitle: communitiesTable.title
      })
      .from(vocabulariesTable)
      .leftJoin(
        communitiesTable,
        eq(communitiesTable.vocabularySlug, vocabulariesTable.slug)
      )
      .where(eq(vocabulariesTable.slug, slug))
      .limit(1)

    if (!row) return null

    return {
      slug: row.slug,
      title: row.title,
      description: row.description,
      isDefault: row.isDefault,
      retiredAt: row.retiredAt,
      community:
        row.communityId !== null &&
        row.communitySlug !== null &&
        row.communityTitle !== null
          ? {
              id: row.communityId,
              slug: row.communitySlug,
              title: row.communityTitle
            }
          : null
    }
  }
)

export const findNondefaultVocabulary = cache(async (slug: string) => {
  const vocabulary = await findVocabulary(slug)
  return vocabulary && !vocabulary.isDefault ? vocabulary : null
})

export const findVocabularyTerm = cache(
  async (vocabularySlug: string, termSlug: string) => {
    const [term] = await db
      .select({
        id: termsTable.id,
        term: termsTable.term,
        slug: termsTable.slug,
        vocabularySlug: termsTable.vocabularySlug,
        vocabularyTitle: vocabulariesTable.title,
        vocabularyRetiredAt: vocabulariesTable.retiredAt
      })
      .from(termsTable)
      .innerJoin(
        vocabulariesTable,
        eq(vocabulariesTable.slug, termsTable.vocabularySlug)
      )
      .where(
        and(
          eq(termsTable.vocabularySlug, vocabularySlug),
          eq(termsTable.slug, termSlug)
        )
      )
      .limit(1)

    return term ?? null
  }
)

export const findTermRouteAlias = cache(
  async (vocabularySlug: string, termSlug: string) => {
    const [term] = await db
      .select({
        id: termsTable.id,
        term: termsTable.term,
        slug: termsTable.slug,
        vocabularySlug: termsTable.vocabularySlug,
        vocabularyTitle: vocabulariesTable.title,
        vocabularyRetiredAt: vocabulariesTable.retiredAt
      })
      .from(termRouteAliasesTable)
      .innerJoin(termsTable, eq(termsTable.id, termRouteAliasesTable.termId))
      .innerJoin(
        vocabulariesTable,
        eq(vocabulariesTable.slug, termsTable.vocabularySlug)
      )
      .where(
        and(
          eq(termRouteAliasesTable.vocabularySlug, vocabularySlug),
          eq(termRouteAliasesTable.termSlug, termSlug)
        )
      )
      .limit(1)

    return term ?? null
  }
)

export const findVocabularyTermRoute = cache(
  async (vocabularySlug: string, termSlug: string) => {
    const canonical = await findVocabularyTerm(vocabularySlug, termSlug)
    if (canonical) return { term: canonical, isAlias: false as const }

    const alias = await findTermRouteAlias(vocabularySlug, termSlug)
    return alias ? { term: alias, isAlias: true as const } : null
  }
)

export const vocabularyTerms = cache(async (vocabularySlug: string) =>
  db
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      vocabularySlug: termsTable.vocabularySlug,
      count: sql<number>`cast(count(${definitionsTable.id}) as int)`
    })
    .from(termsTable)
    .leftJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
    .where(eq(termsTable.vocabularySlug, vocabularySlug))
    .groupBy(termsTable.id)
    .orderBy(asc(sql`lower(btrim(${termsTable.term}))`))
)

// A foreign term becomes visible to a community through an active collection
// membership. It remains owned by, and links to, its source vocabulary.
export const vocabularyReferences = cache(async (vocabularySlug: string) =>
  db
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      vocabularySlug: termsTable.vocabularySlug,
      vocabularyTitle: vocabulariesTable.title,
      count:
        sql<number>`cast(count(distinct ${definitionsTable.id}) as int)`.mapWith(
          Number
        )
    })
    .from(communitiesTable)
    .innerJoin(
      communityCollectionsTable,
      and(
        eq(communityCollectionsTable.communityId, communitiesTable.id),
        isNull(communityCollectionsTable.removedAt)
      )
    )
    .innerJoin(
      statementsTable,
      and(
        eq(
          statementsTable.subjectCollectionId,
          communityCollectionsTable.collectionId
        ),
        eq(statementsTable.predicate, "skos:member"),
        isNull(statementsTable.retractedAt)
      )
    )
    .innerJoin(termsTable, eq(termsTable.id, statementsTable.objectTermId))
    .innerJoin(
      vocabulariesTable,
      eq(vocabulariesTable.slug, termsTable.vocabularySlug)
    )
    .leftJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
    .where(
      and(
        eq(communitiesTable.vocabularySlug, vocabularySlug),
        ne(termsTable.vocabularySlug, vocabularySlug)
      )
    )
    .groupBy(termsTable.id, vocabulariesTable.slug)
    .orderBy(
      asc(sql`lower(btrim(${termsTable.term}))`),
      asc(sql`lower(btrim(${vocabulariesTable.title}))`)
    )
)

export const otherVocabularies = cache(async () =>
  db
    .select({
      slug: vocabulariesTable.slug,
      title: vocabulariesTable.title,
      retiredAt: vocabulariesTable.retiredAt,
      count: sql<number>`cast(count(${termsTable.id}) as int)`.mapWith(Number)
    })
    .from(vocabulariesTable)
    .leftJoin(termsTable, eq(termsTable.vocabularySlug, vocabulariesTable.slug))
    .where(eq(vocabulariesTable.isDefault, false))
    .groupBy(vocabulariesTable.slug)
    .orderBy(
      asc(sql`lower(btrim(${vocabulariesTable.title}))`),
      desc(vocabulariesTable.slug)
    )
)
