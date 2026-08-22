import "server-only"

import {
  collectionsTable,
  communitiesTable,
  db,
  studiesTable
} from "@yamz/db"
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"
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
