import "server-only"

import {
  aiModelsTable,
  collectionsTable,
  communitiesTable,
  communityMembersTable,
  db,
  definitionsTable,
  studiesTable,
  surveyStepCompletionsTable,
  surveyStepsTable,
  termsTable,
  usersTable,
  voteEventsTable,
  votesTable
} from "@yamz/db"
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { statementsTable } from "@yamz/db"
import { currentFeaturedExampleText } from "./definition-example-queries"

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
  )`,
  // How many steps its walkthrough has, so the study page can say whether
  // positions are being taken without reading the walkthrough.
  steps: sql<number>`(
    select cast(count(*) as int)
    from ${surveyStepsTable} st
    where st."studyId" = ${studiesTable.id}
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

/*
 * The studies of the communities the viewer belongs to, each with how many
 * walkthrough steps the viewer has saved, for the "Your studies" section of
 * the index. Counts and not the steps themselves, so the section is one
 * query. Membership is read live, the same rule the walkthrough applies.
 */
export const studiesOfViewer = async (userId: number) =>
  db
    .select({
      ...studyColumns,
      saved: sql<number>`(
        select cast(count(*) as int)
        from ${surveyStepCompletionsTable} c
        join ${surveyStepsTable} cs on cs.id = c."stepId"
        where cs."studyId" = ${studiesTable.id}
          and c."userId" = ${userId}
      )`
    })
    .from(studiesTable)
    .innerJoin(
      communitiesTable,
      eq(communitiesTable.id, studiesTable.communityId)
    )
    .innerJoin(
      collectionsTable,
      eq(collectionsTable.id, studiesTable.collectionId)
    )
    .innerJoin(
      communityMembersTable,
      and(
        eq(communityMembersTable.communityId, studiesTable.communityId),
        eq(communityMembersTable.userId, userId),
        isNull(communityMembersTable.removedAt)
      )
    )
    .where(
      and(isNull(studiesTable.retiredAt), isNull(communitiesTable.retiredAt))
    )
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
 * The support list of a study's collection: for each term, the definition with
 * the greatest site-wide net support, plus how many other candidates stand
 * beside it. Support is read from votes and not from the score column, which a
 * model revision resets. Without asOf it is the votes rows on the current
 * revision of the definition, up minus down. With asOf it is the last vote
 * event of each person on each revision at or before that time, summed over the
 * revisions of the definition. Neither path limits votes to the study or its
 * community. The asOf path time-bounds support only: collection membership,
 * the candidate set and displayed candidate text remain current. A tie goes to
 * the earliest candidate. Nothing is written.
 */
export type MostSupportedDefinition = {
  id: number
  definitionNumber: number
  definition: string
  example: string
  support: number
  model: string | null
  author: {
    id: number | null
    name: string | null
    isAi: boolean | null
    isProfilePublic: boolean | null
    modelSlug: string | null
  }
}

export const mostSupportedDefinitions = async (
  collectionId: number,
  asOf?: string | null
) => {
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

  const support = asOf
    ? sql<number>`cast(coalesce((
        select sum(case last.kind when 'up' then 1 when 'down' then -1 else 0 end)
        from (
          select distinct on (e."revisionId", e."userId") e.kind
          from ${voteEventsTable} e
          where e."definitionId" = ${definitionsTable.id}
            and e."createdAt" <= ${asOf}
          order by e."revisionId", e."userId", e."createdAt" desc, e.id desc
        ) last
      ), 0) as int)`
    : sql<number>`cast(coalesce((
        select sum(case v.kind when 'up' then 1 when 'down' then -1 else 0 end)
        from ${votesTable} v
        where v."definitionId" = ${definitionsTable.id}
          and v."revisionId" = ${definitionsTable.currentRevisionId}
      ), 0) as int)`

  const candidates = await db
    .select({
      id: definitionsTable.id,
      termId: definitionsTable.termId,
      definitionNumber: definitionsTable.definitionNumber,
      definition: definitionsTable.definition,
      example: currentFeaturedExampleText().as("example"),
      support: support.mapWith(Number).as("support"),
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
      desc(sql`"support"`),
      asc(definitionsTable.createdAt),
      asc(definitionsTable.id)
    )

  const byTerm = new Map<number, MostSupportedDefinition[]>()
  for (const { termId, ...candidate } of candidates) {
    const list = byTerm.get(termId) ?? []
    list.push(candidate)
    byTerm.set(termId, list)
  }

  return terms.map((term) => {
    const list = byTerm.get(term.id) ?? []
    return {
      ...term,
      mostSupported: list[0] ?? null,
      alternatives: Math.max(list.length - 1, 0)
    }
  })
}
