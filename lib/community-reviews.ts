import "server-only"
import { randomUUID } from "node:crypto"
import { TRPCError } from "@trpc/server"
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notExists,
  or,
  sql
} from "drizzle-orm"
import { z } from "zod"
import {
  communitiesTable as communities,
  communityMembersTable as members,
  usersTable as users,
  communityReviewRoundsTable as rounds,
  communityReviewItemsTable as items,
  communityReviewResponsesTable as responses,
  communityReviewEventsTable as events,
  communityReviewExercisesTable as exercises,
  communityReviewExerciseEventsTable as exerciseEvents,
  communityReviewInvitationsTable as invitations,
  communityReviewAdmissionsTable as admissions,
  matcoreSpecRevisionsTable as revisions,
  matcoreFieldsTable as fields,
  matcoreSourceOccurrencesTable as occurrences,
  matcoreSourceReleasesTable as sourceReleases,
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
import { participationContentVisible } from "./content-access"
import { diffToStringSimple } from "./definition-comparison"
import { sourceFieldName } from "./metadata-field-name"
import { definitionPath, revisionPath } from "./public-identifiers"
import { createOneTimeToken, hashOneTimeToken } from "./auth-tokens"
import {
  createReviewSchema,
  saveReviewSchema,
  reviewPreset,
  communityReviewHref,
  reviewTargetKey,
  matchesReviewTarget,
  MAX_REVIEW_ITEMS,
  MAX_REVIEW_SNAPSHOT_BYTES,
  type ReviewKind,
  type ReviewSnapshot
} from "./community-review-types"
import {
  saveReviewExerciseSchema,
  type ReviewExerciseConfig
} from "./community-review-exercise-types"
import { validateReviewExerciseXml } from "./community-review-exercise-xml"

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
  input: {
    communityId: number
    area?: string
    referenceReleaseId?: string
    includeCommunityWide?: boolean
    targetIds?: string[]
  },
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
  let truncated = false
  let budgetFull = false
  let snapshotBytes = 0
  const seen = new Set<string>()
  function append(candidate: (typeof candidates)[number]) {
    if (seen.has(candidate.key)) return
    const bytes = Buffer.byteLength(JSON.stringify(candidate))
    if (
      candidates.length >= MAX_REVIEW_ITEMS ||
      snapshotBytes + bytes > MAX_REVIEW_SNAPSHOT_BYTES
    ) {
      truncated = true
      budgetFull = true
      return
    }
    snapshotBytes += bytes
    seen.add(candidate.key)
    candidates.push(candidate)
  }
  // A contribution/history link may select an accepted proposal or an older
  // definition. Resolve those exact versions first; defaults still use current
  // definitions and pending proposals. Never replace a selected historical ID.
  for (const key of [...new Set(input.targetIds ?? [])]) {
    if (budgetFull || candidates.length >= MAX_REVIEW_ITEMS) {
      truncated = true
      break
    }
    if (key.startsWith("proposal:")) {
      const id = key.slice("proposal:".length)
      if (!z.string().uuid().safeParse(id).success) continue
      const [stored] = await reader
        .select({ fieldId: fields.id })
        .from(revisions)
        .innerJoin(fields, eq(fields.id, revisions.fieldId))
        .where(
          and(
            eq(revisions.id, id),
            eq(fields.vocabularySlug, community.vocabularySlug)
          )
        )
      if (!stored) continue
      const record = await getMatcoreField(reader, stored.fieldId, id, userId)
      const revision = record.revisions.find((row) => row.id === id)
      if (!revision || (input.area && revision.profileKey !== input.area))
        continue
      append({
        key,
        kind: "proposal",
        area: revision.profileKey,
        proposalRevisionId: id,
        snapshot: {
          label: revision.payload.label,
          definition: revision.payload.definition,
          path: revision.payload.specification.path,
          payload: revision.payload,
          before: record.baseline,
          versionLabel: "Proposal revision " + revision.version,
          targetHref: "/metadata/fields/" + stored.fieldId + "?revision=" + id
        }
      })
    } else if (
      key.startsWith("definition:") &&
      (!input.area || input.includeCommunityWide)
    ) {
      const id = Number(key.slice("definition:".length))
      if (!Number.isInteger(id) || id <= 0 || id > 2147483647) continue
      const [row] = await reader
        .select({
          revision: definitionRevisions,
          label: terms.term,
          slug: terms.slug,
          number: definitions.definitionNumber
        })
        .from(definitionRevisions)
        .innerJoin(
          definitions,
          eq(definitions.id, definitionRevisions.definitionId)
        )
        .innerJoin(terms, eq(terms.id, definitions.termId))
        .where(
          and(
            eq(definitionRevisions.id, id),
            eq(terms.vocabularySlug, community.vocabularySlug),
            termIsListed(),
            participationContentVisible(
              definitionRevisions.surveyStepId,
              userId
            ),
            notExists(
              reader
                .select({ id: revisions.id })
                .from(revisions)
                .where(
                  eq(revisions.definitionRevisionId, definitionRevisions.id)
                )
            )
          )
        )
      if (!row) continue
      append({
        key: reviewTargetKey("definition", id),
        kind: "definition",
        area: null,
        definitionRevisionId: id,
        snapshot: {
          label: row.label,
          definition: diffToStringSimple(row.revision.definitionDiff),
          path: row.label,
          versionLabel:
            "Definition " + row.number + " · revision " + row.revision.version,
          targetHref: revisionPath(
            row.slug,
            row.number,
            row.revision.version,
            community.vocabularySlug
          )
        }
      })
    } else if (key.startsWith("reference:")) {
      const id = key.slice("reference:".length)
      const [row] = await reader
        .select({ occurrence: occurrences, version: sourceReleases.version })
        .from(occurrences)
        .innerJoin(sourceReleases, eq(sourceReleases.id, occurrences.releaseId))
        .innerJoin(
          grants,
          and(
            eq(grants.releaseId, occurrences.releaseId),
            eq(grants.vocabularySlug, community.vocabularySlug)
          )
        )
        .where(eq(occurrences.id, id))
      if (!row || (input.area && row.occurrence.profileKey !== input.area))
        continue
      const payload = {
        ...row.occurrence.baseline,
        label: sourceFieldName(row.occurrence.source)
      }
      append({
        key,
        kind: "reference",
        area: row.occurrence.profileKey,
        sourceOccurrenceId: id,
        snapshot: {
          label: payload.label,
          definition: payload.definition,
          path: payload.specification.path,
          payload,
          versionLabel: "Reference " + row.version,
          targetHref:
            "/communities/" +
            community.slug +
            "?" +
            new URLSearchParams({
              view: "vocabulary",
              standard: "reference",
              release: row.occurrence.releaseId,
              source: id,
              profile: row.occurrence.profileKey,
              layout: "hierarchy"
            })
        }
      })
    }
  }
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
      append({
        key: reviewTargetKey("reference", row.sourceOccurrenceId!),
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
      if (budgetFull || candidates.length >= MAX_REVIEW_ITEMS) {
        truncated = true
        break
      }
      const record = await getMatcoreField(reader, row.fieldId, row.id, userId)
      const revision = record.revisions.find((r) => r.id === row.id)!
      append({
        key: reviewTargetKey("proposal", row.id),
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
  }
  // Ordinary definitions are community-wide; including them in an area review
  // requires an explicit selection by its organizer.
  if (!input.area || input.includeCommunityWide) {
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
        and(
          eq(terms.vocabularySlug, community.vocabularySlug),
          termIsListed(),
          participationContentVisible(definitionRevisions.surveyStepId, userId),
          // Legacy dictionary projections are reviewed through their field
          // proposal, where source grants and the full specification apply.
          notExists(
            reader
              .select({ id: revisions.id })
              .from(revisions)
              .where(eq(revisions.definitionRevisionId, definitionRevisions.id))
          )
        )
      )
      .orderBy(asc(terms.term), asc(definitions.definitionNumber))
      .limit(MAX_REVIEW_ITEMS + 1)
    for (const row of rows)
      append({
        key: reviewTargetKey("definition", row.id),
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
  return { community, areas, candidates, truncated }
}
export async function createCommunityReview(
  tx: CommunityTransaction,
  raw: z.input<typeof createReviewSchema>,
  actorId: number
) {
  const input = createReviewSchema.parse(raw)
  await requireCommunityInvitationManager(tx, input.communityId, actorId)
  let datasetExercise: ReviewExerciseConfig | null = null
  if (input.datasetExercise) {
    if (!input.referenceReleaseId || !input.area)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Choose a reference version and section for the dataset example."
      })
    datasetExercise = {
      ...input.datasetExercise,
      version: 1,
      referenceReleaseId: input.referenceReleaseId,
      profile: input.area
    }
    const community = await communityFor(tx, input.communityId, actorId)
    await exerciseReference(tx, community.vocabularySlug, datasetExercise)
  }
  if (input.requestId) {
    if (!input.targetIds?.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose the items for this review."
      })
    // The round ID is also the creation receipt. A lost response must not create
    // a second round or replace the original version snapshots on retry.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.requestId}, 0))`
    )
    const [existing] = await tx
      .select()
      .from(rounds)
      .where(eq(rounds.id, input.requestId))
    if (existing) {
      const savedItems = await tx
        .select()
        .from(items)
        .where(eq(items.roundId, existing.id))
      const keys = savedItems.map((item) =>
        reviewTargetKey(
          item.kind,
          item.sourceOccurrenceId ??
            item.proposalRevisionId ??
            item.definitionRevisionId!
        )
      )
      const sameTargets =
        input.targetIds.every((selected) =>
          keys.some((key) => matchesReviewTarget(key, selected))
        ) &&
        keys.every((key) =>
          input.targetIds!.some((selected) =>
            matchesReviewTarget(key, selected)
          )
        )
      if (
        existing.communityId !== input.communityId ||
        existing.createdById !== actorId ||
        existing.name !== input.name ||
        existing.area !== (input.area || null) ||
        existing.style !== input.style ||
        contributionFingerprint(existing.datasetExercise) !==
          contributionFingerprint(datasetExercise) ||
        savedItems.some((item) =>
          item.kind === "proposal"
            ? !input.includeProposals
            : !input.includeFields
        ) ||
        !sameTargets
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This review request was already used. Reload before creating another review."
        })
      const community = await communityFor(tx, input.communityId, actorId)
      for (const item of savedItems)
        await requireReviewTarget(tx, item, community.vocabularySlug, actorId)
      return existing
    }
  }
  const available = await reviewCandidates(tx, input, actorId)
  if (available.truncated && !input.targetIds)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose specific items or a smaller area for this review."
    })
  const selected = available.candidates.filter(
    (row) =>
      (row.kind === "proposal"
        ? input.includeProposals
        : input.includeFields) &&
      (!input.targetIds ||
        input.targetIds.some((id) => matchesReviewTarget(row.key, id)))
  )
  if (
    input.targetIds &&
    input.targetIds.some(
      (id) => !selected.some((row) => matchesReviewTarget(row.key, id))
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The selected items changed. Reload before creating the review."
    })
  if (!selected.length || selected.length > MAX_REVIEW_ITEMS)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose between 1 and 500 review items."
    })
  if (Buffer.byteLength(JSON.stringify(selected)) > MAX_REVIEW_SNAPSHOT_BYTES)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose fewer items for this review."
    })
  const [round] = await tx
    .insert(rounds)
    .values({
      id: input.requestId ?? randomUUID(),
      communityId: input.communityId,
      name: input.name,
      area: input.area || null,
      datasetExercise,
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
      reviewed: sql<number>`count(*) filter (where ${responses.response} is not null or btrim(${responses.comment}) <> '')::int`,
      nextItemId: sql<
        string | null
      >`(array_agg(${items.id} order by ${items.position}) filter (where ${responses.response} is null and coalesce(btrim(${responses.comment}), '') = ''))[1]`
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
          termIsListed(),
          participationContentVisible(definitionRevisions.surveyStepId, userId)
        )
      )
    if (!row) throw missing()
    const projections = await reader
      .select({ id: revisions.id, fieldId: revisions.fieldId })
      .from(revisions)
      .where(eq(revisions.definitionRevisionId, item.definitionRevisionId!))
    for (const projection of projections) {
      await getMatcoreField(reader, projection.fieldId, projection.id, userId)
    }
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
        .where(
          and(
            inArray(responses.itemId, ids),
            sql`${responses.response} is not null or btrim(${responses.comment}) <> ''`
          )
        )
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
    canViewExercise: Boolean(userId && (membership.length || access.canManage)),
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
          .filter((t) => t.itemId === row.id)
          .map((t) => [t.response ?? "commentOnly", t.count])
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
  // Serialize exercise edits with feedback so each response captures one exact
  // saved dataset revision, even when a second tab is editing the exercise.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`review-exercise:${round.id}:${userId}`}, 0))`
  )
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
  const [exercise] = await tx
    .select()
    .from(exercises)
    .where(and(eq(exercises.roundId, round.id), eq(exercises.userId, userId)))
  if (round.datasetExercise && (input.response || input.comment)) {
    if (input.datasetExerciseRevisionId === undefined)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Reload the dataset example before saving feedback."
      })
    if (input.datasetExerciseRevisionId !== (exercise?.revisionId ?? null))
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The dataset example changed in another tab. Reload the saved dataset example before saving this feedback."
      })
  } else if (!round.datasetExercise && input.datasetExerciseRevisionId != null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This review does not use a dataset example."
    })
  }
  const value = {
    itemId: item.id,
    userId,
    response: input.response,
    comment: input.comment,
    datasetExerciseRevisionId:
      input.response || input.comment
        ? (input.datasetExerciseRevisionId ?? null)
        : null,
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
      datasetExerciseRevisionId: responses.datasetExerciseRevisionId,
      version: responses.version,
      updatedAt: responses.updatedAt
    })
    .from(responses)
    .innerJoin(items, eq(items.id, responses.itemId))
    .innerJoin(users, eq(users.id, responses.userId))
    .where(eq(items.roundId, round.id))
    .orderBy(asc(items.position), asc(users.id))
}

