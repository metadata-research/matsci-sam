import { z } from "zod"
import { authenticatedProcedure } from "../procedures"
import { createTRPCRouter } from "../init"
import {
  communitiesTable,
  communityCollectionsTable,
  communityInvitationsTable,
  communityMembersTable,
  collectionsTable,
  db,
  usersTable
} from "@yamz/db"
import { and, eq, isNull, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import { GetUser } from "@/lib/crud"
import { createOneTimeToken, hashOneTimeToken } from "@/lib/auth-tokens"
import { EmailAddressSchema } from "@/lib/email-auth"
import { sendCommunityInvitation } from "@/lib/email"
import {
  INVITATION_LIFETIME_DAYS,
  invitationExpiry,
  mayManageCommunity,
  mayRunCommunity,
  maySearchPeople,
  maySetCommunityMember,
  maySetCommunityRole,
  type CommunityRole
} from "@/lib/communities"
import { uniqueSlug } from "@/lib/slug"
import {
  collectionsIndexPath,
  communitiesIndexPath,
  communityPath,
  invitePath
} from "@/lib/public-identifiers"

/*
 * Communities: a named group of people, and what they are working through.
 *
 * A community is people. A collection is terms. Neither owns the other, and a
 * community owns nothing in the vocabulary at all. Membership is a row here
 * rather than a statement in the ledger, because the ledger publishes every
 * non-retracted row it holds and lab affiliation is not a disclosure this
 * project has made.
 *
 * An administrator owns the community record. A steward runs the roster, the
 * worklist and the invitations of the one community they steward. The rules
 * are in lib/communities.ts so the pages and the tests answer them the same
 * way this file does.
 */

const TITLE_MAX = 120
const DESCRIPTION_MAX = 2000

const loadCommunity = async (id: number) => {
  const [row] = await db
    .select({
      id: communitiesTable.id,
      slug: communitiesTable.slug,
      title: communitiesTable.title,
      retiredAt: communitiesTable.retiredAt
    })
    .from(communitiesTable)
    .where(eq(communitiesTable.id, id))
    .limit(1)
  return row ?? null
}

// The caller's live membership of one community, or null. A closed episode is
// not a membership.
const membershipOf = async (communityId: number, userId: number) => {
  const [row] = await db
    .select({ id: communityMembersTable.id, role: communityMembersTable.role })
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

const requireCommunity = async (communityId: number) => {
  const community = await loadCommunity(communityId)
  if (!community)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This community doesn't exist"
    })
  return community
}

// Running the community: the worklist, invitations and the join link. A
// retired community accepts none of it until it is restored.
const requireRunner = async (communityId: number, userId: number) => {
  const community = await requireCommunity(communityId)
  if (community.retiredAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This community has been retired"
    })

  const [viewer, membership] = await Promise.all([
    GetUser(userId),
    membershipOf(communityId, userId)
  ])
  if (!mayRunCommunity(viewer ?? null, membership))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a steward can change this community"
    })

  return community
}

const requireAdmin = async (userId: number, message: string) => {
  const user = await GetUser(userId)
  if (!mayManageCommunity(user ?? null))
    throw new TRPCError({ code: "FORBIDDEN", message })
  return user
}

