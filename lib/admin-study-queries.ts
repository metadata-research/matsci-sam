import "server-only"

import {
  collectionsTable,
  commentsTable,
  communitiesTable,
  communityInvitationsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  studyDefinitionExclusionsTable,
  termsTable,
  studiesTable,
  surveyResponsesTable,
  surveyStepCompletionsTable,
  surveyStepsTable,
  usersTable,
  voteEventsTable
} from "@yamz/db"
import { asc, desc, eq, isNull, sql, getTableColumns } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { currentFeaturedExampleText } from "@/lib/definition-example-queries"
import { stepsOfStudy, walkthroughUsageOfStudy } from "@/lib/survey-queries"

const activityCount = sql<number>`cast(
  (select count(*)
   from ${surveyStepCompletionsTable} admin_completions
   join ${surveyStepsTable} completion_steps
     on completion_steps.id = admin_completions."stepId"
   where completion_steps."studyId" = ${studiesTable.id})
  +
  (select count(*)
   from ${surveyResponsesTable} admin_responses
   join ${surveyStepsTable} response_steps
     on response_steps.id = admin_responses."stepId"
   where response_steps."studyId" = ${studiesTable.id})
  +
  (select count(*)
   from ${definitionRevisionsTable} admin_revisions
   join ${surveyStepsTable} revision_steps
     on revision_steps.id = admin_revisions."surveyStepId"
   where revision_steps."studyId" = ${studiesTable.id})
  +
  (select count(*)
   from ${voteEventsTable} admin_vote_events
   join ${surveyStepsTable} vote_steps
     on vote_steps.id = admin_vote_events."surveyStepId"
   where vote_steps."studyId" = ${studiesTable.id})
  +
  (select count(*)
   from ${commentsTable} admin_comments
   join ${surveyStepsTable} comment_steps
     on comment_steps.id = admin_comments."surveyStepId"
   where comment_steps."studyId" = ${studiesTable.id})
  as int
)`

