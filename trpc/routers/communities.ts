import { z } from "zod"
import { authenticatedProcedure } from "../procedures"
import { createTRPCRouter } from "../init"
import {
  communitiesTable,
  communityCollectionsTable,
  communityInvitationsTable,
  communityMembersTable,
  collectionsTable,
  studiesTable,
  db,
  termsTable,
  usersTable,
  vocabulariesTable
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
  studyAcceptsParticipants,
  maySetCommunityMember,
  maySetCommunityRole,
  type CommunityRole
} from "@/lib/communities"
import { uniqueSlug } from "@/lib/slug"
import { setStudyRetired, updateStudyDetails } from "@/lib/study-update"
import { lockMembershipIn } from "@/lib/community-queries"
import { lockStudy } from "@/lib/survey-queries"
import {
  collectionsIndexPath,
  communitiesIndexPath,
  communityPath,
  invitePath,
  studiesIndexPath,
  studyPath
} from "@/lib/public-identifiers"

/*
 * Communities: a named group of people, and what they are working through.
 *
 * A community is people and owns one vocabulary namespace. Collections remain
 * independent worklists: they may contain locally defined terms or references
 * to concepts in another vocabulary. Membership is a row here rather than a
 * statement in the ledger, because the ledger publishes every non-retracted
 * row it holds and lab affiliation is not a disclosure this project has made.
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
      vocabularySlug: communitiesTable.vocabularySlug,
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
// retired community accepts none of it until it is restored. Exported for
// the surveys router, whose steward acts take the same rule.
export const requireRunner = async (communityId: number, userId: number) => {
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

const requireStudy = async (studyId: number) => {
  const [row] = await db
    .select({
      id: studiesTable.id,
      slug: studiesTable.slug,
      communityId: studiesTable.communityId
    })
    .from(studiesTable)
    .where(eq(studiesTable.id, studyId))
    .limit(1)
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This study doesn't exist"
    })
  return row
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

      const [vocabularySlugs, rootTermSlugs] = await Promise.all([
        db.select({ slug: vocabulariesTable.slug }).from(vocabulariesTable),
        db
          .select({ slug: termsTable.slug })
          .from(termsTable)
          .innerJoin(
            vocabulariesTable,
            and(
              eq(vocabulariesTable.slug, termsTable.vocabularySlug),
              eq(vocabulariesTable.isDefault, true)
            )
          )
      ])
      // The third argument is not optional here. uniqueSlug returns
      // slugify(term) || fallback, and the default fallback is "term", so a
      // title that slugifies to nothing would otherwise mint a community at
      // /communities/term.
      const slug = uniqueSlug(
        title,
        new Set([...vocabularySlugs, ...rootTermSlugs].map((row) => row.slug)),
        "community"
      )

      const created = await db.transaction(async (tx) => {
        await tx.insert(vocabulariesTable).values({
          slug,
          title,
          description: description || null,
          createdById: userId
        })

        const [community] = await tx
          .insert(communitiesTable)
          .values({
            slug,
            vocabularySlug: slug,
            title,
            description: description || null,
            createdById: userId
          })
          .returning({
            id: communitiesTable.id,
            slug: communitiesTable.slug
          })

        return community
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
      async ({
        ctx: { userId },
        input: { communityId, title, description }
      }) => {
        await requireAdmin(userId, "Only a curator can rename a community")
        const community = await requireCommunity(communityId)

        // The slug is not derived again. The address stays put when the title
        // it came from changes.
        await db.transaction(async (tx) => {
          await tx
            .update(communitiesTable)
            .set({
              ...(title === undefined ? {} : { title }),
              ...(description === undefined
                ? {}
                : { description: description || null })
            })
            .where(eq(communitiesTable.id, communityId))

          await tx
            .update(vocabulariesTable)
            .set({
              ...(title === undefined ? {} : { title }),
              ...(description === undefined
                ? {}
                : { description: description || null })
            })
            .where(eq(vocabulariesTable.slug, community.vocabularySlug))
        })

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

  /*
   * Make a collection and put it straight on the worklist. A steward already
   * decides what their community works through, and requiring them to make the
   * collection somewhere else first is the step that gets forgotten.
   *
   * It is stamped by the standing of whoever made it, so a steward can go on
   * to add terms to what they just made.
   */
  createWorklistCollection: authenticatedProcedure
    .input(
      z.object({
        communityId: z.number().int(),
        title: z.string().trim().min(1).max(TITLE_MAX),
        description: z.string().trim().max(DESCRIPTION_MAX).optional()
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: { communityId, title, description }
      }) => {
        const community = await requireRunner(communityId, userId)
        const runner = await GetUser(userId)

        const taken = await db
          .select({ slug: collectionsTable.slug })
          .from(collectionsTable)

        const created = await db.transaction(async (tx) => {
          const [collection] = await tx
            .insert(collectionsTable)
            .values({
              slug: uniqueSlug(
                title,
                new Set(taken.map((row) => row.slug)),
                "collection"
              ),
              title,
              description: description || null,
              assertableBy:
                runner?.role === "admin" ? "curator" : "contributor",
              createdById: userId
            })
            .returning({
              id: collectionsTable.id,
              slug: collectionsTable.slug
            })

          await tx.insert(communityCollectionsTable).values({
            communityId,
            collectionId: collection.id,
            addedById: userId
          })

          return collection
        })

        revalidatePath(communityPath(community.slug))
        revalidatePath(collectionsIndexPath)
        revalidatePath("/terms")

        return created
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
      async ({ ctx: { userId }, input: { communityId, collectionId, on } }) => {
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
          .update(vocabulariesTable)
          .set({ retiredAt: sql`now()` })
          .where(eq(vocabulariesTable.slug, community.vocabularySlug))

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
      await db.transaction(async (tx) => {
        await tx
          .update(communitiesTable)
          .set({ retiredAt: null })
          .where(eq(communitiesTable.id, communityId))
        await tx
          .update(vocabulariesTable)
          .set({ retiredAt: null })
          .where(eq(vocabulariesTable.slug, community.vocabularySlug))
      })

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
        send: z.boolean().default(false),
        // When set, the invitee lands on the instructions for this study
        // rather than on a bare "you have been invited" page.
        studyId: z.number().int().optional()
      })
    )
    .mutation(
      async ({
        ctx: { userId },
        input: { communityId, email, send, studyId }
      }) => {
        const community = await requireRunner(communityId, userId)

        if (studyId !== undefined) {
          const study = await requireStudy(studyId)
          if (study.communityId !== communityId)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "That study belongs to another community"
            })
        }

        const token = createOneTimeToken()
        const [created] = await db
          .insert(communityInvitationsTable)
          .values({
            communityId,
            email,
            tokenHash: hashOneTimeToken(token),
            invitedById: userId,
            studyId: studyId ?? null,
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
          tokenHash: communityInvitationsTable.tokenHash
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

      const token = createOneTimeToken()
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            tokenHash: communityInvitationsTable.tokenHash,
            redeemedAt: communityInvitationsTable.redeemedAt,
            revokedAt: communityInvitationsTable.revokedAt
          })
          .from(communityInvitationsTable)
          .where(eq(communityInvitationsTable.id, invitationId))
          .limit(1)
          .for("update")
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This invitation doesn't exist"
          })
        if (current.redeemedAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This invitation has already been accepted"
          })
        if (current.revokedAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This invitation has been revoked"
          })
        if (current.tokenHash !== invitation.tokenHash)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This invitation was reissued. Reload before trying again."
          })

        await tx
          .update(communityInvitationsTable)
          .set({
            tokenHash: hashOneTimeToken(token),
            expiresAt: invitationExpiry().toISOString(),
            sentAt: null
          })
          .where(eq(communityInvitationsTable.id, invitationId))
      })

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
          communityId: communityInvitationsTable.communityId
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

      await db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            redeemedAt: communityInvitationsTable.redeemedAt,
            revokedAt: communityInvitationsTable.revokedAt
          })
          .from(communityInvitationsTable)
          .where(eq(communityInvitationsTable.id, invitationId))
          .limit(1)
          .for("update")
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This invitation doesn't exist"
          })
        // An invitation ends once and one way. Revoking a redeemed one would
        // leave no answer to whether the person was admitted.
        if (current.redeemedAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This invitation has already been accepted"
          })
        if (current.revokedAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This invitation has already been revoked"
          })

        await tx
          .update(communityInvitationsTable)
          .set({ revokedAt: sql`now()`, revokedById: userId })
          .where(eq(communityInvitationsTable.id, invitationId))
      })

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
          return {
            ok: true,
            link: invitePath(current.joinToken),
            rotated: false
          }

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
          studyId: communityInvitationsTable.studyId
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

      const accepted = await db.transaction(async (tx) => {
        let studySlug: string | null = null

        // A study invitation uses the same study -> community -> collection
        // lock order as participation. A plain community link has no study,
        // so it starts with the community row itself.
        if (invitation?.studyId !== null && invitation?.studyId !== undefined) {
          const study = await lockStudy(tx, invitation.studyId)
          if (!study || study.communityId !== communityId)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "This invitation's study no longer exists"
            })
          if (!studyAcceptsParticipants(study))
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "This study is not accepting participants"
            })
          studySlug = study.slug
        }

        const [community] = await tx
          .select({
            id: communitiesTable.id,
            slug: communitiesTable.slug,
            title: communitiesTable.title,
            retiredAt: communitiesTable.retiredAt,
            joinToken: communitiesTable.joinToken
          })
          .from(communitiesTable)
          .where(eq(communitiesTable.id, communityId))
          .limit(1)
          // Already held by lockStudy for study invitations; explicit here
          // keeps community and open-link acceptance serialized as well.
          .for("share")
        if (!community)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This invitation link is not valid"
          })
        if (community.retiredAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This community has been retired"
          })

        if (invitation) {
          const [currentInvitation] = await tx
            .select({
              tokenHash: communityInvitationsTable.tokenHash,
              studyId: communityInvitationsTable.studyId,
              expiresAt: communityInvitationsTable.expiresAt,
              revokedAt: communityInvitationsTable.revokedAt,
              redeemedAt: communityInvitationsTable.redeemedAt
            })
            .from(communityInvitationsTable)
            .where(eq(communityInvitationsTable.id, invitation.id))
            .limit(1)
            .for("update")
          if (
            !currentInvitation ||
            currentInvitation.tokenHash !== digest ||
            currentInvitation.studyId !== invitation.studyId
          )
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "This invitation link is not valid"
            })
          if (currentInvitation.revokedAt)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "This invitation has been revoked"
            })
          if (currentInvitation.redeemedAt)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "This invitation has already been used"
            })
          if (new Date(currentInvitation.expiresAt) <= new Date())
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "This invitation has expired"
            })
        } else if (community.joinToken !== token) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "This invitation link is not valid"
          })
        }

        const existing = await lockMembershipIn(tx, communityId, userId)
        if (existing) {
          // Already in. Not an error: the person did what they were asked to
          // do, and a named invitation is still consumed exactly once.
          if (invitation)
            await tx
              .update(communityInvitationsTable)
              .set({ redeemedAt: sql`now()`, redeemedById: userId })
              .where(eq(communityInvitationsTable.id, invitation.id))
          return {
            community,
            studySlug,
            alreadyIn: true,
            nowWorkingIn: null as string | null
          }
        }

        // An invitee joins as a member. A steward is named by an
        // administrator, never granted by a link.
        await tx
          .insert(communityMembersTable)
          .values({ communityId, userId, addedById: userId })
          .onConflictDoNothing()

        // Someone who has never chosen a scope starts working in the community
        // they just joined. A person who already has a scope keeps it.
        const [switched] = await tx
          .update(usersTable)
          .set({ activeCommunityId: communityId })
          .where(
            and(eq(usersTable.id, userId), isNull(usersTable.activeCommunityId))
          )
          .returning({ id: usersTable.id })

        if (invitation)
          await tx
            .update(communityInvitationsTable)
            .set({ redeemedAt: sql`now()`, redeemedById: userId })
            .where(eq(communityInvitationsTable.id, invitation.id))

        return {
          community,
          studySlug,
          alreadyIn: false,
          nowWorkingIn: switched ? community.title : null
        }
      })

      revalidatePath(communitiesIndexPath)
      revalidatePath(communityPath(accepted.community.slug))
      revalidatePath("/", "layout")
      revalidatePath("/terms")
      revalidatePath(collectionsIndexPath)

      return {
        ok: true,
        slug: accepted.community.slug,
        studySlug: accepted.studySlug,
        alreadyIn: accepted.alreadyIn,
        nowWorkingIn: accepted.nowWorkingIn
      }
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
  /*
   * Create a study for a community. The collection is either one that already
   * exists or a new one made here, because the ordinary case is a fresh set of
   * terms for a fresh piece of work and sending someone to another page to
   * make it first is the step that gets forgotten.
   *
   * Whichever it is, the collection joins the worklist in the same
   * transaction. A participant who cannot see the terms cannot take part.
   */
  createStudy: authenticatedProcedure
    .input(
      z.object({
        communityId: z.number().int(),
        title: z.string().trim().min(1).max(TITLE_MAX),
        welcome: z.string().trim().max(DESCRIPTION_MAX).optional(),
        opensAt: z.string().datetime().nullish(),
        closesAt: z.string().datetime().nullish(),
        // Exactly one of these. An existing collection, or a title to make one.
        collectionId: z.number().int().optional(),
        newCollectionTitle: z.string().trim().min(1).max(TITLE_MAX).optional()
      })
    )
    .mutation(async ({ ctx: { userId }, input }) => {
      const community = await requireRunner(input.communityId, userId)
      const runner = await GetUser(userId)

      if (Boolean(input.collectionId) === Boolean(input.newCollectionTitle))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose a collection or name a new one, not both"
        })

      const [studySlugs, collectionSlugs] = await Promise.all([
        db.select({ slug: studiesTable.slug }).from(studiesTable),
        db.select({ slug: collectionsTable.slug }).from(collectionsTable)
      ])

      const created = await db.transaction(async (tx) => {
        let collectionId = input.collectionId

        if (input.newCollectionTitle) {
          const [collection] = await tx
            .insert(collectionsTable)
            .values({
              slug: uniqueSlug(
                input.newCollectionTitle,
                new Set(collectionSlugs.map((row) => row.slug)),
                "collection"
              ),
              title: input.newCollectionTitle,
              // Stamped by the standing of whoever made it, the same rule
              // collections.create follows. Hardcoding "curator" here would
              // lock a steward who is not an administrator out of the
              // collection they had just made for their own study.
              assertableBy:
                runner?.role === "admin" ? "curator" : "contributor",
              createdById: userId
            })
            .returning({ id: collectionsTable.id })
          collectionId = collection.id
        } else {
          const [existing] = await tx
            .select({
              id: collectionsTable.id,
              retiredAt: collectionsTable.retiredAt
            })
            .from(collectionsTable)
            .where(eq(collectionsTable.id, collectionId!))
            .limit(1)
          if (!existing)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "This collection doesn't exist"
            })
          if (existing.retiredAt)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "This collection has been retired"
            })
        }

        const [study] = await tx
          .insert(studiesTable)
          .values({
            slug: uniqueSlug(
              input.title,
              new Set(studySlugs.map((row) => row.slug)),
              "study"
            ),
            communityId: input.communityId,
            collectionId: collectionId!,
            title: input.title,
            welcome: input.welcome || null,
            opensAt: input.opensAt ?? null,
            closesAt: input.closesAt ?? null,
            createdById: userId
          })
          .returning({ id: studiesTable.id, slug: studiesTable.slug })

        // The worklist is what narrows Browse and Collections for a member, so
        // the study collection goes on it here rather than as a second act.
        await tx
          .insert(communityCollectionsTable)
          .values({
            communityId: input.communityId,
            collectionId: collectionId!,
            addedById: userId
          })
          .onConflictDoNothing()

        return study
      })

      revalidatePath(studiesIndexPath)
      revalidatePath(communityPath(community.slug))
      revalidatePath(collectionsIndexPath)
      revalidatePath("/terms")

      return created
    }),

  updateStudy: authenticatedProcedure
    .input(
      z.object({
        studyId: z.number().int(),
        title: z.string().trim().min(1).max(TITLE_MAX).optional(),
        welcome: z.string().trim().max(DESCRIPTION_MAX).nullish(),
        opensAt: z.string().datetime().nullish(),
        closesAt: z.string().datetime().nullish()
      })
    )
    .mutation(async ({ ctx: { userId }, input: { studyId, ...fields } }) => {
      const study = await requireStudy(studyId)
      await requireRunner(study.communityId, userId)

      // The shared operation keeps the stable slug and makes schedule and
      // instructions edits obey the walkthrough activity lock in every API.
      const updated = await updateStudyDetails({
        studyId,
        title: fields.title,
        instructions: fields.welcome,
        opensAt: fields.opensAt,
        closesAt: fields.closesAt
      })

      revalidatePath(studiesIndexPath)
      revalidatePath(studyPath(updated.slug))
      revalidatePath(communityPath(updated.communitySlug))

      return { ok: true }
    }),

  retireStudy: authenticatedProcedure
    .input(z.object({ studyId: z.number().int(), on: z.boolean() }))
    .mutation(async ({ ctx: { userId }, input: { studyId, on } }) => {
      const study = await requireStudy(studyId)
      await requireRunner(study.communityId, userId)

      // Retiring the study leaves the collection on the worklist and every
      // membership alone. The shared operation serializes with activity and
      // refuses to restore beneath a retired parent.
      const updated = await setStudyRetired({
        studyId,
        retired: on
      })

      revalidatePath(studiesIndexPath)
      revalidatePath(studyPath(updated.slug))
      revalidatePath(communityPath(updated.communitySlug))

      return { ok: true }
    }),

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
