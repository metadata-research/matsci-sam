import "server-only"
import { randomUUID } from "node:crypto"
import { TRPCError } from "@trpc/server"
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"
import {
  communitiesTable as communities,
  communityMembersTable as members,
  usersTable as users,
  communityReviewRoundsTable as rounds,
  communityReviewItemsTable as items,
  communityReviewResponsesTable as responses,
  communityReviewEventsTable as events,
  communityReviewInvitationsTable as invitations,
  communityReviewAdmissionsTable as admissions,
  matcoreSpecRevisionsTable as revisions,
  matcoreFieldsTable as fields,
  matcoreSourceOccurrencesTable as occurrences,
  vocabularyMatcoreSourcesTable as grants,
  termsTable as terms,
  definitionsTable as definitions,
  definitionRevisionsTable as definitionRevisions
} from "@yamz/db"
import {
  communityAccess,
  requireVocabularyContent,
  type CommunityReader,
  type CommunityTransaction
} from "./community-access"
import { requireCommunityInvitationManager } from "./community-membership"
import { getCommunityStandard } from "./community-standard"
import {
  getVocabularyWorkspace,
  getMatcoreField,
  startMatcoreSourceChange,
  reviseMatcoreField
} from "./matcore-workflow"
import { contributionFingerprint } from "./contribution-guard"
import { termIsListed } from "./term-visibility"
import { revisionPath } from "./public-identifiers"
import { createOneTimeToken, hashOneTimeToken } from "./auth-tokens"
import {
  createReviewSchema,
  saveReviewSchema,
  reviewPreset,
  communityReviewHref,
  type ReviewKind,
  type ReviewSnapshot
} from "./community-review-types"

const missing = () =>
  new TRPCError({ code: "NOT_FOUND", message: "This review is unavailable." })
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message:
      "Your response changed in another tab. Reload the saved response before replacing it."
  })
