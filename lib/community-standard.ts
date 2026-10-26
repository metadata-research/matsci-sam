import "server-only"
import { TRPCError } from "@trpc/server"
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import {
  db,
  matcoreFieldsTable as fields,
  matcoreSpecRevisionsTable as revisions,
  matcoreWorkflowEventsTable as events,
  matcoreSourceOccurrencesTable as occurrences,
  communityStandardReleasesTable as releases,
  termsTable,
  usersTable
} from "@yamz/db"
import {
  getVocabularyWorkspace,
  listMatcoreSourceCatalog,
  getMatcoreField,
  type MatcoreTransaction
} from "./matcore-workflow"
import { requireVocabularyContent } from "./community-access"
import { requireSetupVocabularyForContribution } from "./setup-service"
import { contributionFingerprint } from "./contribution-guard"
import { termIsListed } from "./term-visibility"
import { sourceFieldName, proposalFieldName } from "./metadata-field-name"
import { MATCORE_WORKFLOW_POLICY } from "./matcore-workflow-types"
import type {
  StandardEntry,
  StandardSnapshot
} from "./community-standard-types"

type Reader = typeof db | MatcoreTransaction
const unavailable = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "This community standard is unavailable."
  })

/** Reference, community decisions and named releases are separate, revision-pinned records. */
export async function getCommunityStandard(
  reader: Reader,
  input: {
    vocabularySlug: string
    referenceReleaseId?: string
    releaseId?: string
  },
  viewerId: number | null
) {
  await requireVocabularyContent(reader, input.vocabularySlug, viewerId)
  const workspace = await getVocabularyWorkspace(
    reader,
    input.vocabularySlug,
    viewerId
  )
  const communityReleases = await reader
    .select({
      id: releases.id,
      vocabularySlug: releases.vocabularySlug,
      name: releases.name,
      referenceReleaseId: releases.referenceReleaseId,
      parentId: releases.parentId,
      fingerprint: releases.fingerprint,
      note: releases.note,
      createdById: releases.createdById,
      createdAt: releases.createdAt,
      fieldCount: sql<number>`jsonb_array_length(${releases.snapshot}->'entries')`
    })
    .from(releases)
    .where(eq(releases.vocabularySlug, input.vocabularySlug))
    .orderBy(desc(releases.createdAt), desc(releases.id))
  const selectedRelease = input.releaseId
    ? (
        await reader
          .select()
          .from(releases)
          .where(
            and(
              eq(releases.id, input.releaseId),
              eq(releases.vocabularySlug, input.vocabularySlug)
            )
          )
      )[0]
    : null
  if (input.releaseId && !selectedRelease) throw unavailable()
  if (
    selectedRelease &&
    input.referenceReleaseId &&
    selectedRelease.referenceReleaseId !== input.referenceReleaseId
  )
    throw unavailable()
  const catalog = await listMatcoreSourceCatalog(
    reader,
    {
      vocabularySlug: input.vocabularySlug,
      releaseId:
        selectedRelease?.referenceReleaseId ?? input.referenceReleaseId,
      layout: "hierarchy"
    },
    viewerId
  )
  const referenceReleaseId = selectedRelease
    ? selectedRelease.referenceReleaseId
    : (catalog.selectedRelease?.id ?? null)
  const sourceRows = referenceReleaseId
    ? await reader
        .select()
        .from(occurrences)
        .where(eq(occurrences.releaseId, referenceReleaseId))
        .orderBy(asc(occurrences.id))
    : []
  const sources = new Map(sourceRows.map((row) => [row.id, row]))
  const profileOrder = new Map(
    catalog.profiles.map((profile, index) => [profile.id as string, index])
  )
  const compareEntries = (a: StandardEntry, b: StandardEntry) =>
    (profileOrder.get(a.profileKey ?? "") ?? 999) -
      (profileOrder.get(b.profileKey ?? "") ?? 999) ||
    a.payload.specification.path.localeCompare(b.payload.specification.path) ||
    a.id.localeCompare(b.id)
  const referenceEntries: StandardEntry[] = sourceRows
    .map((row) => ({
      id: row.id,
      fieldId: null,
      sourceOccurrenceId: row.id,
      revisionId: null,
      reviewEventId: null,
      profileKey: row.profileKey,
      payload: { ...row.baseline, label: sourceFieldName(row.source) }
    }))
    .sort(compareEntries)
  const rows = await reader
    .select({
      revision: revisions,
      termId: fields.termId,
      author: usersTable.name
    })
    .from(revisions)
    .innerJoin(fields, eq(revisions.fieldId, fields.id))
    .innerJoin(usersTable, eq(revisions.createdById, usersTable.id))
    .leftJoin(termsTable, eq(fields.termId, termsTable.id))
    .where(
      and(
        eq(fields.vocabularySlug, input.vocabularySlug),
        or(
          isNull(fields.termId),
          and(
            eq(termsTable.vocabularySlug, fields.vocabularySlug),
            termIsListed()
          )
        ),
        or(
          isNull(revisions.profileReleaseId),
          referenceReleaseId
            ? eq(revisions.profileReleaseId, referenceReleaseId)
            : sql`false`
        )
      )
    )
    .orderBy(
      desc(revisions.version),
      desc(revisions.createdAt),
      desc(revisions.id)
    )
    .limit(10001)
  if (rows.length > 10000)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This workspace requires a larger revision query limit before a release can be created."
    })
  const revisionIds = rows.map((row) => row.revision.id)
  const decisions = revisionIds.length
    ? await reader
        .selectDistinctOn([events.revisionId], {
          revisionId: events.revisionId,
          detail: events.detail,
          id: events.id
        })
        .from(events)
        .where(
          and(
            inArray(events.revisionId, revisionIds),
            inArray(events.action, ["reviewed", "withdrawn"])
          )
        )
        .orderBy(asc(events.revisionId), desc(events.id))
    : []
  const decisionMap = new Map(decisions.map((row) => [row.revisionId, row]))
  const latest = new Map<string, (typeof rows)[number]>()
  const accepted = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const identity = `${row.revision.fieldId}:${row.revision.occurrenceKey}`
    if (!latest.has(identity)) latest.set(identity, row)
    if (
      !accepted.has(identity) &&
      decisionMap.get(row.revision.id)?.detail.decision === "accepted"
    )
      accepted.set(identity, row)
  }
  const working = new Map(referenceEntries.map((row) => [row.id, row]))
  for (const { revision } of accepted.values()) {
    const source = revision.sourceOccurrenceId
      ? sources.get(revision.sourceOccurrenceId)
      : null
    const id = revision.sourceOccurrenceId ?? revision.fieldId
    working.set(id, {
      id,
      fieldId: revision.fieldId,
      sourceOccurrenceId: revision.sourceOccurrenceId,
      revisionId: revision.id,
      reviewEventId: decisionMap.get(revision.id)?.id ?? null,
      profileKey: revision.profileKey,
      payload: {
        ...revision.payload,
        label: proposalFieldName(
          revision.payload.label,
          source?.source ?? null,
          source?.baseline ?? null
        )
      }
    })
  }
  const entries = [...working.values()].sort(compareEntries)
  const snapshot: StandardSnapshot = {
    formatVersion: 1,
    referenceReleaseId,
    entries
  }
  const proposals = [...latest.values()].map(({ revision, author }) => {
    const source = revision.sourceOccurrenceId
      ? sources.get(revision.sourceOccurrenceId)
      : null
    return {
      id: revision.id,
      fieldId: revision.fieldId,
      sourceOccurrenceId: revision.sourceOccurrenceId,
      label: proposalFieldName(
        revision.payload.label,
        source?.source ?? null,
        source?.baseline ?? null
      ),
      path: revision.payload.specification.path,
      profileKey: revision.profileKey,
      rationale: revision.payload.rationale,
      version: revision.version,
      author,
      createdAt: revision.createdAt,
      status: decisionMap.get(revision.id)?.detail.decision ?? "awaiting_review"
    }
  })
  return {
    workspace,
    reference: referenceReleaseId ? catalog.selectedRelease : null,
    referenceVersions: catalog.releases,
    profiles: referenceReleaseId ? catalog.profiles : [],
    referenceEntries,
    working: snapshot,
    fingerprint: contributionFingerprint(snapshot),
    proposals,
    selectedRelease: selectedRelease ?? null,
    releases: communityReleases
  }
}