export const listAdminStudies = () =>
  db
    .select({
      id: studiesTable.id,
      slug: studiesTable.slug,
      title: studiesTable.title,
      opensAt: studiesTable.opensAt,
      closesAt: studiesTable.closesAt,
      retiredAt: studiesTable.retiredAt,
      communityRetiredAt: communitiesTable.retiredAt,
      collectionRetiredAt: collectionsTable.retiredAt,
      createdAt: studiesTable.createdAt,
      communityTitle: communitiesTable.title,
      collectionTitle: collectionsTable.title,
      activity: activityCount
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
    .orderBy(desc(studiesTable.createdAt), desc(studiesTable.id))

export const adminStudyOptions = async () => {
  const [communities, collections] = await Promise.all([
    db
      .select({ id: communitiesTable.id, title: communitiesTable.title })
      .from(communitiesTable)
      .where(isNull(communitiesTable.retiredAt))
      .orderBy(asc(communitiesTable.title), asc(communitiesTable.id)),
    db
      .select({ id: collectionsTable.id, title: collectionsTable.title })
      .from(collectionsTable)
      .where(isNull(collectionsTable.retiredAt))
      .orderBy(asc(collectionsTable.title), asc(collectionsTable.id))
  ])

  return { communities, collections }
}

export const adminStudyById = async (id: number) => {
  const [study] = await db
    .select({
      id: studiesTable.id,
      slug: studiesTable.slug,
      title: studiesTable.title,
      welcome: studiesTable.welcome,
      opensAt: studiesTable.opensAt,
      closesAt: studiesTable.closesAt,
      retiredAt: studiesTable.retiredAt,
      createdAt: studiesTable.createdAt,
      communityId: studiesTable.communityId,
      communitySlug: communitiesTable.slug,
      communityTitle: communitiesTable.title,
      communityRetiredAt: communitiesTable.retiredAt,
      collectionId: studiesTable.collectionId,
      collectionSlug: collectionsTable.slug,
      collectionTitle: collectionsTable.title,
      collectionRetiredAt: collectionsTable.retiredAt,
      createdByName: usersTable.name
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
    .leftJoin(usersTable, eq(usersTable.id, studiesTable.createdById))
    .where(eq(studiesTable.id, id))
    .limit(1)

  if (!study) return null

  const [steps, usage] = await Promise.all([
    stepsOfStudy(db, study.id),
    walkthroughUsageOfStudy(db, study.id)
  ])

  return { ...study, steps, usage }
}

// Invitation tokens are intentionally absent: only their digests survive
// creation, and an administrator can replace a pending link rather than read
// it back. The redeemed account is included so the intended cohort can be
// reconciled with the people who actually arrived.
export const adminInvitationsOfStudy = (studyId: number) =>
  db
    .select({
      id: communityInvitationsTable.id,
      email: communityInvitationsTable.email,
      sentAt: communityInvitationsTable.sentAt,
      expiresAt: communityInvitationsTable.expiresAt,
      revokedAt: communityInvitationsTable.revokedAt,
      redeemedAt: communityInvitationsTable.redeemedAt,
      createdAt: communityInvitationsTable.createdAt,
      redeemedByName: usersTable.name,
      redeemedByEmail: usersTable.email
    })
    .from(communityInvitationsTable)
    .leftJoin(
      usersTable,
      eq(usersTable.id, communityInvitationsTable.redeemedById)
    )
    .where(eq(communityInvitationsTable.studyId, studyId))
    .orderBy(
      desc(communityInvitationsTable.createdAt),
      desc(communityInvitationsTable.id)
    )

export type AdminStudyListItem = Awaited<
  ReturnType<typeof listAdminStudies>
>[number]
export type AdminStudyDetail = NonNullable<
  Awaited<ReturnType<typeof adminStudyById>>
>
export type AdminStudyOptions = Awaited<ReturnType<typeof adminStudyOptions>>
export type AdminStudyInvitation = Awaited<
  ReturnType<typeof adminInvitationsOfStudy>
>[number]

export async function adminStudyCandidates(studyId: number) {
  const restoredBy = alias(usersTable, "restored_by")
  const [definitions, history] = await Promise.all([
    db
      .selectDistinct({
        id: definitionsTable.id,
        definitionNumber: definitionsTable.definitionNumber,
        definition: definitionsTable.definition,
        example: currentFeaturedExampleText().as("example"),
        author: usersTable.name,
        term: termsTable.term,
        termSlug: termsTable.slug,
        vocabularySlug: termsTable.vocabularySlug
      })
      .from(definitionsTable)
      .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
      .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
      .innerJoin(
        surveyStepsTable,
        eq(surveyStepsTable.termId, definitionsTable.termId)
      )
      .where(eq(surveyStepsTable.studyId, studyId))
      .orderBy(asc(termsTable.term), asc(definitionsTable.definitionNumber)),
    db
      .select({
        ...getTableColumns(studyDefinitionExclusionsTable),
        excludedBy: usersTable.name,
        restoredBy: restoredBy.name
      })
      .from(studyDefinitionExclusionsTable)
      .innerJoin(
        usersTable,
        eq(usersTable.id, studyDefinitionExclusionsTable.excludedById)
      )
      .leftJoin(
        restoredBy,
        eq(restoredBy.id, studyDefinitionExclusionsTable.restoredById)
      )
      .where(eq(studyDefinitionExclusionsTable.studyId, studyId))
      .orderBy(desc(studyDefinitionExclusionsTable.id))
  ])
  return definitions.map((definition) => ({
    ...definition,
    history: history.filter((entry) => entry.definitionId === definition.id),
    exclusionId:
      history.find(
        (entry) =>
          entry.definitionId === definition.id && entry.restoredAt === null
      )?.id ?? null
  }))
}

export type AdminStudyCandidate = Awaited<
  ReturnType<typeof adminStudyCandidates>
>[number]