async function communityFor(
  reader: CommunityReader,
  communityId: number,
  userId: number | null,
  lock = false
) {
  const [community] = await reader
    .select()
    .from(communities)
    .where(eq(communities.id, communityId))
  if (!community) throw missing()
  await requireVocabularyContent(reader, community.vocabularySlug, userId, {
    lock
  })
  return community
}
async function roundFor(
  reader: CommunityReader,
  id: string,
  userId: number | null,
  lock = false
) {
  const [round] = await reader.select().from(rounds).where(eq(rounds.id, id))
  if (!round) throw missing()
  const community = await communityFor(reader, round.communityId, userId, lock)
  if (lock) {
    const [locked] = await reader
      .select()
      .from(rounds)
      .where(eq(rounds.id, id))
      .for("share")
    return { round: locked, community }
  }
  return { round, community }
}
async function requireParticipant(
  reader: CommunityReader,
  communityId: number,
  userId: number
) {
  const [user] = await reader
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
  const [membership] = await reader
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.communityId, communityId),
        eq(members.userId, userId),
        isNull(members.removedAt)
      )
    )
  if (!user || (user.role !== "admin" && !membership))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Join this community before responding."
    })
}
export async function reviewCandidates(
  reader: CommunityReader,
  input: { communityId: number; area?: string; referenceReleaseId?: string },
  userId: number
) {
  const community = await communityFor(reader, input.communityId, userId)
  const workspace = await getVocabularyWorkspace(
    reader,
    community.vocabularySlug,
    userId
  )
  const candidates: {
    key: string
    kind: ReviewKind
    area: string | null
    sourceOccurrenceId?: string
    proposalRevisionId?: string
    definitionRevisionId?: number
    snapshot: ReviewSnapshot
  }[] = []
  let areas: { id: string; label: string }[] = []
  if (workspace.metadataEnabled || workspace.hasMatcoreCatalog) {
    const standard = await getCommunityStandard(
      reader,
      {
        vocabularySlug: community.vocabularySlug,
        referenceReleaseId: input.referenceReleaseId
      },
      userId
    )
    areas = standard.profiles.map((p) => ({ id: p.id, label: p.label }))
    for (const row of standard.referenceEntries) {
      if (input.area && row.profileKey !== input.area) continue
      candidates.push({
        key: row.id,
        kind: "reference",
        area: row.profileKey,
        sourceOccurrenceId: row.sourceOccurrenceId!,
        snapshot: {
          label: row.payload.label,
          definition: row.payload.definition,
          path: row.payload.specification.path,
          payload: row.payload,
          versionLabel: "Reference " + (standard.reference?.version ?? ""),
          targetHref:
            "/communities/" +
            community.slug +
            "?" +
            new URLSearchParams({
              view: "vocabulary",
              standard: "reference",
              release: standard.reference!.id,
              source: row.id,
              ...(row.profileKey ? { profile: row.profileKey } : {}),
              layout: "hierarchy"
            })
        }
      })
    }
    for (const row of standard.proposals.filter(
      (p) => p.status === "awaiting_review" || p.status === "changes_requested"
    )) {
      if (input.area && row.profileKey !== input.area) continue
      const record = await getMatcoreField(reader, row.fieldId, row.id, userId)
      const revision = record.revisions.find((r) => r.id === row.id)!
      candidates.push({
        key: row.id,
        kind: "proposal",
        area: row.profileKey,
        proposalRevisionId: row.id,
        snapshot: {
          label: row.label,
          definition: revision.payload.definition,
          path: row.path,
          payload: revision.payload,
          before: record.baseline,
          versionLabel: "Proposal revision " + row.version,
          targetHref: "/metadata/fields/" + row.fieldId + "?revision=" + row.id
        }
      })
    }
  } else {
    const rows = await reader
      .select({
        id: definitionRevisions.id,
        definition: definitions.definition,
        version: definitionRevisions.version,
        term: terms.term,
        slug: terms.slug,
        number: definitions.definitionNumber
      })
      .from(terms)
      .innerJoin(definitions, eq(definitions.termId, terms.id))
      .innerJoin(
        definitionRevisions,
        eq(definitionRevisions.id, definitions.currentRevisionId)
      )
      .where(
        and(eq(terms.vocabularySlug, community.vocabularySlug), termIsListed())
      )
      .orderBy(asc(terms.term), asc(definitions.definitionNumber))
      .limit(501)
    for (const row of rows)
      candidates.push({
        key: "definition:" + row.id,
        kind: "definition",
        area: null,
        definitionRevisionId: row.id,
        snapshot: {
          label: row.term,
          definition: row.definition,
          path: row.term,
          versionLabel:
            "Definition " + row.number + " · revision " + row.version,
          targetHref: revisionPath(
            row.slug,
            row.number,
            row.version,
            community.vocabularySlug
          )
        }
      })
  }
  return { community, areas, candidates }
}
export async function createCommunityReview(
  tx: CommunityTransaction,
  raw: z.input<typeof createReviewSchema>,
  actorId: number
) {
  const input = createReviewSchema.parse(raw)
  await requireCommunityInvitationManager(tx, input.communityId, actorId)
  const available = await reviewCandidates(tx, input, actorId)
  const selected = available.candidates.filter(
    (row) =>
      (row.kind === "proposal"
        ? input.includeProposals
        : input.includeFields) &&
      (!input.targetIds || input.targetIds.includes(row.key))
  )
  if (
    input.targetIds &&
    input.targetIds.some((id) => !selected.some((row) => row.key === id))
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The selected fields changed. Reload before creating the review."
    })
  if (!selected.length || selected.length > 500)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose between 1 and 500 review items."
    })
  if (JSON.stringify(selected).length > 10_000_000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose fewer items for this review."
    })
  const [round] = await tx
    .insert(rounds)
    .values({
      id: randomUUID(),
      communityId: input.communityId,
      name: input.name,
      area: input.area || null,
      style: input.style,
      createdById: actorId
    })
    .returning()
  await tx.insert(items).values(
    selected.map((row, position) => ({
      id: randomUUID(),
      roundId: round.id,
      position: position + 1,
      kind: row.kind,
      sourceOccurrenceId: row.sourceOccurrenceId,
      proposalRevisionId: row.proposalRevisionId,
      definitionRevisionId: row.definitionRevisionId,
      snapshot: row.snapshot,
      preset: reviewPreset(row.kind, input.style)
    }))
  )
  return round
}
export async function listCommunityReviews(
  reader: CommunityReader,
  communityId: number,
  userId: number | null
) {
  await communityFor(reader, communityId, userId)
  return reader
    .select()
    .from(rounds)
    .where(eq(rounds.communityId, communityId))
    .orderBy(desc(rounds.createdAt), desc(rounds.id))
}
export async function requestedCommunityReviews(
  reader: CommunityReader,
  communityId: number,
  userId: number,
  area?: string
) {
  const community = await communityFor(reader, communityId, userId)
  const access = await communityAccess(reader, communityId, userId)
  const [membership] = await reader
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.communityId, communityId),
        eq(members.userId, userId),
        isNull(members.removedAt)
      )
    )
  if (!membership && !access.canManage) return []
  const requests = await reader
    .select({
      id: rounds.id,
      name: rounds.name,
      area: rounds.area,
      total: sql<number>`count(${items.id})::int`,
      reviewed: sql<number>`count(${responses.response})::int`,
      nextItemId: sql<
        string | null
      >`(array_agg(${items.id} order by ${items.position}) filter (where ${responses.response} is null))[1]`
    })
    .from(rounds)
    .innerJoin(items, eq(items.roundId, rounds.id))
    .leftJoin(
      responses,
      and(eq(responses.itemId, items.id), eq(responses.userId, userId))
    )
    .where(
      and(
        eq(rounds.communityId, communityId),
        isNull(rounds.closedAt),
        area ? or(eq(rounds.area, area), isNull(rounds.area)) : undefined
      )
    )
    .groupBy(rounds.id)
    .orderBy(desc(rounds.createdAt), desc(rounds.id))
  return requests
    .map(({ nextItemId, ...request }) => ({
      ...request,
      remaining: request.total - request.reviewed,
      href: communityReviewHref(
        community.slug,
        request.id,
        request.area,
        nextItemId ?? undefined
      )
    }))
    .sort((a, b) => Number(a.remaining === 0) - Number(b.remaining === 0))
}