async function exerciseReference(
  reader: CommunityReader,
  vocabularySlug: string,
  config: ReviewExerciseConfig
) {
  const [release] = await reader
    .select({
      version: sourceReleases.version,
      profiles: sourceReleases.profiles
    })
    .from(sourceReleases)
    .innerJoin(
      grants,
      and(
        eq(grants.releaseId, sourceReleases.id),
        eq(grants.vocabularySlug, vocabularySlug)
      )
    )
    .where(eq(sourceReleases.id, config.referenceReleaseId))
  const profile = release?.profiles.find(
    (value): value is { id: string; label: string } =>
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      value.id === config.profile &&
      "label" in value &&
      typeof value.label === "string"
  )
  if (!release || !profile) throw missing()
  return { referenceLabel: release.version, profileLabel: profile.label }
}

export async function communityReviewExerciseSetup(
  reader: CommunityReader,
  communityId: number,
  actorId: number
) {
  const community = await communityFor(reader, communityId, actorId)
  if (!(await communityAccess(reader, communityId, actorId)).canManage)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only community organizers can configure dataset examples."
    })
  const releases = await reader
    .select({
      id: sourceReleases.id,
      label: sourceReleases.version,
      profiles: sourceReleases.profiles
    })
    .from(sourceReleases)
    .innerJoin(grants, eq(grants.releaseId, sourceReleases.id))
    .where(eq(grants.vocabularySlug, community.vocabularySlug))
    .orderBy(desc(sourceReleases.createdAt), asc(sourceReleases.id))
  return {
    vocabularySlug: community.vocabularySlug,
    releases: releases.map((release) => ({
      ...release,
      profiles: release.profiles.flatMap((value) =>
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof value.id === "string" &&
        "label" in value &&
        typeof value.label === "string"
          ? [{ key: value.id, label: value.label }]
          : []
      )
    }))
  }
}

