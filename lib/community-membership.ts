import "server-only"
import { TRPCError } from "@trpc/server"
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { communitiesTable, communityMembersTable, usersTable } from "@yamz/db"
import type { CommunityTransaction } from "./community-access"
import {
  maySetCommunityMember,
  maySetCommunityRole,
  mayRunCommunity,
  type CommunityRole
} from "./communities"

/** Serialize access grants with privacy changes and membership revocation.
 * Both the actor's authority and target's role are read under row locks. */
async function lockRosterChange(
  tx: CommunityTransaction,
  input: { communityId: number; actorId: number; targetId: number }
) {
  const [community] = await tx
    .select({
      id: communitiesTable.id,
      slug: communitiesTable.slug,
      title: communitiesTable.title,
      visibility: communitiesTable.visibility,
      joinToken: communitiesTable.joinToken,
      retiredAt: communitiesTable.retiredAt
    })
    .from(communitiesTable)
    .where(eq(communitiesTable.id, input.communityId))
    .for("update")
  if (!community)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This community doesn't exist."
    })
  const people = [...new Set([input.actorId, input.targetId])].sort(
    (a, b) => a - b
  )
  const memberships = await tx
    .select({
      id: communityMembersTable.id,
      userId: communityMembersTable.userId,
      role: communityMembersTable.role
    })
    .from(communityMembersTable)
    .where(
      and(
        eq(communityMembersTable.communityId, community.id),
        inArray(communityMembersTable.userId, people),
        isNull(communityMembersTable.removedAt)
      )
    )
    .orderBy(asc(communityMembersTable.userId))
    .for("update")
  // Lock in a stable order, including the target whose active context may be
  // cleared. This also makes a concurrent administrator-role change visible.
  const users = await tx
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(inArray(usersTable.id, people))
    .orderBy(asc(usersTable.id))
    .for("update")
  return {
    community,
    actor: users.find((user) => user.id === input.actorId) ?? null,
    target: users.find((user) => user.id === input.targetId),
    actorMembership:
      memberships.find((member) => member.userId === input.actorId) ?? null,
    targetMembership:
      memberships.find((member) => member.userId === input.targetId) ?? null
  }
}

export async function requireCommunityInvitationManager(
  tx: CommunityTransaction,
  communityId: number,
  actorId: number
) {
  const { community, actor, actorMembership } = await lockRosterChange(tx, {
    communityId,
    actorId,
    targetId: actorId
  })
  if (!mayRunCommunity(actor, actorMembership))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a steward can manage community invitations."
    })
  if (community.retiredAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This community has been retired."
    })
  return community
}

/** A shared link is not approval to read a members-only workspace. The lock
 * prevents a public link from being accepted across a privacy transition. */
export async function requireOpenCommunityJoin(
  tx: CommunityTransaction,
  communityId: number,
  token: string
) {
  const [community] = await tx
    .select({
      visibility: communitiesTable.visibility,
      joinToken: communitiesTable.joinToken,
      retiredAt: communitiesTable.retiredAt
    })
    .from(communitiesTable)
    .where(eq(communitiesTable.id, communityId))
    .for("share")
  if (!community || community.joinToken !== token || community.retiredAt)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This invitation link is not valid."
    })
  if (community.visibility === "members")
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This community requires approval. Open its community page to request access."
    })
}

export async function setCommunityMember(
  tx: CommunityTransaction,
  input: { communityId: number; actorId: number; targetId: number; on: boolean }
) {
  const { community, actor, target, actorMembership, targetMembership } =
    await lockRosterChange(tx, input)
  if (
    !maySetCommunityMember(
      actor,
      actorMembership,
      { userId: input.targetId, role: targetMembership?.role ?? null },
      input.on
    )
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a steward can change who is in this community."
    })
  if (!target)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This person doesn't exist."
    })
  if (community.retiredAt && input.on)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This community has been retired."
    })
  if (input.on && !targetMembership)
    await tx
      .insert(communityMembersTable)
      .values({
        communityId: community.id,
        userId: input.targetId,
        addedById: input.actorId
      })
      .onConflictDoNothing()
  else if (!input.on && targetMembership) {
    await tx
      .update(communityMembersTable)
      .set({ removedAt: sql`clock_timestamp()`, removedById: input.actorId })
      .where(eq(communityMembersTable.id, targetMembership.id))
    await tx
      .update(usersTable)
      .set({ activeCommunityId: null })
      .where(
        and(
          eq(usersTable.id, input.targetId),
          eq(usersTable.activeCommunityId, community.id)
        )
      )
  }
  return { communitySlug: community.slug, on: input.on }
}

export async function setCommunityMemberRole(
  tx: CommunityTransaction,
  input: {
    communityId: number
    actorId: number
    targetId: number
    role: CommunityRole
  }
) {
  const { community, actor, targetMembership } = await lockRosterChange(
    tx,
    input
  )
  if (!maySetCommunityRole(actor))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a curator can name a steward."
    })
  if (!targetMembership)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This person is not in this community."
    })
  await tx
    .update(communityMembersTable)
    .set({ role: input.role })
    .where(eq(communityMembersTable.id, targetMembership.id))
  return { communitySlug: community.slug, role: input.role }
}
