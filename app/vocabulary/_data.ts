import {
  collectionContentVisible,
  vocabularyContentVisible
} from "@/lib/community-access"
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
import { termIsListed } from "@/lib/term-visibility"

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
  async (
    slug: string,
    viewerId: number | null = null
  ): Promise<VocabularyPageRecord | null> => {
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
      .where(
        and(
          eq(vocabulariesTable.slug, slug),
          vocabularyContentVisible(vocabulariesTable.slug, viewerId)
        )
      )
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

export const findNondefaultVocabulary = cache(
  async (slug: string, viewerId: number | null = null) => {
    const vocabulary = await findVocabulary(slug, viewerId)
    return vocabulary && !vocabulary.isDefault ? vocabulary : null
  }
)

export const findVocabularyTerm = cache(
  async (
    vocabularySlug: string,
    termSlug: string,
    viewerId: number | null = null
  ) => {
    const [term] = await db
      .select({
        id: termsTable.id,
        term: termsTable.term,
        slug: termsTable.slug,
        vocabularySlug: termsTable.vocabularySlug,
        vocabularyTitle: vocabulariesTable.title,
        vocabularyRetiredAt: vocabulariesTable.retiredAt,
        hiddenAt: termsTable.hiddenAt,
        hiddenReason: termsTable.hiddenReason
      })
      .from(termsTable)
      .innerJoin(
        vocabulariesTable,
        eq(vocabulariesTable.slug, termsTable.vocabularySlug)
      )
      .where(
        and(
          eq(termsTable.vocabularySlug, vocabularySlug),
          vocabularyContentVisible(termsTable.vocabularySlug, viewerId),
          eq(termsTable.slug, termSlug)
        )
      )
      .limit(1)

    return term ?? null
  }
)

export const findTermRouteAlias = cache(
  async (
    vocabularySlug: string,
    termSlug: string,
    viewerId: number | null = null
  ) => {
    const [term] = await db
      .select({
        id: termsTable.id,
        term: termsTable.term,
        slug: termsTable.slug,
        vocabularySlug: termsTable.vocabularySlug,
        vocabularyTitle: vocabulariesTable.title,
        vocabularyRetiredAt: vocabulariesTable.retiredAt,
        hiddenAt: termsTable.hiddenAt,
        hiddenReason: termsTable.hiddenReason
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
          eq(termRouteAliasesTable.termSlug, termSlug),
          vocabularyContentVisible(termsTable.vocabularySlug, viewerId)
        )
      )
      .limit(1)

    return term ?? null
  }
)

export const findVocabularyTermRoute = cache(
  async (
    vocabularySlug: string,
    termSlug: string,
    viewerId: number | null = null
  ) => {
    const canonical = await findVocabularyTerm(
      vocabularySlug,
      termSlug,
      viewerId
    )
    if (canonical) return { term: canonical, isAlias: false as const }

    const alias = await findTermRouteAlias(vocabularySlug, termSlug, viewerId)
    return alias ? { term: alias, isAlias: true as const } : null
  }
)

export const vocabularyTerms = cache(
  async (vocabularySlug: string, viewerId: number | null = null) =>
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
      .where(
        and(
          termIsListed(),
          eq(termsTable.vocabularySlug, vocabularySlug),
          vocabularyContentVisible(termsTable.vocabularySlug, viewerId)
        )
      )
      .groupBy(termsTable.id)
      .orderBy(asc(sql`lower(btrim(${termsTable.term}))`))
)

// A foreign term becomes visible to a community through an active collection
// membership. It remains owned by, and links to, its source vocabulary.
export const vocabularyReferences = cache(
  async (vocabularySlug: string, viewerId: number | null = null) =>
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
          termIsListed(),
          vocabularyContentVisible(termsTable.vocabularySlug, viewerId),
          eq(communitiesTable.vocabularySlug, vocabularySlug),
          vocabularyContentVisible(communitiesTable.vocabularySlug, viewerId),
          collectionContentVisible(
            communityCollectionsTable.collectionId,
            viewerId
          ),
          ne(termsTable.vocabularySlug, vocabularySlug)
        )
      )
      .groupBy(termsTable.id, vocabulariesTable.slug)
      .orderBy(
        asc(sql`lower(btrim(${termsTable.term}))`),
        asc(sql`lower(btrim(${vocabulariesTable.title}))`)
      )
)

const vocabularyCatalog = cache(
  async (includeDefault: boolean, viewerId: number | null = null) =>
    db
      .select({
        slug: vocabulariesTable.slug,
        title: vocabulariesTable.title,
        description: vocabulariesTable.description,
        isDefault: vocabulariesTable.isDefault,
        retiredAt: vocabulariesTable.retiredAt,
        count: sql<number>`cast(count(${termsTable.id}) as int)`.mapWith(Number)
      })
      .from(vocabulariesTable)
      .leftJoin(
        termsTable,
        and(
          eq(termsTable.vocabularySlug, vocabulariesTable.slug),
          termIsListed()
        )
      )
      .where(
        and(
          vocabularyContentVisible(vocabulariesTable.slug, viewerId),
          includeDefault ? undefined : eq(vocabulariesTable.isDefault, false)
        )
      )
      .groupBy(vocabulariesTable.slug)
      .orderBy(
        asc(sql`lower(btrim(${vocabulariesTable.title}))`),
        desc(vocabulariesTable.slug)
      )
)

export const otherVocabularies = (viewerId: number | null = null) =>
  vocabularyCatalog(false, viewerId)

export const allVocabularies = (viewerId: number | null = null) =>
  vocabularyCatalog(true, viewerId)