const exerciseSelection = {
  revisionId: exerciseEvents.id,
  roundId: exerciseEvents.roundId,
  userId: exerciseEvents.userId,
  payload: exerciseEvents.payload,
  version: exerciseEvents.version,
  xmlStatus: exerciseEvents.xmlStatus,
  updatedAt: exerciseEvents.createdAt
}

async function currentExercise(
  reader: CommunityReader,
  roundId: string,
  userId: number
) {
  return (
    (
      await reader
        .select(exerciseSelection)
        .from(exercises)
        .innerJoin(exerciseEvents, eq(exerciseEvents.id, exercises.revisionId))
        .where(
          and(eq(exercises.roundId, roundId), eq(exercises.userId, userId))
        )
    )[0] ?? null
  )
}

export async function getCommunityReviewExercise(
  reader: CommunityReader,
  roundId: string,
  userId: number
) {
  const { round, community } = await roundFor(reader, roundId, userId)
  await requireParticipant(reader, community.id, userId)
  const labels = round.datasetExercise
    ? await exerciseReference(
        reader,
        community.vocabularySlug,
        round.datasetExercise
      )
    : null
  const [profile] = await reader
    .select({
      reviewerName: users.name,
      reviewerAffiliation: users.affiliation
    })
    .from(users)
    .where(eq(users.id, userId))
  return {
    config: round.datasetExercise,
    vocabularySlug: community.vocabularySlug,
    referenceLabel: labels?.referenceLabel ?? null,
    profileLabel: labels?.profileLabel ?? null,
    defaults: {
      reviewerName: profile?.reviewerName ?? "",
      reviewerAffiliation: profile?.reviewerAffiliation ?? ""
    },
    own: await currentExercise(reader, roundId, userId),
    canSave: Boolean(
      round.datasetExercise && !round.closedAt && !community.retiredAt
    )
  }
}

