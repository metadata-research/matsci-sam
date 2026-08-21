import "server-only"

import { cache } from "react"
import {
  collectionsTable,
  communitiesTable,
  communityCollectionsTable,
  communityInvitationsTable,
  communityMembersTable,
  db,
  usersTable
} from "@yamz/db"
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"
import { hashOneTimeToken } from "@/lib/auth-tokens"
import { getCurrentUser } from "@/lib/current-user"
import { invitationOutcome, type InvitationOutcome } from "@/lib/communities"

export type InvitationView = {
  // A link addressed to one person, or the community's open join link.
  kind: "invitation" | "open"
  outcome: InvitationOutcome
  community: {
    id: number
    slug: string
    title: string
    description: string | null
    retiredAt: string | null
  }
  // The address the invitation was sent to, shown back so the person can tell
  // it was meant for them. Null for an open join link.
  email: string | null
}

const communityColumns = {
  id: communitiesTable.id,
  slug: communitiesTable.slug,
  title: communitiesTable.title,
  description: communitiesTable.description,
  retiredAt: communitiesTable.retiredAt
}

/*
 * Resolve a link. A per-person invitation is found by the digest of the token,
 * because only the digest is stored. An open join link is found by the token
 * itself, because it is stored readable so it can be pasted repeatedly.
 *
 * The two are tried in that order and share one route, so a person following a
 * link never has to know which kind they were given.
 */
export const invitationForToken = async (
  token: string
): Promise<InvitationView | null> => {
  const [invitation] = await db
    .select({
      email: communityInvitationsTable.email,
      expiresAt: communityInvitationsTable.expiresAt,
      revokedAt: communityInvitationsTable.revokedAt,
      redeemedAt: communityInvitationsTable.redeemedAt,
      community: communityColumns
    })
    .from(communityInvitationsTable)
    .innerJoin(
      communitiesTable,
      eq(communitiesTable.id, communityInvitationsTable.communityId)
    )
    .where(eq(communityInvitationsTable.tokenHash, hashOneTimeToken(token)))
    .limit(1)

  if (invitation)
    return {
      kind: "invitation",
      outcome: invitationOutcome(invitation),
      community: invitation.community,
      email: invitation.email
    }

  const [open] = await db
    .select(communityColumns)
    .from(communitiesTable)
    .where(eq(communitiesTable.joinToken, token))
    .limit(1)

  if (open)
    // An open link does not expire and is not spent. It is revoked by being
    // rotated or turned off, and then it simply stops resolving.
    return { kind: "open", outcome: "live", community: open, email: null }

  return null
}

export const isMemberOf = async (communityId: number, userId: number) => {
  const [row] = await db
    .select({ id: communityMembersTable.id })
    .from(communityMembersTable)
    .where(
      and(
        eq(communityMembersTable.communityId, communityId),
        eq(communityMembersTable.userId, userId),
        isNull(communityMembersTable.removedAt)
      )
    )
    .limit(1)
  return Boolean(row)
}

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/*
 * Which community a person is working in, resolved rather than trusted.
 *
 * The join is the validation. It returns null in all four cases that must be
 * unscoped, which are deliberately not collapsed into one boolean: signed out,
 * a member of nothing, a member who has not chosen, and a choice that no
 * longer holds because the person left or the community retired. Callers
 * branch on null, never on "has a community", because giving a scoped view to
 * someone who never asked for one is the failure that matters here.
 *
 * It takes an executor so Phase 3 can resolve inside the transaction that
 * writes a vote, the shape lib/definition-revisions.ts already uses. Nothing
 * else reads users.activeCommunityId directly.
 */
export const activeCommunityFor = async (
  executor: typeof db | DatabaseTransaction,
  userId: number
) => {
  const [row] = await executor
    .select({
      id: communitiesTable.id,
      slug: communitiesTable.slug,
      title: communitiesTable.title
    })
    .from(usersTable)
    .innerJoin(
      communitiesTable,
      eq(communitiesTable.id, usersTable.activeCommunityId)
    )
    .innerJoin(
      communityMembersTable,
      and(
        eq(communityMembersTable.communityId, communitiesTable.id),
        eq(communityMembersTable.userId, usersTable.id),
        isNull(communityMembersTable.removedAt)
      )
    )
    .where(and(eq(usersTable.id, userId), isNull(communitiesTable.retiredAt)))
    .limit(1)

  return row ?? null
}

// React's request cache lets the header, the layout and every scoped page
// share one lookup, the way getCurrentUser already does.
export const getActiveCommunity = cache(async () => {
  const user = await getCurrentUser()
  return user ? activeCommunityFor(db, user.id) : null
})

