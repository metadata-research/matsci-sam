import "server-only"

import {
  aiModelsTable,
  collectionsTable,
  communitiesTable,
  db,
  definitionsTable,
  studiesTable,
  termsTable,
  usersTable
} from "@yamz/db"
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { statementsTable } from "@yamz/db"

/*
 * Reads for studies. A study is public as a page, so none of these gate on the
 * viewer: what is protected is the roster of the community behind it, which
 * lib/communities.ts mayViewRoster still governs on the community page.
 */

const studyColumns = {
  id: studiesTable.id,
  slug: studiesTable.slug,
  title: studiesTable.title,
  welcome: studiesTable.welcome,
  opensAt: studiesTable.opensAt,
  closesAt: studiesTable.closesAt,
  retiredAt: studiesTable.retiredAt,
  communityId: studiesTable.communityId,
  communitySlug: communitiesTable.slug,
  communityTitle: communitiesTable.title,
  collectionId: studiesTable.collectionId,
  collectionSlug: collectionsTable.slug,
  collectionTitle: collectionsTable.title,
  // How many terms the study is actually working through, so the community
  // page can show the study and its terms as one thing.
  terms: sql<number>`(
    select cast(count(*) as int)
    from ${statementsTable} s
    where s."subjectCollectionId" = ${collectionsTable.id}
      and s.predicate = 'skos:member'
      and s."retractedAt" is null
  )`
}

const withNames = () =>
  db
    .select(studyColumns)
    .from(studiesTable)
    .innerJoin(
      communitiesTable,
      eq(communitiesTable.id, studiesTable.communityId)
    )
    .innerJoin(
      collectionsTable,
      eq(collectionsTable.id, studiesTable.collectionId)
    )

export const studyBySlug = async (slug: string) => {
  const [row] = await withNames().where(eq(studiesTable.slug, slug)).limit(1)
  return row ?? null
}

export const studyById = async (id: number) => {
  const [row] = await withNames().where(eq(studiesTable.id, id)).limit(1)
  return row ?? null
}

// Retired studies are not listed. Their addresses keep resolving, because a
// study slug is assigned once and anything that cited it must keep working.
export const listStudies = async () =>
  withNames()
    .where(isNull(studiesTable.retiredAt))
    .orderBy(desc(studiesTable.createdAt))

export const studiesOfCommunity = async (communityId: number) =>
  withNames()
    .where(
      and(
        eq(studiesTable.communityId, communityId),
        isNull(studiesTable.retiredAt)
      )
    )
    .orderBy(asc(studiesTable.createdAt))

/*
 * The outcome of a study, read from the vocabulary: for each term of its
 * collection, the definition with the most support, which is the agreed
 * definition of the group so far, with its support and how many other
 * candidates stand beside it. Support is the score, and a tie goes to the
 * earliest candidate, the order the position step shows them in. Nothing
 * is written: the outcome is a reading of the votes, as the rank pages are.
 */
export type AgreedDefinition = {
  id: number
  definitionNumber: number
  definition: string
  example: string
  score: number
  model: string | null
  author: {
    id: number | null
    name: string | null
    isAi: boolean | null
    isProfilePublic: boolean | null
    modelSlug: string | null
  }
}

export const agreedDefinitions = async (collectionId: number) => {
  const terms = await db
    .select({ id: termsTable.id, term: termsTable.term, slug: termsTable.slug })
    .from(statementsTable)
    .innerJoin(termsTable, eq(termsTable.id, statementsTable.objectTermId))
    .where(
      and(
        eq(statementsTable.predicate, "skos:member"),
        eq(statementsTable.subjectCollectionId, collectionId),
        isNull(statementsTable.retractedAt)
      )
    )
    .orderBy(asc(termsTable.term))
  if (terms.length === 0) return []

  const candidates = await db
    .select({
      id: definitionsTable.id,
      termId: definitionsTable.termId,
      definitionNumber: definitionsTable.definitionNumber,
      definition: definitionsTable.definition,
      example: definitionsTable.example,
      score: definitionsTable.score,
      model: definitionsTable.model,
      author: {
        id: usersTable.id,
        name: usersTable.name,
        isAi: usersTable.isAi,
        isProfilePublic: usersTable.isProfilePublic,
        modelSlug: aiModelsTable.slug
      }
    })
    .from(definitionsTable)
    .leftJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
    .leftJoin(aiModelsTable, eq(aiModelsTable.userId, usersTable.id))
    .where(
      inArray(
        definitionsTable.termId,
        terms.map((term) => term.id)
      )
    )
    .orderBy(
      asc(definitionsTable.termId),
      desc(definitionsTable.score),
      asc(definitionsTable.createdAt),
      asc(definitionsTable.id)
    )

  const byTerm = new Map<number, AgreedDefinition[]>()
  for (const { termId, ...candidate } of candidates) {
    const list = byTerm.get(termId) ?? []
    list.push(candidate)
    byTerm.set(termId, list)
  }

  return terms.map((term) => {
    const list = byTerm.get(term.id) ?? []
    return {
      ...term,
      agreed: list[0] ?? null,
      alternatives: Math.max(list.length - 1, 0)
    }
  })
}