export function assertStandardPaths(entries: StandardEntry[]) {
  const seen = new Set<string>()
  for (const entry of entries) {
    const path = entry.payload.specification.path.trim()
    if (!path || path.split(".").some((part) => !part.trim()))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Each field needs a complete schema path."
      })
    const key = JSON.stringify([entry.profileKey, path])
    if (seen.has(key))
      throw new TRPCError({
        code: "CONFLICT",
        message: `Another field already uses the path ${path} in this profile. Resolve the conflicting paths before changing the working version.`
      })
    seen.add(key)
  }
}

export async function createCommunityStandardRelease(
  tx: MatcoreTransaction,
  input: {
    id: string
    vocabularySlug: string
    referenceReleaseId?: string
    name: string
    note: string
    expectedFingerprint: string
  },
  actorId: number
) {
  const workspace = await getVocabularyWorkspace(
    tx,
    input.vocabularySlug,
    actorId,
    true
  )
  if (!workspace.canManage)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "A community steward or site administrator must create a release."
    })
  const [existing] = await tx
    .select()
    .from(releases)
    .where(eq(releases.id, input.id))
  if (existing) {
    if (
      existing.vocabularySlug !== input.vocabularySlug ||
      existing.createdById !== actorId ||
      existing.name !== input.name.trim() ||
      existing.fingerprint !== input.expectedFingerprint ||
      existing.note !== input.note.trim()
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "This release request has already been used."
      })
    return { id: existing.id }
  }
  const current = await getCommunityStandard(tx, input, actorId)
  if (current.fingerprint !== input.expectedFingerprint)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The working version changed. Reload and review it before creating a release."
    })
  assertStandardPaths(current.working.entries)
  if (!current.working.entries.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Add fields before creating a community release."
    })
  if (
    current.releases.some(
      (row) =>
        row.name.toLocaleLowerCase() === input.name.trim().toLocaleLowerCase()
    )
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "This community already has a release with that name."
    })
  await tx.insert(releases).values({
    id: input.id,
    vocabularySlug: input.vocabularySlug,
    referenceReleaseId: current.working.referenceReleaseId,
    name: input.name.trim(),
    note: input.note.trim(),
    parentId:
      current.releases.find(
        (row) => row.referenceReleaseId === current.working.referenceReleaseId
      )?.id ?? null,
    snapshot: current.working,
    fingerprint: current.fingerprint,
    createdById: actorId
  })
  return { id: input.id }
}

export async function commentOnStandardProposal(
  tx: MatcoreTransaction,
  input: { revisionId: string; text: string },
  actorId: number
) {
  const [revision] = await tx
    .select()
    .from(revisions)
    .where(eq(revisions.id, input.revisionId))
  if (!revision) throw unavailable()
  const record = await getMatcoreField(
    tx,
    revision.fieldId,
    revision.id,
    actorId
  )
  await requireVocabularyContent(tx, record.field.vocabularySlug, actorId, {
    lock: true
  })
  await requireSetupVocabularyForContribution(
    tx,
    record.field.vocabularySlug,
    actorId,
    true
  )
  await tx.insert(events).values({
    fieldId: revision.fieldId,
    revisionId: revision.id,
    actorId,
    action: "commented",
    detail: {
      authority: "contributor",
      policyVersion: MATCORE_WORKFLOW_POLICY,
      reason: input.text.trim()
    }
  })
  return { revisionId: revision.id }
}
