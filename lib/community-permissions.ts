import "server-only"
import { requireCommunityPrivateStudyScope } from "./study-content-scope"
import { TRPCError } from "@trpc/server"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import {
  communitiesTable,
  communityAccessRequestsTable as requests,
  communityMembersTable as members,
  usersTable,
  vocabularyMatcoreSourcesTable,
  matcoreFieldsTable,
  matcoreSpecDraftsTable,
  matcoreSpecRevisionsTable
} from "@yamz/db"
import {
  communityAccess,
  type CommunityTransaction,
  type CommunityVisibility
} from "./community-access"
import {
  acquireGraphPrivacyLock,
  clearPublicGraphProjection
} from "./graph/projector"

const missing = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "This community is unavailable."
  })

async function lockedCommunity(tx: CommunityTransaction, communityId: number) {
  const [community] = await tx
    .select({
      id: communitiesTable.id,
      slug: communitiesTable.slug,
      vocabularySlug: communitiesTable.vocabularySlug,
      visibility: communitiesTable.visibility,
      retiredAt: communitiesTable.retiredAt
    })
    .from(communitiesTable)
    .where(eq(communitiesTable.id, communityId))
    .for("update")
  if (!community) throw missing()
  return community
}

async function requireManager(
  tx: CommunityTransaction,
  communityId: number,
  actorId: number
) {
  const [membership] = await tx
    .select({ role: members.role })
    .from(members)
    .where(
      and(
        eq(members.communityId, communityId),
        eq(members.userId, actorId),
        isNull(members.removedAt)
      )
    )
    .for("share")
  const [actor] = await tx
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, actorId))
    .for("share")
  if (actor?.role !== "admin" && membership?.role !== "steward") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Only a community steward or site administrator can manage access."
    })
  }
}

// Creation inherits visibility while the community and the creator's live
// authority are locked. Linking an existing collection never changes its scope.
export async function communityCollectionScope(
  tx: CommunityTransaction,
  communityId: number,
  actorId: number
) {
  const community = await lockedCommunity(tx, communityId)
  await requireManager(tx, communityId, actorId)
  if (community.retiredAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This community has been retired."
    })
  return community.visibility === "members" ? community.id : null
}

export async function setCommunityVisibility(
  tx: CommunityTransaction,
  input: {
    communityId: number
    actorId: number
    visibility: CommunityVisibility
  }
) {
  // This lock is also held by graph projection. Clearing the old public
  // dataset succeeds before private content can become hidden in PostgreSQL.
  await acquireGraphPrivacyLock(tx)
  const community = await lockedCommunity(tx, input.communityId)
  await requireManager(tx, community.id, input.actorId)
  if (community.retiredAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Restore this community before changing its access."
    })
  if (community.visibility === input.visibility)
    return { ...community, changed: false }
  if (input.visibility === "public") {
    const [protectedSource] = await tx
      .select({
        exists: sql<boolean>`
      EXISTS (SELECT 1 FROM ${vocabularyMatcoreSourcesTable} WHERE ${vocabularyMatcoreSourcesTable.vocabularySlug}=${community.vocabularySlug})
      OR EXISTS (SELECT 1 FROM ${matcoreFieldsTable} f WHERE f."vocabularySlug"=${community.vocabularySlug} AND (
        f."sourceFieldId" IS NOT NULL
        OR EXISTS (SELECT 1 FROM ${matcoreSpecDraftsTable} d WHERE d."fieldId"=f.id AND d."profileReleaseId" IS NOT NULL)
        OR EXISTS (SELECT 1 FROM ${matcoreSpecRevisionsTable} r WHERE r."fieldId"=f.id AND r."profileReleaseId" IS NOT NULL)))`
      })
      .from(communitiesTable)
      .where(eq(communitiesTable.id, community.id))
    if (protectedSource?.exists)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "This community contains protected source material and must remain members-only."
      })
  } else {
    await requireCommunityPrivateStudyScope(tx, community.id)
    await clearPublicGraphProjection()
  }
  await tx
    .update(communitiesTable)
    .set({ visibility: input.visibility })
    .where(eq(communitiesTable.id, community.id))
  return { ...community, visibility: input.visibility, changed: true }
}