async function requireReviewTarget(
  reader: CommunityReader,
  item: typeof items.$inferSelect,
  vocabularySlug: string,
  userId: number | null
) {
  if (item.sourceOccurrenceId) {
    const [grant] = await reader
      .select({ id: occurrences.id })
      .from(occurrences)
      .innerJoin(
        grants,
        and(
          eq(grants.releaseId, occurrences.releaseId),
          eq(grants.vocabularySlug, vocabularySlug)
        )
      )
      .where(eq(occurrences.id, item.sourceOccurrenceId))
    if (!grant) throw missing()
  } else if (item.proposalRevisionId) {
    const [row] = await reader
      .select({ fieldId: revisions.fieldId })
      .from(revisions)
      .innerJoin(fields, eq(fields.id, revisions.fieldId))
      .where(
        and(
          eq(revisions.id, item.proposalRevisionId),
          eq(fields.vocabularySlug, vocabularySlug)
        )
      )
    if (!row) throw missing()
    await getMatcoreField(reader, row.fieldId, item.proposalRevisionId, userId)
  } else {
    const [row] = await reader
      .select({ id: definitionRevisions.id })
      .from(definitionRevisions)
      .innerJoin(
        definitions,
        eq(definitions.id, definitionRevisions.definitionId)
      )
      .innerJoin(terms, eq(terms.id, definitions.termId))
      .where(
        and(
          eq(definitionRevisions.id, item.definitionRevisionId!),
          eq(terms.vocabularySlug, vocabularySlug),
          termIsListed()
        )
      )
    if (!row) throw missing()
  }
}
export async function getCommunityReview(
  reader: CommunityReader,
  id: string,
  userId: number | null
) {
  const { round, community } = await roundFor(reader, id, userId)
  const rows = await reader
    .select()
    .from(items)
    .where(eq(items.roundId, id))
    .orderBy(asc(items.position))
  for (const row of rows)
    await requireReviewTarget(reader, row, community.vocabularySlug, userId)
  const ids = rows.map((r) => r.id)
  const own =
    userId && ids.length
      ? await reader
          .select()
          .from(responses)
          .where(
            and(inArray(responses.itemId, ids), eq(responses.userId, userId))
          )
      : []
  const tallies = ids.length
    ? await reader
        .select({
          itemId: responses.itemId,
          response: responses.response,
          count: sql.raw("count(*)::int").mapWith(Number)
        })
        .from(responses)
        .where(inArray(responses.itemId, ids))
        .groupBy(responses.itemId, responses.response)
    : []
  const access = await communityAccess(reader, community.id, userId)
  const membership = userId
    ? await reader
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.communityId, community.id),
            eq(members.userId, userId),
            isNull(members.removedAt)
          )
        )
    : []
  return {
    round,
    community: {
      id: community.id,
      slug: community.slug,
      title: community.title
    },
    canManage: access.canManage,
    canRespond: Boolean(
      userId &&
        (membership.length || access.canManage) &&
        !round.closedAt &&
        !community.retiredAt
    ),
    items: rows.map((row) => ({
      ...row,
      own: own.find((r) => r.itemId === row.id) ?? null,
      counts: Object.fromEntries(
        tallies
          .filter((t) => t.itemId === row.id && t.response)
          .map((t) => [t.response!, t.count])
      )
    }))
  }
}
export async function saveCommunityReview(
  tx: CommunityTransaction,
  raw: z.input<typeof saveReviewSchema>,
  userId: number
) {
  const input = saveReviewSchema.parse(raw)
  const [found] = await tx
    .select()
    .from(items)
    .where(eq(items.id, input.itemId))
  if (!found) throw missing()
  const { round, community } = await roundFor(tx, found.roundId, userId, true)
  if (round.closedAt || community.retiredAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This review is closed."
    })
  await requireParticipant(tx, community.id, userId)
  const [item] = await tx
    .select()
    .from(items)
    .where(eq(items.id, found.id))
    .for("update")
  await requireReviewTarget(tx, item, community.vocabularySlug, userId)
  if (
    input.response &&
    !item.preset.options.some((o) => o.value === input.response)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose one of the available responses."
    })
  const hash = contributionFingerprint(input)
  const [event] = await tx
    .select()
    .from(events)
    .where(
      and(eq(events.userId, userId), eq(events.mutationId, input.mutationId))
    )
  if (event) {
    if (event.inputHash !== hash) throw conflict()
    return (
      await tx
        .select()
        .from(responses)
        .where(and(eq(responses.itemId, item.id), eq(responses.userId, userId)))
    )[0]
  }
  const [previous] = await tx
    .select()
    .from(responses)
    .where(and(eq(responses.itemId, item.id), eq(responses.userId, userId)))
  if ((previous?.version ?? 0) !== input.expectedVersion) throw conflict()
  const value = {
    itemId: item.id,
    userId,
    response: input.response,
    comment: input.response ? input.comment : "",
    version: input.expectedVersion + 1,
    updatedAt: new Date().toISOString()
  }
  const [saved] = await tx
    .insert(responses)
    .values(value)
    .onConflictDoUpdate({
      target: [responses.itemId, responses.userId],
      set: value
    })
    .returning()
  await tx.insert(events).values({
    id: randomUUID(),
    ...value,
    mutationId: input.mutationId,
    inputHash: hash
  })
  return saved
}
export async function communityReviewResults(
  reader: CommunityReader,
  id: string,
  actorId: number
) {
  const { round, community } = await roundFor(reader, id, actorId)
  if (!(await communityAccess(reader, community.id, actorId)).canManage)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only community organizers can view identified responses."
    })
  // The same per-target privacy checks apply to organizer results.
  await getCommunityReview(reader, id, actorId)
  return reader
    .select({
      itemId: items.id,
      label: items.snapshot,
      userId: users.id,
      name: users.name,
      response: responses.response,
      comment: responses.comment,
      version: responses.version,
      updatedAt: responses.updatedAt
    })
    .from(responses)
    .innerJoin(items, eq(items.id, responses.itemId))
    .innerJoin(users, eq(users.id, responses.userId))
    .where(eq(items.roundId, round.id))
    .orderBy(asc(items.position), asc(users.id))
}
export async function suggestFromReview(
  tx: CommunityTransaction,
  itemId: string,
  userId: number
) {
  const [item] = await tx.select().from(items).where(eq(items.id, itemId))
  if (!item) throw missing()
  const { round, community } = await roundFor(tx, item.roundId, userId)
  await requireParticipant(tx, community.id, userId)
  await requireReviewTarget(tx, item, community.vocabularySlug, userId)
  const returnTo = communityReviewHref(
    community.slug,
    round.id,
    round.area,
    item.id
  )
  if (item.sourceOccurrenceId) {
    const [source] = await tx
      .select()
      .from(occurrences)
      .where(eq(occurrences.id, item.sourceOccurrenceId))
    const draft = await startMatcoreSourceChange(
      tx,
      {
        vocabularySlug: community.vocabularySlug,
        releaseId: source.releaseId,
        occurrenceId: source.id
      },
      userId
    )
    const draftId =
      draft.kind === "draft"
        ? draft.draftId
        : (await reviseMatcoreField(tx, draft.revisionId, userId)).id
    return {
      href:
        "/metadata/workspace/" +
        draftId +
        "?reviewReturn=" +
        encodeURIComponent(returnTo)
    }
  }
  if (item.proposalRevisionId) {
    const draft = await reviseMatcoreField(tx, item.proposalRevisionId, userId)
    return {
      href:
        "/metadata/workspace/" +
        draft.id +
        "?reviewReturn=" +
        encodeURIComponent(returnTo)
    }
  }
  return { href: item.snapshot.targetHref }
}
export async function createReviewInvitation(
  tx: CommunityTransaction,
  roundId: string,
  days: number,
  actorId: number
) {
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an expiry from 1 to 30 days."
    })
  const { round } = await roundFor(tx, roundId, actorId)
  await requireCommunityInvitationManager(tx, round.communityId, actorId)
  const [current] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for("share")
  if (current.closedAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This review is closed."
    })
  const token = createOneTimeToken()
  const [invitation] = await tx
    .insert(invitations)
    .values({
      id: randomUUID(),
      roundId,
      tokenHash: hashOneTimeToken(token),
      createdById: actorId,
      expiresAt: new Date(Date.now() + days * 86400000).toISOString()
    })
    .returning()
  return {
    id: invitation.id,
    expiresAt: invitation.expiresAt,
    href: "/review-invite/" + token
  }
}
export async function reviewInvitation(reader: CommunityReader, token: string) {
  const [row] = await reader
    .select({
      id: invitations.id,
      roundId: rounds.id,
      communityId: communities.id,
      title: communities.title,
      slug: communities.slug,
      area: rounds.area,
      name: rounds.name,
      createdById: invitations.createdById,
      expiresAt: invitations.expiresAt,
      revokedAt: invitations.revokedAt,
      closedAt: rounds.closedAt,
      retiredAt: communities.retiredAt
    })
    .from(invitations)
    .innerJoin(rounds, eq(rounds.id, invitations.roundId))
    .innerJoin(communities, eq(communities.id, rounds.communityId))
    .where(eq(invitations.tokenHash, hashOneTimeToken(token)))
  if (
    !row ||
    row.revokedAt ||
    row.closedAt ||
    row.retiredAt ||
    Date.parse(row.expiresAt) <= Date.now()
  )
    throw missing()
  return row
}
export async function acceptReviewInvitation(
  tx: CommunityTransaction,
  token: string,
  userId: number
) {
  const entry = await reviewInvitation(tx, token)
  await tx
    .select({ id: communities.id })
    .from(communities)
    .where(eq(communities.id, entry.communityId))
    .for("update")
  await tx
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.id, entry.roundId))
    .for("share")
  await tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(eq(invitations.id, entry.id))
    .for("update")
  const current = await reviewInvitation(tx, token)
  const [existing] = await tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.communityId, current.communityId),
        eq(members.userId, userId),
        isNull(members.removedAt)
      )
    )
    .for("update")
  await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for("update")
  const [admitted] = await tx
    .select()
    .from(admissions)
    .where(
      and(
        eq(admissions.invitationId, current.id),
        eq(admissions.userId, userId)
      )
    )
  if (admitted && !existing)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Your previous membership ended. Request access from a community steward."
    })
  if (!existing)
    await tx
      .insert(members)
      .values({
        communityId: current.communityId,
        userId,
        addedById: current.createdById
      })
      .onConflictDoNothing()
  await tx
    .insert(admissions)
    .values({ invitationId: current.id, userId })
    .onConflictDoNothing()
  await tx
    .update(users)
    .set({ activeCommunityId: current.communityId })
    .where(eq(users.id, userId))
  return {
    href: communityReviewHref(current.slug, current.roundId, current.area)
  }
}
export async function revokeReviewInvitation(
  tx: CommunityTransaction,
  id: string,
  actorId: number
) {
  const [invitation] = await tx
    .select()
    .from(invitations)
    .where(eq(invitations.id, id))
  if (!invitation) throw missing()
  const { round } = await roundFor(tx, invitation.roundId, actorId)
  await requireCommunityInvitationManager(tx, round.communityId, actorId)
  await tx
    .update(invitations)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(invitations.id, id))
  return { ok: true }
}
export async function listReviewInvitations(
  reader: CommunityReader,
  roundId: string,
  actorId: number
) {
  const { community } = await roundFor(reader, roundId, actorId)
  if (!(await communityAccess(reader, community.id, actorId)).canManage)
    throw missing()
  return reader
    .select({
      id: invitations.id,
      expiresAt: invitations.expiresAt,
      revokedAt: invitations.revokedAt
    })
    .from(invitations)
    .where(eq(invitations.roundId, roundId))
}

export async function closeCommunityReview(
  tx: CommunityTransaction,
  id: string,
  actorId: number
) {
  const { round } = await roundFor(tx, id, actorId)
  await requireCommunityInvitationManager(tx, round.communityId, actorId)
  await tx
    .update(rounds)
    .set({ closedAt: new Date().toISOString() })
    .where(and(eq(rounds.id, id), isNull(rounds.closedAt)))
  return { ok: true }
}