// The communities a person may switch into. Retired ones are not offered.
export const myCommunities = cache(async (userId: number) =>
  db
    .select({
      id: communitiesTable.id,
      slug: communitiesTable.slug,
      title: communitiesTable.title,
      role: communityMembersTable.role
    })
    .from(communityMembersTable)
    .innerJoin(
      communitiesTable,
      eq(communitiesTable.id, communityMembersTable.communityId)
    )
    .where(
      and(
        eq(communityMembersTable.userId, userId),
        isNull(communityMembersTable.removedAt),
        isNull(communitiesTable.retiredAt)
      )
    )
    .orderBy(asc(sql`lower(btrim(${communitiesTable.title}))`))
)

const livePeople = sql<number>`cast(count(distinct ${communityMembersTable.id}) as int)`
const liveCollections = sql<number>`cast(count(distinct ${communityCollectionsTable.id}) as int)`

/*
 * The index listing. Counts come from LEFT JOINs whose liveness test is in the
 * ON clause, following lib/kos-queries.ts: moved into WHERE they would turn
 * the joins inner and drop every community with an empty roster or worklist.
 */
export const communitiesWithCounts = async ({
  includeRetired = false
}: { includeRetired?: boolean } = {}) =>
  db
    .select({
      id: communitiesTable.id,
      slug: communitiesTable.slug,
      title: communitiesTable.title,
      description: communitiesTable.description,
      retiredAt: communitiesTable.retiredAt,
      people: livePeople,
      collections: liveCollections
    })
    .from(communitiesTable)
    .leftJoin(
      communityMembersTable,
      and(
        eq(communityMembersTable.communityId, communitiesTable.id),
        isNull(communityMembersTable.removedAt)
      )
    )
    .leftJoin(
      communityCollectionsTable,
      and(
        eq(communityCollectionsTable.communityId, communitiesTable.id),
        isNull(communityCollectionsTable.removedAt)
      )
    )
    .where(includeRetired ? undefined : isNull(communitiesTable.retiredAt))
    .groupBy(communitiesTable.id)
    .orderBy(asc(sql`lower(btrim(${communitiesTable.title}))`))

export const communityBySlug = async (slug: string) => {
  const [row] = await db
    .select({
      id: communitiesTable.id,
      slug: communitiesTable.slug,
      title: communitiesTable.title,
      description: communitiesTable.description,
      retiredAt: communitiesTable.retiredAt,
      joinToken: communitiesTable.joinToken
    })
    .from(communitiesTable)
    .where(eq(communitiesTable.slug, slug))
    .limit(1)
  return row ?? null
}

// The viewer's own standing in one community, which every rule on the page
// takes as its second argument.
export const membershipIn = async (communityId: number, userId: number) => {
  const [row] = await db
    .select({ role: communityMembersTable.role })
    .from(communityMembersTable)
    .where(
      and(
        eq(communityMembersTable.communityId, communityId),
        eq(communityMembersTable.userId, userId),
        isNull(communityMembersTable.removedAt)
      )
    )
    .limit(1)
  return row ?? null
}

export const communityRoster = async (communityId: number) =>
  db
    .select({
      userId: usersTable.id,
      name: usersTable.name,
      isProfilePublic: usersTable.isProfilePublic,
      role: communityMembersTable.role,
      addedAt: communityMembersTable.addedAt
    })
    .from(communityMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, communityMembersTable.userId))
    .where(
      and(
        eq(communityMembersTable.communityId, communityId),
        isNull(communityMembersTable.removedAt)
      )
    )
    .orderBy(asc(sql`lower(btrim(coalesce(${usersTable.name}, '')))`))

// A worklist entry may name a collection that has since been retired, because
// retiring a collection does not touch the communities working on it. The
// retired flag comes back so the page can say so.
export const communityWorklist = async (communityId: number) =>
  db
    .select({
      id: collectionsTable.id,
      slug: collectionsTable.slug,
      title: collectionsTable.title,
      retiredAt: collectionsTable.retiredAt
    })
    .from(communityCollectionsTable)
    .innerJoin(
      collectionsTable,
      eq(collectionsTable.id, communityCollectionsTable.collectionId)
    )
    .where(
      and(
        eq(communityCollectionsTable.communityId, communityId),
        isNull(communityCollectionsTable.removedAt)
      )
    )
    .orderBy(asc(sql`lower(btrim(${collectionsTable.title}))`))

// Invitations, newest first. No token and no digest leaves this function.
export const communityInvitations = async (communityId: number) =>
  db
    .select({
      id: communityInvitationsTable.id,
      email: communityInvitationsTable.email,
      sentAt: communityInvitationsTable.sentAt,
      expiresAt: communityInvitationsTable.expiresAt,
      revokedAt: communityInvitationsTable.revokedAt,
      redeemedAt: communityInvitationsTable.redeemedAt,
      createdAt: communityInvitationsTable.createdAt
    })
    .from(communityInvitationsTable)
    .where(eq(communityInvitationsTable.communityId, communityId))
    .orderBy(desc(communityInvitationsTable.createdAt))