export async function requestCommunityAccess(
  tx: CommunityTransaction,
  input: {
    communityId: number
    requesterId: number
  }
) {
  const community = await lockedCommunity(tx, input.communityId)
  const [requester] = await tx
    .select({ id: usersTable.id, isAi: usersTable.isAi })
    .from(usersTable)
    .where(eq(usersTable.id, input.requesterId))
    .for("share")
  if (!requester || requester.isAi)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Sign in with a personal account to request access."
    })
  if (community.retiredAt || community.visibility !== "members")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This community is not accepting access requests."
    })
  const access = await communityAccess(tx, community.id, input.requesterId)
  if (access.canRead) return { id: null, status: null, alreadyHasAccess: true }
  const [existing] = await tx
    .select({ id: requests.id, status: requests.status })
    .from(requests)
    .where(
      and(
        eq(requests.communityId, community.id),
        eq(requests.requesterId, input.requesterId),
        eq(requests.status, "pending")
      )
    )
    .for("update")
  if (existing) return { ...existing, alreadyHasAccess: false }
  const [request] = await tx
    .insert(requests)
    .values({ communityId: community.id, requesterId: input.requesterId })
    .returning({ id: requests.id, status: requests.status })
  return { ...request, alreadyHasAccess: false }
}

export async function listCommunityAccessRequests(
  tx: CommunityTransaction,
  input: {
    communityId: number
    actorId: number
  }
) {
  const community = await lockedCommunity(tx, input.communityId)
  await requireManager(tx, community.id, input.actorId)
  return tx
    .select({
      id: requests.id,
      userId: requests.requesterId,
      name: usersTable.name,
      createdAt: requests.createdAt,
      status: requests.status
    })
    .from(requests)
    .innerJoin(usersTable, eq(usersTable.id, requests.requesterId))
    .where(
      and(
        eq(requests.communityId, community.id),
        eq(requests.status, "pending")
      )
    )
    .orderBy(asc(requests.id))
    .limit(200)
}

export async function reviewCommunityAccessRequest(
  tx: CommunityTransaction,
  input: {
    id: number
    actorId: number
    approve: boolean
  }
) {
  const [identity] = await tx
    .select({ communityId: requests.communityId })
    .from(requests)
    .where(eq(requests.id, input.id))
  if (!identity) throw missing()
  const community = await lockedCommunity(tx, identity.communityId)
  await requireManager(tx, community.id, input.actorId)
  if (community.retiredAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Restore this community before reviewing access requests."
    })
  const [request] = await tx
    .select()
    .from(requests)
    .where(eq(requests.id, input.id))
    .for("update")
  if (!request) throw missing()
  const status = input.approve ? "approved" : "declined"
  if (request.status !== "pending") {
    if (request.status === status)
      return {
        id: request.id,
        status,
        membershipId: request.membershipId,
        changed: false,
        communitySlug: community.slug
      }
    throw new TRPCError({
      code: "CONFLICT",
      message: "This access request has already been reviewed."
    })
  }
  let membershipId: number | null = null
  if (input.approve) {
    // Match existing membership episodes. An earlier removal is never undone.
    const [active] = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.communityId, community.id),
          eq(members.userId, request.requesterId),
          isNull(members.removedAt)
        )
      )
      .for("share")
    if (active) membershipId = active.id
    else {
      const [created] = await tx
        .insert(members)
        .values({
          communityId: community.id,
          userId: request.requesterId,
          role: "member",
          addedById: input.actorId
        })
        .onConflictDoNothing()
        .returning({ id: members.id })
      if (created) membershipId = created.id
      else {
        const [concurrent] = await tx
          .select({ id: members.id })
          .from(members)
          .where(
            and(
              eq(members.communityId, community.id),
              eq(members.userId, request.requesterId),
              isNull(members.removedAt)
            )
          )
          .for("share")
        if (!concurrent)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Membership changed while approving this request. Try again."
          })
        membershipId = concurrent.id
      }
    }
  }
  await tx
    .update(requests)
    .set({
      status,
      membershipId,
      decidedById: input.actorId,
      decidedAt: sql`clock_timestamp()`
    })
    .where(eq(requests.id, request.id))
  return {
    id: request.id,
    status,
    membershipId,
    changed: true,
    communitySlug: community.slug
  }
}