export async function saveCommunityReviewExercise(
  tx: CommunityTransaction,
  raw: z.input<typeof saveReviewExerciseSchema>,
  userId: number
) {
  const input = saveReviewExerciseSchema.parse(raw)
  const { round, community } = await roundFor(tx, input.roundId, userId, true)
  await requireParticipant(tx, community.id, userId)
  if (!round.datasetExercise) throw missing()
  if (round.closedAt || community.retiredAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This review is closed."
    })
  await exerciseReference(tx, community.vocabularySlug, round.datasetExercise)
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`review-exercise:${round.id}:${userId}`}, 0))`
  )
  const hash = contributionFingerprint(input)
  const [priorEvent] = await tx
    .select()
    .from(exerciseEvents)
    .where(
      and(
        eq(exerciseEvents.userId, userId),
        eq(exerciseEvents.mutationId, input.mutationId)
      )
    )
  const previous = await currentExercise(tx, round.id, userId)
  if (priorEvent) {
    if (priorEvent.inputHash !== hash) throw conflict()
    return previous!
  }
  if ((previous?.version ?? 0) !== input.expectedVersion) throw conflict()
  let xmlStatus: typeof exerciseEvents.$inferInsert.xmlStatus
  try {
    xmlStatus = validateReviewExerciseXml(input.payload.completedXml)
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error ? error.message : "Check the XML before saving."
    })
  }
  const [saved] = await tx
    .insert(exerciseEvents)
    .values({
      id: randomUUID(),
      roundId: round.id,
      userId,
      payload: input.payload,
      mutationId: input.mutationId,
      inputHash: hash,
      version: input.expectedVersion + 1,
      xmlStatus
    })
    .returning()
  const current = {
    roundId: round.id,
    userId,
    revisionId: saved.id,
    version: saved.version,
    updatedAt: saved.createdAt
  }
  await tx
    .insert(exercises)
    .values(current)
    .onConflictDoUpdate({
      target: [exercises.roundId, exercises.userId],
      set: current
    })
  return {
    revisionId: saved.id,
    roundId: saved.roundId,
    userId: saved.userId,
    payload: saved.payload,
    version: saved.version,
    xmlStatus: saved.xmlStatus,
    updatedAt: saved.createdAt
  }
}

export async function communityReviewExerciseResults(
  reader: CommunityReader,
  roundId: string,
  actorId: number
) {
  const { round, community } = await roundFor(reader, roundId, actorId)
  if (!(await communityAccess(reader, community.id, actorId)).canManage)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only community organizers can view dataset examples."
    })
  await getCommunityReview(reader, roundId, actorId)
  if (!round.datasetExercise) return []
  await exerciseReference(
    reader,
    community.vocabularySlug,
    round.datasetExercise
  )
  const current = await reader
    .select({ revisionId: exercises.revisionId })
    .from(exercises)
    .where(eq(exercises.roundId, roundId))
    .orderBy(asc(exercises.userId))
    .limit(501)
  if (current.length > 500) throw exerciseBudgetExceeded()
  return loadExerciseRevisions(
    reader,
    current.map((row) => row.revisionId)
  )
}

const exerciseBudgetExceeded = () =>
  new TRPCError({
    code: "BAD_REQUEST",
    message:
      "There are too many dataset examples to load together. Export fewer selected review items."
  })

async function loadExerciseRevisions(reader: CommunityReader, ids: string[]) {
  if (!ids.length) return []
  const unique = [...new Set(ids)]
  const [size] = await reader
    .select({
      bytes:
        sql<number>`coalesce(sum(octet_length(${exerciseEvents.payload}::text)), 0)::bigint`.mapWith(
          Number
        )
    })
    .from(exerciseEvents)
    .where(inArray(exerciseEvents.id, unique))
  if (size.bytes > 5 * 1024 * 1024) throw exerciseBudgetExceeded()
  return reader
    .select(exerciseSelection)
    .from(exerciseEvents)
    .where(inArray(exerciseEvents.id, unique))
    .orderBy(
      asc(exerciseEvents.roundId),
      asc(exerciseEvents.userId),
      asc(exerciseEvents.version)
    )
}

/** Only the immutable examples actually linked to selected current feedback. */
export async function communityReviewExerciseRevisions(
  reader: CommunityReader,
  itemIds: string[],
  actorId: number
) {
  if (!itemIds.length) return []
  if (itemIds.length > MAX_REVIEW_ITEMS)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose fewer review items."
    })
  const selected = await reader
    .select()
    .from(items)
    .where(inArray(items.id, itemIds))
  if (new Set(itemIds).size !== selected.length) throw missing()
  const checkedRounds = new Map<string, typeof rounds.$inferSelect>()
  for (const item of selected) {
    const { round, community } = await roundFor(reader, item.roundId, actorId)
    if (!(await communityAccess(reader, community.id, actorId)).canManage)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only community organizers can export dataset examples."
      })
    await requireReviewTarget(reader, item, community.vocabularySlug, actorId)
    if (round.datasetExercise)
      await exerciseReference(
        reader,
        community.vocabularySlug,
        round.datasetExercise
      )
    checkedRounds.set(round.id, round)
  }
  const linked = await reader
    .select({ revisionId: exerciseEvents.id, itemId: responses.itemId })
    .from(responses)
    .innerJoin(
      exerciseEvents,
      eq(exerciseEvents.id, responses.datasetExerciseRevisionId)
    )
    .where(inArray(responses.itemId, itemIds))
    .orderBy(asc(responses.itemId))
    .limit(5001)
  if (linked.length > 5000) throw exerciseBudgetExceeded()
  const revisions = await loadExerciseRevisions(
    reader,
    linked.map((row) => row.revisionId)
  )
  return revisions.map((row) => ({
    ...row,
    itemIds: linked
      .filter((link) => link.revisionId === row.revisionId)
      .map((link) => link.itemId),
    roundName: checkedRounds.get(row.roundId)!.name,
    config: checkedRounds.get(row.roundId)!.datasetExercise!
  }))
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
  const [definition] = await tx
    .select({
      slug: terms.slug,
      number: definitions.definitionNumber,
      version: definitionRevisions.version
    })
    .from(definitionRevisions)
    .innerJoin(
      definitions,
      eq(definitions.id, definitionRevisions.definitionId)
    )
    .innerJoin(terms, eq(terms.id, definitions.termId))
    .where(eq(definitionRevisions.id, item.definitionRevisionId!))
  if (!definition) throw missing()
  return {
    href:
      definitionPath(
        definition.slug,
        definition.number,
        community.vocabularySlug
      ) +
      "?" +
      new URLSearchParams({
        reviewReturn: returnTo,
        reviewRevision: String(definition.version)
      }) +
      "#definition-actions-heading"
  }
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