export const communitiesRouter = createTRPCRouter({
  create: authenticatedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(TITLE_MAX),
        description: z.string().trim().max(DESCRIPTION_MAX).optional()
      })
    )
    .mutation(async ({ ctx: { userId }, input: { title, description } }) => {
      await requireAdmin(userId, "Only a curator can create a community")

      const taken = await db
        .select({ slug: communitiesTable.slug })
        .from(communitiesTable)
      // The third argument is not optional here. uniqueSlug returns
      // slugify(term) || fallback, and the default fallback is "term", so a
      // title that slugifies to nothing would otherwise mint a community at
      // /communities/term.
      const slug = uniqueSlug(
        title,
        new Set(taken.map((row) => row.slug)),
        "community"
      )

      const [created] = await db
        .insert(communitiesTable)
        .values({
          slug,
          title,
          description: description || null,
          createdById: userId
        })
        .returning({
          id: communitiesTable.id,
          slug: communitiesTable.slug
        })

      revalidatePath(communitiesIndexPath)

      return created
    }),

  update: authenticatedProcedure
    .input(
      z.object({
        communityId: z.number().int(),
        title: z.string().trim().min(1).max(TITLE_MAX).optional(),
        description: z.string().trim().max(DESCRIPTION_MAX).nullish()
      })
    )
    .mutation(
      async ({ ctx: { userId }, input: { communityId, title, description } }) => {
        await requireAdmin(userId, "Only a curator can rename a community")
        const community = await requireCommunity(communityId)

        // The slug is not derived again. The address stays put when the title
        // it came from changes.
        await db
          .update(communitiesTable)
          .set({
            ...(title === undefined ? {} : { title }),
            ...(description === undefined
              ? {}
              : { description: description || null })
          })
          .where(eq(communitiesTable.id, communityId))

        revalidatePath(communitiesIndexPath)
        revalidatePath(communityPath(community.slug))

        return { ok: true }
      }
    ),

  setMember: authenticatedProcedure
    .input(
      z.object({
        communityId: z.number().int(),
        userId: z.number().int(),
        on: z.boolean()
      })
    )
    .mutation(
      async ({
        ctx: { userId: callerId },
        input: { communityId, userId: targetId, on }
      }) => {
        const community = await requireCommunity(communityId)
        // Adding to a retired community is meaningless. Leaving one is not, so
        // only the add is refused: nobody is frozen into a group that ended.
        if (community.retiredAt && on)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This community has been retired"
          })

        const [caller, callerMembership, targetMembership] = await Promise.all([
          GetUser(callerId),
          membershipOf(communityId, callerId),
          membershipOf(communityId, targetId)
        ])

        if (
          !maySetCommunityMember(
            caller ?? null,
            callerMembership,
            { userId: targetId, role: targetMembership?.role ?? null },
            on
          )
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only a steward can change who is in this community"
          })

        const [target] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.id, targetId))
          .limit(1)
        if (!target)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This person doesn't exist"
          })

        await db.transaction(async (tx) => {
          if (on && !targetMembership)
            await tx
              .insert(communityMembersTable)
              .values({
                communityId,
                userId: targetId,
                addedById: callerId
              })
              .onConflictDoNothing()
          else if (!on && targetMembership) {
            await tx
              .update(communityMembersTable)
              .set({ removedAt: sql`now()`, removedById: callerId })
              .where(eq(communityMembersTable.id, targetMembership.id))

            // A scope nobody can use must not persist. Cleared in the same
            // transaction as the removal, which is what lets the invariant
            // hold in its strong form.
            await tx
              .update(usersTable)
              .set({ activeCommunityId: null })
              .where(
                and(
                  eq(usersTable.id, targetId),
                  eq(usersTable.activeCommunityId, communityId)
                )
              )
          }
        })

        revalidatePath(communitiesIndexPath)
        revalidatePath(communityPath(community.slug))
        if (!on) revalidatePath("/", "layout")

        return { ok: true, on }
      }
    ),

  // Naming a steward is an administrator's act, because a steward who could
  // appoint stewards could hand out roster control indefinitely.
  setRole: authenticatedProcedure
    .input(
      z.object({
        communityId: z.number().int(),
        userId: z.number().int(),
        role: z.enum(["member", "steward"])
      })
    )
    .mutation(
      async ({
        ctx: { userId: callerId },
        input: { communityId, userId: targetId, role }
      }) => {
        const caller = await GetUser(callerId)
        if (!maySetCommunityRole(caller ?? null))
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only a curator can name a steward"
          })
        const community = await requireCommunity(communityId)

        const membership = await membershipOf(communityId, targetId)
        if (!membership)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This person is not in this community"
          })

        await db
          .update(communityMembersTable)
          .set({ role: role as CommunityRole })
          .where(eq(communityMembersTable.id, membership.id))

        revalidatePath(communityPath(community.slug))

        return { ok: true, role }
      }
    ),

  setCollection: authenticatedProcedure
    .input(
      z.object({
        communityId: z.number().int(),
        collectionId: z.number().int(),
        on: z.boolean()
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: { communityId, collectionId, on }
      }) => {
        const community = await requireRunner(communityId, userId)

        const [collection] = await db
          .select({
            id: collectionsTable.id,
            slug: collectionsTable.slug,
            retiredAt: collectionsTable.retiredAt
          })
          .from(collectionsTable)
          .where(eq(collectionsTable.id, collectionId))
          .limit(1)
        if (!collection)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This collection doesn't exist"
          })
        if (collection.retiredAt && on)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This collection has been retired"
          })

        await db.transaction(async (tx) => {
          const [active] = await tx
            .select({ id: communityCollectionsTable.id })
            .from(communityCollectionsTable)
            .where(
              and(
                eq(communityCollectionsTable.communityId, communityId),
                eq(communityCollectionsTable.collectionId, collectionId),
                isNull(communityCollectionsTable.removedAt)
              )
            )
            .limit(1)

          if (on && !active)
            await tx
              .insert(communityCollectionsTable)
              .values({ communityId, collectionId, addedById: userId })
              .onConflictDoNothing()
          else if (!on && active)
            await tx
              .update(communityCollectionsTable)
              .set({ removedAt: sql`now()`, removedById: userId })
              .where(eq(communityCollectionsTable.id, active.id))
        })

        revalidatePath(communitiesIndexPath)
        revalidatePath(communityPath(community.slug))
        // The worklist decides what a scoped Browse shows.
        revalidatePath("/terms")

        return { ok: true, on }
      }
    ),

  /*
   * Retiring keeps the roster and the worklist. Retracting them would record
   * that everyone left, and nobody did, which is the same reasoning
   * collections.restore gives for not re-asserting on the way back. What it
   * does clear is every pointer into it, because a scope nobody can select
   * must not persist.
   */
  retire: authenticatedProcedure
    .input(z.object({ communityId: z.number().int() }))
    .mutation(async ({ ctx: { userId }, input: { communityId } }) => {
      await requireAdmin(
        userId,
        "Only a curator can retire or restore a community"
      )
      const community = await requireCommunity(communityId)

      await db.transaction(async (tx) => {
        await tx
          .update(communitiesTable)
          .set({ retiredAt: sql`now()` })
          .where(eq(communitiesTable.id, communityId))

        await tx
          .update(usersTable)
          .set({ activeCommunityId: null })
          .where(eq(usersTable.activeCommunityId, communityId))
      })

      revalidatePath(communitiesIndexPath)
      revalidatePath(communityPath(community.slug))
      revalidatePath("/", "layout")

      return { ok: true }
    }),

  restore: authenticatedProcedure
    .input(z.object({ communityId: z.number().int() }))
    .mutation(async ({ ctx: { userId }, input: { communityId } }) => {
      await requireAdmin(
        userId,
        "Only a curator can retire or restore a community"
      )
      const community = await requireCommunity(communityId)

      // Symmetric, because retiring left the roster alone. The community comes
      // back with its people and there is no asymmetry to explain.
      await db
        .update(communitiesTable)
        .set({ retiredAt: null })
        .where(eq(communitiesTable.id, communityId))

      revalidatePath(communitiesIndexPath)
      revalidatePath(communityPath(community.slug))

      return { ok: true }
    }),

  /*
   * Invite one named person. The raw token is returned exactly once, here,
   * because only its digest is stored. Losing it means reissuing, which mints
   * a new token and kills the old one.
   */
  invite: authenticatedProcedure
    .input(
      z.object({
        communityId: z.number().int(),
        email: EmailAddressSchema,
        send: z.boolean().default(false)
      })
    )
    .mutation(
      async ({ ctx: { userId }, input: { communityId, email, send } }) => {
        const community = await requireRunner(communityId, userId)

        const token = createOneTimeToken()
        const [created] = await db
          .insert(communityInvitationsTable)
          .values({
            communityId,
            email,
            tokenHash: hashOneTimeToken(token),
            invitedById: userId,
            expiresAt: invitationExpiry().toISOString()
          })
          .returning({ id: communityInvitationsTable.id })

        const link = invitePath(token)
        // Sending happens here or not at all. The digest is all that survives,
        // so a later "resend" is a reissue with a new token.
        if (send) {
          await sendCommunityInvitation({
            email,
            token,
            communityTitle: community.title
          })
          await db
            .update(communityInvitationsTable)
            .set({ sentAt: sql`now()` })
            .where(eq(communityInvitationsTable.id, created.id))
        }

        revalidatePath(communityPath(community.slug))

        return {
          id: created.id,
          link,
          sent: send,
          expiresInDays: INVITATION_LIFETIME_DAYS
        }
      }
    ),

  // A new token for the same invitation. The old link stops working, which is
  // what makes this safe to offer for a link someone mislaid.
  reissueInvitation: authenticatedProcedure
    .input(
      z.object({
        invitationId: z.number().int(),
        send: z.boolean().default(false)
      })
    )
    .mutation(async ({ ctx: { userId }, input: { invitationId, send } }) => {
      const [invitation] = await db
        .select({
          id: communityInvitationsTable.id,
          communityId: communityInvitationsTable.communityId,
          email: communityInvitationsTable.email,
          redeemedAt: communityInvitationsTable.redeemedAt,
          revokedAt: communityInvitationsTable.revokedAt
        })
        .from(communityInvitationsTable)
        .where(eq(communityInvitationsTable.id, invitationId))
        .limit(1)
      if (!invitation)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This invitation doesn't exist"
        })

      const community = await requireRunner(invitation.communityId, userId)

      if (invitation.redeemedAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invitation has already been accepted"
        })
      if (invitation.revokedAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invitation has been revoked"
        })

      const token = createOneTimeToken()
      await db
        .update(communityInvitationsTable)
        .set({
          tokenHash: hashOneTimeToken(token),
          expiresAt: invitationExpiry().toISOString(),
          sentAt: null
        })
        .where(eq(communityInvitationsTable.id, invitationId))

      if (send) {
        await sendCommunityInvitation({
          email: invitation.email,
          token,
          communityTitle: community.title
        })
        await db
          .update(communityInvitationsTable)
          .set({ sentAt: sql`now()` })
          .where(eq(communityInvitationsTable.id, invitationId))
      }

      revalidatePath(communityPath(community.slug))

      return {
        id: invitationId,
        link: invitePath(token),
        sent: send,
        expiresInDays: INVITATION_LIFETIME_DAYS
      }
    }),

  revokeInvitation: authenticatedProcedure
    .input(z.object({ invitationId: z.number().int() }))
    .mutation(async ({ ctx: { userId }, input: { invitationId } }) => {
      const [invitation] = await db
        .select({
          id: communityInvitationsTable.id,
          communityId: communityInvitationsTable.communityId,
          redeemedAt: communityInvitationsTable.redeemedAt
        })
        .from(communityInvitationsTable)
        .where(eq(communityInvitationsTable.id, invitationId))
        .limit(1)
      if (!invitation)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This invitation doesn't exist"
        })

      const community = await requireRunner(invitation.communityId, userId)

      // An invitation ends once and one way. Revoking a redeemed one would
      // leave no answer to whether the person was admitted.
      if (invitation.redeemedAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invitation has already been accepted"
        })

      await db
        .update(communityInvitationsTable)
        .set({ revokedAt: sql`now()`, revokedById: userId })
        .where(eq(communityInvitationsTable.id, invitationId))

      revalidatePath(communityPath(community.slug))

      return { ok: true }
    }),

  /*
   * The shareable join link. Unlike an invitation it is stored readable, so it
   * can be re-read and pasted, and it admits whoever holds it. Turning it off
   * is setting it to null, and rotating it is minting a new one, which is the
   * only way to revoke a link already in circulation.
   */
  setJoinLink: authenticatedProcedure
    .input(
      z.object({
        communityId: z.number().int(),
        on: z.boolean(),
        // Minting a new token kills the one already in circulation, so it is
        // asked for explicitly. Turning an already-open link on again is a
        // no-op rather than a silent rotation, because a steward pressing the
        // switch twice must not break a link they have already pasted.
        rotate: z.boolean().default(false)
      })
    )
    .mutation(
      async ({ ctx: { userId }, input: { communityId, on, rotate } }) => {
        const community = await requireRunner(communityId, userId)

        const [current] = await db
          .select({ joinToken: communitiesTable.joinToken })
          .from(communitiesTable)
          .where(eq(communitiesTable.id, communityId))
          .limit(1)

        if (on && current?.joinToken && !rotate)
          return { ok: true, link: invitePath(current.joinToken), rotated: false }

        const token = on ? createOneTimeToken() : null
        await db
          .update(communitiesTable)
          .set({ joinToken: token })
          .where(eq(communitiesTable.id, communityId))

        revalidatePath(communityPath(community.slug))

        return {
          ok: true,
          link: token ? invitePath(token) : null,
          rotated: Boolean(token)
        }
      }
    ),

  /*
   * Accept. Deliberately a mutation behind a button rather than a side effect
   * of loading the link, so a mail scanner or a link prefetcher cannot spend
   * an invitation on the invitee's behalf.
   *
   * The token is a bearer credential and is not checked against the address it
   * was sent to. An invitee whose institutional and Google addresses differ
   * would otherwise be stranded with no way to fix it.
   */
  accept: authenticatedProcedure
    .input(z.object({ token: z.string().min(1).max(128) }))
    .mutation(async ({ ctx: { userId }, input: { token } }) => {
      const digest = hashOneTimeToken(token)

      const [invitation] = await db
        .select({
          id: communityInvitationsTable.id,
          communityId: communityInvitationsTable.communityId,
          expiresAt: communityInvitationsTable.expiresAt,
          revokedAt: communityInvitationsTable.revokedAt,
          redeemedAt: communityInvitationsTable.redeemedAt
        })
        .from(communityInvitationsTable)
        .where(eq(communityInvitationsTable.tokenHash, digest))
        .limit(1)

      const [openCommunity] = invitation
        ? []
        : await db
            .select({ id: communitiesTable.id })
            .from(communitiesTable)
            .where(eq(communitiesTable.joinToken, token))
            .limit(1)

      const communityId = invitation?.communityId ?? openCommunity?.id
      if (!communityId)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This invitation link is not valid"
        })

      const community = await requireCommunity(communityId)
      if (community.retiredAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This community has been retired"
        })

      if (invitation) {
        if (invitation.revokedAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This invitation has been revoked"
          })
        if (invitation.redeemedAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This invitation has already been used"
          })
        if (new Date(invitation.expiresAt) <= new Date())
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This invitation has expired"
          })
      }

      const existing = await membershipOf(communityId, userId)
      if (existing) {
        // Already in. Not an error: the person did what they were asked to do.
        if (invitation && !invitation.redeemedAt)
          await db
            .update(communityInvitationsTable)
            .set({ redeemedAt: sql`now()`, redeemedById: userId })
            .where(eq(communityInvitationsTable.id, invitation.id))

        return {
          ok: true,
          slug: community.slug,
          alreadyIn: true,
          nowWorkingIn: null
        }
      }

      let nowWorkingIn: string | null = null

      await db.transaction(async (tx) => {
        // An invitee joins as a member. A steward is named by an
        // administrator, never granted by a link.
        await tx
          .insert(communityMembersTable)
          .values({
            communityId,
            userId,
            addedById: userId
          })
          .onConflictDoNothing()

        // Someone who has never chosen a scope starts working in the community
        // they just joined, which is what the invitation page told them would
        // happen. A person who already has a scope keeps it, because accepting
        // a second invitation must not move them out of the first.
        const [switched] = await tx
          .update(usersTable)
          .set({ activeCommunityId: communityId })
          .where(
            and(
              eq(usersTable.id, userId),
              isNull(usersTable.activeCommunityId)
            )
          )
          .returning({ id: usersTable.id })
        if (switched) nowWorkingIn = community.title

        if (invitation)
          await tx
            .update(communityInvitationsTable)
            .set({ redeemedAt: sql`now()`, redeemedById: userId })
            .where(
              and(
                eq(communityInvitationsTable.id, invitation.id),
                isNull(communityInvitationsTable.redeemedAt)
              )
            )
      })

      revalidatePath(communitiesIndexPath)
      revalidatePath(communityPath(community.slug))
      revalidatePath("/", "layout")
      revalidatePath("/terms")
      revalidatePath(collectionsIndexPath)

      return { ok: true, slug: community.slug, alreadyIn: false, nowWorkingIn }
    }),

  /*
   * The caller's own standing choice of which community to work in. No curator
   * gate: this is a preference, not an act on the community.
   *
   * The whole thing runs in one transaction with the membership row locked,
   * because the check and the write must not straddle a concurrent removal or
   * retirement. Both of those clear the pointer, and both would clear nothing
   * if they committed between a bare SELECT here and the UPDATE that follows.
   * The result would be a pointer into a community the caller has just left,
   * which drizzle/invariants.sql raises on, and that file gates a release.
   */
  setActive: authenticatedProcedure
    .input(z.object({ communityId: z.number().int().nullable() }))
    .mutation(async ({ ctx: { userId }, input: { communityId } }) => {
      // Clearing is always accepted, with no lookup at all. The escape from a
      // scope must never be refusable.
      if (communityId === null) {
        await db
          .update(usersTable)
          .set({ activeCommunityId: null })
          .where(eq(usersTable.id, userId))
        revalidatePath("/", "layout")
        return { ok: true, title: null }
      }

      const title = await db.transaction(async (tx) => {
        const [membership] = await tx
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
          .for("update")

        const [community] = await tx
          .select({
            title: communitiesTable.title,
            retiredAt: communitiesTable.retiredAt
          })
          .from(communitiesTable)
          .where(eq(communitiesTable.id, communityId))
          .limit(1)

        if (!membership || !community || community.retiredAt)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You are not in that community"
          })

        await tx
          .update(usersTable)
          .set({ activeCommunityId: communityId })
          .where(eq(usersTable.id, userId))

        return community.title
      })

      revalidatePath("/", "layout")
      revalidatePath(communitiesIndexPath)
      revalidatePath("/terms")

      return { ok: true, title }
    }),

  /*
   * Find someone to add. The only query procedure here, and the only path by
   * which a non-administrator reads anything about accounts other than their
   * own, so it is narrow by construction: gated on maySearchPeople, it never
   * returns an email address, and it returns affiliation only for a profile
   * its owner made public. trpc.admin.users cannot serve this, because it
   * returns addresses and is adminProcedure.
   */
  searchPeople: authenticatedProcedure
    .input(
      z.object({
        communityId: z.number().int(),
        query: z.string().trim().min(2).max(80)
      })
    )
    .query(async ({ ctx: { userId }, input: { communityId, query } }) => {
      const [viewer, membership] = await Promise.all([
        GetUser(userId),
        membershipOf(communityId, userId)
      ])
      if (!maySearchPeople(viewer ?? null, membership))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only a steward can look people up"
        })

      const term = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`

      return db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          // Only for a profile its owner chose to make public. Everyone else
          // is a bare name, which is what they agreed to.
          affiliation: sql<
            string | null
          >`case when ${usersTable.isProfilePublic} then ${usersTable.affiliation} end`,
          isMember: sql<boolean>`exists (
            select 1 from ${communityMembersTable} m
            where m."communityId" = ${communityId}
              and m."userId" = ${usersTable.id}
              and m."removedAt" is null
          )`
        })
        .from(usersTable)
        .where(
          and(
            sql`${usersTable.name} ilike ${term}`,
            // A model contributes definitions but does not belong to a lab.
            // Nothing forbids it in the schema, because a panel of models is
            // plausible later; this is only the affordance.
            eq(usersTable.isAi, false)
          )
        )
        .orderBy(usersTable.name)
        .limit(10)
    })
})
