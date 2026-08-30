import "server-only"

import {
  communitiesTable,
  communityInvitationsTable,
  communityMembersTable,
  db,
  studiesTable,
  usersTable
} from "@yamz/db"
import { asc, desc, eq, sql } from "drizzle-orm"

/*
 * The administrator's view of community membership, separate from the study
 * pages: who is in each community, who stewards it, and the invitations that
 * admit people to it. Mutation goes through the communities router, whose
 * permission rules already admit a site administrator.
 */

// The correlation is spelled out, because drizzle renders a column of the
// one selected table unqualified, and an unqualified "id" inside these
// subqueries resolves to the counted table's own id column.
const memberCount = sql<number>`cast(
  (select count(*)
   from ${communityMembersTable} admin_members
   where admin_members."communityId" = "communities"."id"
     and admin_members."removedAt" is null)
  as int
)`

const stewardCount = sql<number>`cast(
  (select count(*)
   from ${communityMembersTable} admin_stewards
   where admin_stewards."communityId" = "communities"."id"
     and admin_stewards."removedAt" is null
     and admin_stewards.role = 'steward')
  as int
)`

const studyCount = sql<number>`cast(
  (select count(*)
   from ${studiesTable} admin_studies
   where admin_studies."communityId" = "communities"."id")
  as int
)`

export const listAdminCommunities = () =>
  db
    .select({
      id: communitiesTable.id,
      slug: communitiesTable.slug,
      title: communitiesTable.title,
      retiredAt: communitiesTable.retiredAt,
      createdAt: communitiesTable.createdAt,
      members: memberCount,
      stewards: stewardCount,
      studies: studyCount
    })
    .from(communitiesTable)
    .orderBy(asc(communitiesTable.title), asc(communitiesTable.id))

export const adminCommunityById = async (id: number) => {
  const [community] = await db
    .select({
      id: communitiesTable.id,
      slug: communitiesTable.slug,
      title: communitiesTable.title,
      description: communitiesTable.description,
      retiredAt: communitiesTable.retiredAt,
      joinToken: communitiesTable.joinToken
    })
    .from(communitiesTable)
    .where(eq(communitiesTable.id, id))
    .limit(1)
  return community ?? null
}

// Every invitation into the community, the study-bound ones included, with
// who accepted and which study each one opens. No token or digest leaves.
export const adminInvitationsOfCommunity = (communityId: number) =>
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
      redeemedByEmail: usersTable.email,
      studyId: communityInvitationsTable.studyId,
      studyTitle: studiesTable.title
    })
    .from(communityInvitationsTable)
    .leftJoin(
      usersTable,
      eq(usersTable.id, communityInvitationsTable.redeemedById)
    )
    .leftJoin(
      studiesTable,
      eq(studiesTable.id, communityInvitationsTable.studyId)
    )
    .where(eq(communityInvitationsTable.communityId, communityId))
    .orderBy(
      desc(communityInvitationsTable.createdAt),
      desc(communityInvitationsTable.id)
    )

export type AdminCommunityListItem = Awaited<
  ReturnType<typeof listAdminCommunities>
>[number]
export type AdminCommunityDetail = NonNullable<
  Awaited<ReturnType<typeof adminCommunityById>>
>
export type AdminCommunityInvitation = Awaited<
  ReturnType<typeof adminInvitationsOfCommunity>
>[number]
