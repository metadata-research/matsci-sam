import "server-only"
import { randomUUID } from "node:crypto"
import { TRPCError } from "@trpc/server"
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import {
  db,
  matcoreSourceReleasesTable as releases,
  matcoreSourceOccurrencesTable as occurrences,
  matcoreFieldsTable as fields,
  matcoreSpecDraftsTable as drafts,
  matcoreSpecRevisionsTable as revisions,
  matcoreWorkflowEventsTable as events,
  usersTable,
  termsTable,
  definitionRevisionsTable,
  definitionsTable,
  revisionImportOriginsTable,
  vocabularyWorkspaceSettingsTable as workspaceSettings,
  vocabulariesTable,
  communitiesTable,
  communityMembersTable,
  vocabularyMatcoreSourcesTable as sourceGrants
} from "@yamz/db"
import {
  parseMatcoreSourceManifest,
  matcoreManifestRows,
  matcoreManifestRelease
} from "./matcore-standard"
import {
  requireVocabularyContent,
  vocabularyContentVisible
} from "./community-access"
import {
  MATCORE_DRAFT_LIMIT,
  MATCORE_IMPORT_CHUNK,
  MATCORE_WORKFLOW_POLICY,
  matcoreDraftPayloadSchema,
  matcorePublicationPayloadSchema,
  type MatcoreDraftPayload,
  type MatcoreProfileKey,
  type MatcoreEventDetail
} from "./matcore-workflow-types"
import { sourceFieldName } from "./metadata-field-name"
import { mayRunCommunity } from "./communities"
import { requireSetupVocabularyForContribution } from "./setup-service"
import {
  contributionFingerprint,
  lockContributionSubmissions,
  reserveContributionSubmission
} from "./contribution-guard"
import { publishNewTerm } from "./new-term-publication"
import { createDefinitionWithInitialRevision } from "./definition-revisions"
import { termIsListed } from "./term-visibility"
import type { MatCoreStandardProfile } from "./matcore-standard-types"

export type MatcoreTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]
type Reader = typeof db | MatcoreTransaction
const missing = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "This metadata field or private draft is unavailable."
  })
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message:
      "This field draft changed in another tab or device. Keep your writing and reload the saved version before saving again."
  })
const profileOrder = (key: string) =>
  ["minimal", "dft", "md", "mbpt", "ml", "pf", "derived"].indexOf(key)

/** Explicit protected installation. This function is never exposed by an HTTP mutation. */
export async function installMatcoreSource(
  tx: MatcoreTransaction,
  input: { manifest: unknown; vocabularySlug: string },
  actorId: number
) {
  // Source-grant triggers take this lock too. Acquire it before the source
  // advisory lock so two installers cannot deadlock while upgrading shares.
  const [community] = await tx
    .select({ visibility: communitiesTable.visibility })
    .from(communitiesTable)
    .where(eq(communitiesTable.vocabularySlug, input.vocabularySlug))
    .for("update")
  await requireVocabularyContent(tx, input.vocabularySlug, actorId, {
    lock: true
  })
  const [actor] = await tx
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, actorId))
  if (actor?.role !== "admin")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A site administrator must install a source catalog."
    })
  if (community?.visibility !== "members")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Install protected source material only in a members-only community."
    })
  const manifest = parseMatcoreSourceManifest(input.manifest)
  const releaseId = `matcore:${manifest.release.version}`
  const source = matcoreManifestRelease(manifest)
  const manifestHash = contributionFingerprint(manifest)
  const rows = matcoreManifestRows(manifest)
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('matsci-sam:matcore-source-install'), hashtext(${releaseId}))`
  )
  const [stored] = await tx
    .select()
    .from(releases)
    .where(eq(releases.id, releaseId))
  if (stored) {
    if (
      stored.manifestHash !== manifestHash ||
      contributionFingerprint(stored.source) !==
        contributionFingerprint(source) ||
      contributionFingerprint(stored.profiles) !==
        contributionFingerprint(manifest.profiles)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This installed source release differs from the protected input. Its baseline has not been changed."
      })
    const existing = await tx
      .select()
      .from(occurrences)
      .where(eq(occurrences.releaseId, releaseId))
    const byId = new Map(existing.map((row) => [row.id, row]))
    if (
      existing.length !== rows.length ||
      rows.some(
        (row) =>
          contributionFingerprint(byId.get(row.id)) !==
          contributionFingerprint(row)
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The installed source occurrences differ from the protected input. No rows have been changed."
      })
  } else {
    await tx.insert(releases).values({
      id: releaseId,
      version: manifest.release.version,
      source,
      profiles: manifest.profiles,
      manifestHash
    })
    await tx.insert(occurrences).values(rows)
  }
  await tx
    .insert(sourceGrants)
    .values({
      vocabularySlug: input.vocabularySlug,
      releaseId,
      grantedById: actorId
    })
    .onConflictDoNothing()
  return {
    releaseId,
    occurrences: rows.length,
    alreadyInstalled: Boolean(stored),
    vocabularySlug: input.vocabularySlug
  }
}

async function entitledSourceReleases(reader: Reader, vocabularySlug: string) {
  return reader
    .select({
      id: releases.id,
      version: releases.version,
      source: releases.source
    })
    .from(releases)
    .innerJoin(sourceGrants, eq(sourceGrants.releaseId, releases.id))
    .where(eq(sourceGrants.vocabularySlug, vocabularySlug))
    .orderBy(desc(releases.createdAt), asc(releases.id))
}

export async function matcoreWorkflowCatalog(
  reader: Reader,
  input: { vocabularySlug: string; releaseId?: string },
  viewerId: number | null = null
) {
  const catalog = await listMatcoreSourceCatalog(reader, input, viewerId)
  return {
    release: catalog.selectedRelease?.source ?? null,
    releaseId: catalog.selectedRelease?.id ?? null,
    profiles: catalog.profiles,
    total: catalog.total,
    importChunk: MATCORE_IMPORT_CHUNK,
    policyVersion: MATCORE_WORKFLOW_POLICY,
    authority: "MatSci-SAM proposals; not official MatCore decisions"
  }
}

type SourceCatalogInput = {
  vocabularySlug: string
  releaseId?: string
  profileKey?: MatcoreProfileKey
  offset?: number
  limit?: number
  search?: string
  layout?: "list" | "hierarchy"
}
type SourceEntryInput = {
  vocabularySlug: string
  releaseId: string
  occurrenceId: string
}
const sourceMissing = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "This recorded MatCore version or source field is unavailable."
  })

/** Only installed snapshots explicitly granted to this workspace can be read. */
async function recordedSourceRelease(
  reader: Reader,
  vocabularySlug: string,
  id?: string
) {
  const available = await entitledSourceReleases(reader, vocabularySlug)
  const selectedId = id ?? available[0]?.id
  if (!selectedId || !available.some((row) => row.id === selectedId))
    throw sourceMissing()
  const [stored] = await reader
    .select()
    .from(releases)
    .where(eq(releases.id, selectedId))
  if (!stored) throw sourceMissing()
  return { ...stored, profiles: stored.profiles as MatCoreStandardProfile[] }
}
async function recordedSourceEntry(reader: Reader, input: SourceEntryInput) {
  const release = await recordedSourceRelease(
    reader,
    input.vocabularySlug,
    input.releaseId
  )
  const [row] = await reader
    .select()
    .from(occurrences)
    .where(
      and(
        eq(occurrences.releaseId, release.id),
        eq(occurrences.id, input.occurrenceId)
      )
    )
  if (!row) throw sourceMissing()
  const profile = release.profiles.find((item) => item.id === row.profileKey)
  if (!profile) throw sourceMissing()
  return { release, row, profile }
}

/** Listing reads authorized snapshots; it never creates fields or private drafts. */
export async function listMatcoreSourceCatalog(
  reader: Reader,
  input: SourceCatalogInput,
  viewerId: number | null = null
) {
  await requireVocabularyContent(reader, input.vocabularySlug, viewerId)
  const workspace = await getVocabularyWorkspace(
    reader,
    input.vocabularySlug,
    viewerId
  )
  const availableReleases = await entitledSourceReleases(
    reader,
    input.vocabularySlug
  )
  const selected =
    availableReleases.length || input.releaseId
      ? await recordedSourceRelease(
          reader,
          input.vocabularySlug,
          input.releaseId
        )
      : null
  if (
    input.profileKey &&
    (!selected ||
      !selected.profiles.some((item) => item.id === input.profileKey))
  )
    throw sourceMissing()
  const rows = selected
    ? await reader
        .select()
        .from(occurrences)
        .where(eq(occurrences.releaseId, selected.id))
    : []
  const search = input.search?.trim() ?? ""
  const needle = search.toLocaleLowerCase()
  const filtered = rows
    .filter((row) => !input.profileKey || row.profileKey === input.profileKey)
    .filter(
      (row) =>
        !needle ||
        [
          row.baseline.label,
          row.baseline.definition,
          row.baseline.specification.path,
          row.source.path.join(" / ")
        ].some((text) => text.toLocaleLowerCase().includes(needle))
    )
    .sort(
      (a, b) =>
        profileOrder(a.profileKey) - profileOrder(b.profileKey) ||
        a.baseline.specification.path.localeCompare(
          b.baseline.specification.path
        ) ||
        a.id.localeCompare(b.id)
    )
  const offset = input.offset ?? 0,
    limit = input.limit ?? 40
  const matches = new Set(filtered.map((row) => row.id))
  return {
    workspace,
    releases: availableReleases,
    selectedRelease: selected
      ? { id: selected.id, version: selected.version, source: selected.source }
      : null,
    profiles: (selected?.profiles ?? []).map((profile) => ({
      ...profile,
      count: rows.filter((row) => row.profileKey === profile.id).length
    })),
    profileKey: input.profileKey ?? null,
    search,
    occurrences:
      input.layout === "hierarchy"
        ? []
        : filtered.slice(offset, offset + limit),
    layout: input.layout ?? "list",
    // Include parent structure across page and search boundaries, after the
    // same community and source-release authorization as the list view.
    hierarchy:
      input.layout === "hierarchy"
        ? rows
            .filter(
              (row) => !input.profileKey || row.profileKey === input.profileKey
            )
            .sort(
              (a, b) =>
                a.baseline.specification.path.localeCompare(
                  b.baseline.specification.path
                ) || a.id.localeCompare(b.id)
            )
            .map((row) => ({
              id: row.id,
              profileKey: row.profileKey,
              path: row.source.path,
              label: row.baseline.label,
              requirement: row.baseline.specification.requirement,
              repeatability: row.baseline.specification.repeatability,
              matches: matches.has(row.id)
            }))
        : [],
    total: filtered.length,
    offset,
    limit
  }
}

async function ownSourceDraft(
  reader: Reader,
  input: SourceEntryInput,
  ownerId: number
) {
  const [row] = await reader
    .select({ id: drafts.id, publishedRevisionId: drafts.publishedRevisionId })
    .from(drafts)
    .innerJoin(fields, eq(drafts.fieldId, fields.id))
    .where(
      and(
        eq(fields.vocabularySlug, input.vocabularySlug),
        eq(drafts.ownerId, ownerId),
        eq(drafts.sourceOccurrenceId, input.occurrenceId),
        eq(drafts.profileReleaseId, input.releaseId)
      )
    )
    .orderBy(
      sql`${drafts.publishedRevisionId} IS NULL DESC`,
      desc(drafts.updatedAt),
      asc(drafts.id)
    )
    .limit(1)
  return row ?? null
}
async function publicSourceProposal(reader: Reader, input: SourceEntryInput) {
  const [row] = await reader
    .select({ fieldId: fields.id, revisionId: revisions.id })
    .from(revisions)
    .innerJoin(fields, eq(revisions.fieldId, fields.id))
    .leftJoin(termsTable, eq(fields.termId, termsTable.id))
    .leftJoin(
      definitionRevisionsTable,
      eq(revisions.definitionRevisionId, definitionRevisionsTable.id)
    )
    .leftJoin(
      definitionsTable,
      eq(definitionRevisionsTable.definitionId, definitionsTable.id)
    )
    .where(
      and(
        eq(fields.vocabularySlug, input.vocabularySlug),
        or(
          and(isNull(fields.termId), isNull(revisions.definitionRevisionId)),
          and(
            eq(termsTable.vocabularySlug, fields.vocabularySlug),
            eq(definitionsTable.termId, termsTable.id),
            termIsListed()
          )
        ),
        eq(revisions.sourceOccurrenceId, input.occurrenceId),
        eq(revisions.profileReleaseId, input.releaseId)
      )
    )
    .orderBy(desc(revisions.version))
    .limit(1)
  return row ?? null
}

export async function getMatcoreSourceEntry(
  reader: Reader,
  input: SourceEntryInput,
  viewerId: number | null = null
) {
  await requireVocabularyContent(reader, input.vocabularySlug, viewerId)
  const workspace = await getVocabularyWorkspace(
    reader,
    input.vocabularySlug,
    viewerId
  )
  const { release, row, profile } = await recordedSourceEntry(reader, input)
  const own =
    viewerId === null ? null : await ownSourceDraft(reader, input, viewerId)
  let permitted = false
  let contributionBlockReason: "profile" | "membership" | null = null
  if (viewerId !== null && !workspace.retired) {
    try {
      await requireSetupVocabularyForContribution(
        reader,
        input.vocabularySlug,
        viewerId
      )
      permitted = true
    } catch (error) {
      if (
        !(error instanceof TRPCError) ||
        !["FORBIDDEN", "PRECONDITION_FAILED", "BAD_REQUEST"].includes(
          error.code
        )
      )
        throw error
      contributionBlockReason =
        error.code === "PRECONDITION_FAILED"
          ? "profile"
          : error.code === "FORBIDDEN"
            ? "membership"
            : null
    }
  }
  return {
    workspace,
    contributionBlockReason,
    releaseId: release.id,
    occurrenceId: row.id,
    baseline: row.baseline,
    sourceOccurrence: row.source,
    sourceRelease: release.source,
    profileContext: { release: release.source, profile },
    ownDraft: own
      ? {
          id: own.id,
          status: own.publishedRevisionId
            ? ("published" as const)
            : ("draft" as const)
        }
      : null,
    latestProposal: await publicSourceProposal(reader, input),
    canContribute:
      permitted && workspace.metadataEnabled && workspace.matcoreEnabled,
    canResume: permitted && Boolean(own && !own.publishedRevisionId)
  }
}

/** Starts one proposal, or resumes the owner's exact saved work without rebasing it. */
export async function startMatcoreSourceChange(
  tx: MatcoreTransaction,
  input: SourceEntryInput,
  ownerId: number
) {
  await lockOwner(tx, ownerId)
  await requireVocabularyContent(tx, input.vocabularySlug, ownerId, {
    lock: true
  })
  await requireSetupVocabularyForContribution(
    tx,
    input.vocabularySlug,
    ownerId,
    true
  )
  const source = await recordedSourceEntry(tx, input)
  const own = await ownSourceDraft(tx, input, ownerId)
  if (own && !own.publishedRevisionId)
    return { kind: "draft" as const, draftId: own.id, resumed: true }
  const [existingField] = await tx
    .select()
    .from(fields)
    .where(
      and(
        eq(fields.vocabularySlug, input.vocabularySlug),
        eq(fields.sourceFieldId, source.row.sourceFieldId)
      )
    )
    .for("update")
  if (
    existingField &&
    (await latestRevision(tx, existingField.id, input.occurrenceId))
  ) {
    const proposal = await publicSourceProposal(tx, input)
    if (proposal) return { kind: "proposal" as const, ...proposal }
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "A local proposal already exists for this source field but is unavailable. The source baseline and your saved work have not changed."
    })
  }
  await requireWorkspaceCreation(tx, input.vocabularySlug, true)
  await enforceQuota(tx, ownerId, 1)
  await tx
    .insert(fields)
    .values({
      id: randomUUID(),
      vocabularySlug: input.vocabularySlug,
      sourceFieldId: source.row.sourceFieldId,
      label: source.row.baseline.label,
      createdById: ownerId
    })
    .onConflictDoNothing()
  const [field] = await tx
    .select()
    .from(fields)
    .where(
      and(
        eq(fields.vocabularySlug, input.vocabularySlug),
        eq(fields.sourceFieldId, source.row.sourceFieldId)
      )
    )
    .for("update")
  // Another contributor may have published while this transaction waited for
  // the shared source field. Never reset that proposal to its source baseline.
  if (await latestRevision(tx, field.id, input.occurrenceId)) {
    const proposal = await publicSourceProposal(tx, input)
    if (proposal) return { kind: "proposal" as const, ...proposal }
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "A local proposal already exists for this source field but is unavailable."
    })
  }
  const payload = {
    ...source.row.baseline,
    label: sourceFieldName(source.row.source)
  }
  const id = randomUUID()
  await tx.insert(drafts).values({
    id,
    ownerId,
    fieldId: field.id,
    occurrenceKey: source.row.id,
    profileKey: source.row.profileKey,
    profileReleaseId: source.release.id,
    sourceOccurrenceId: source.row.id,
    importKey: `${input.vocabularySlug}:${source.row.id}`,
    payload,
    creationHash: contributionFingerprint(payload)
  })
  await addEvent(tx, {
    fieldId: field.id,
    draftId: id,
    actorId: ownerId,
    action: "imported",
    detail: {
      authority: "source_import",
      sourcePublisher: source.release.source.attribution,
      sourceHash: source.release.source.sha256,
      reason: "Started a proposed change from a preserved MatCore source field."
    }
  })
  return { kind: "draft" as const, draftId: id, resumed: false }
}

async function lockOwner(tx: MatcoreTransaction, ownerId: number) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('matsci-sam:matcore-drafts'), ${ownerId})`
  )
}
async function enforceQuota(
  tx: MatcoreTransaction,
  ownerId: number,
  additional: number
) {
  const [count] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(drafts)
    .where(and(eq(drafts.ownerId, ownerId), isNull(drafts.publishedRevisionId)))
  if (count.value + additional > MATCORE_DRAFT_LIMIT)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `The metadata workspace allows ${MATCORE_DRAFT_LIMIT} private field drafts. Existing drafts remain saved; this import has not been truncated.`
    })
}
async function addEvent(
  tx: MatcoreTransaction,
  input: {
    fieldId: string
    draftId?: string
    revisionId?: string
    actorId: number
    action: typeof events.$inferInsert.action
    detail?: Partial<MatcoreEventDetail>
  }
) {
  await tx.insert(events).values({
    ...input,
    detail: {
      authority: "contributor",
      policyVersion: MATCORE_WORKFLOW_POLICY,
      ...input.detail
    }
  })
}
async function ownedDraft(
  reader: Reader,
  id: string,
  ownerId: number,
  lock = false
) {
  const query = reader
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, id), eq(drafts.ownerId, ownerId)))
  const [draft] = await (lock ? query.for("update") : query)
  if (!draft) throw missing()
  const [field] = await reader
    .select({ vocabularySlug: fields.vocabularySlug })
    .from(fields)
    .where(eq(fields.id, draft.fieldId))
  if (!field) throw missing()
  await requireVocabularyContent(reader, field.vocabularySlug, ownerId, {
    lock
  })
  if (draft.profileReleaseId)
    await recordedSourceRelease(
      reader,
      field.vocabularySlug,
      draft.profileReleaseId
    )
  return draft
}
async function sourceFor(reader: Reader, sourceOccurrenceId: string | null) {
  if (!sourceOccurrenceId)
    return { baseline: null, sourceOccurrence: null, sourceRelease: null }
  const [row] = await reader
    .select({
      baseline: occurrences.baseline,
      sourceOccurrence: occurrences.source,
      sourceRelease: releases.source
    })
    .from(occurrences)
    .innerJoin(releases, eq(occurrences.releaseId, releases.id))
    .where(eq(occurrences.id, sourceOccurrenceId))
  if (!row) throw new Error("Missing preserved field baseline")
  return row
}
async function fieldCommunity(reader: Reader, vocabularySlug: string) {
  const [community] = await reader
    .select({
      id: communitiesTable.id,
      slug: communitiesTable.slug,
      title: communitiesTable.title
    })
    .from(communitiesTable)
    .where(eq(communitiesTable.vocabularySlug, vocabularySlug))
  return community ?? null
}

/** Public capabilities, never draft counts, members or private content. */
export async function getVocabularyWorkspace(
  reader: Reader,
  vocabularySlug: string,
  viewerId: number | null = null,
  lock = false
) {
  if (!lock) await requireVocabularyContent(reader, vocabularySlug, viewerId)
  const communityQuery = reader
    .select()
    .from(communitiesTable)
    .where(eq(communitiesTable.vocabularySlug, vocabularySlug))
  const [community] = await (lock
    ? communityQuery.for("share")
    : communityQuery)
  const vocabularyQuery = reader
    .select()
    .from(vocabulariesTable)
    .where(eq(vocabulariesTable.slug, vocabularySlug))
  const [vocabulary] = await (lock
    ? vocabularyQuery.for("update")
    : vocabularyQuery)
  if (!vocabulary) throw missing()
  // Take the write lock before the authorization helper's shared vocabulary
  // lock; concurrent settings changes must not both try to upgrade a share.
  if (lock)
    await requireVocabularyContent(reader, vocabularySlug, viewerId, { lock })
  const membershipQuery = reader
    .select({ role: communityMembersTable.role })
    .from(communityMembersTable)
    .where(
      and(
        community
          ? eq(communityMembersTable.communityId, community.id)
          : sql`false`,
        viewerId === null
          ? sql`false`
          : eq(communityMembersTable.userId, viewerId),
        isNull(communityMembersTable.removedAt)
      )
    )
  const [membership] = await (lock
    ? membershipQuery.for("share")
    : membershipQuery)
  // Membership removal locks its episode before updating users.activeCommunityId.
  // Match that order so a concurrent steward removal cannot deadlock settings.
  const userQuery = reader
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(viewerId === null ? sql`false` : eq(usersTable.id, viewerId))
  const [user] = await (lock ? userQuery.for("share") : userQuery)
  const [settings] = await reader
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.vocabularySlug, vocabularySlug))
  const retired = Boolean(vocabulary.retiredAt || community?.retiredAt)
  const [sourceGrant] = await reader
    .select({ releaseId: sourceGrants.releaseId })
    .from(sourceGrants)
    .where(eq(sourceGrants.vocabularySlug, vocabularySlug))
    .limit(1)
  return {
    vocabularySlug,
    title: vocabulary.title,
    community: community
      ? { id: community.id, slug: community.slug, title: community.title }
      : null,
    metadataEnabled: settings?.metadataEnabled ?? false,
    matcoreEnabled: settings?.matcoreEnabled ?? false,
    hasMatcoreCatalog: Boolean(sourceGrant),
    retired,
    canManage:
      !retired &&
      (community
        ? mayRunCommunity(user ?? null, membership ?? null)
        : user?.role === "admin")
  }
}

export async function configureVocabularyWorkspace(
  tx: MatcoreTransaction,
  input: {
    vocabularySlug: string
    metadataEnabled: boolean
    matcoreEnabled: boolean
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
        "A community steward or site administrator must configure this workspace."
    })
  if (input.matcoreEnabled && !input.metadataEnabled)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enable metadata fields before enabling MatCore."
    })
  await tx
    .insert(workspaceSettings)
    .values({ ...input, updatedById: actorId })
    .onConflictDoUpdate({
      target: workspaceSettings.vocabularySlug,
      set: {
        metadataEnabled: input.metadataEnabled,
        matcoreEnabled: input.matcoreEnabled,
        updatedById: actorId,
        updatedAt: sql`now()`
      }
    })
  return getVocabularyWorkspace(tx, input.vocabularySlug, actorId)
}

async function requireWorkspaceCreation(
  tx: MatcoreTransaction,
  vocabularySlug: string,
  matcore: boolean
) {
  // A shared vocabulary lock coordinates with configuration's exclusive lock.
  const [settings] = await tx
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.vocabularySlug, vocabularySlug))
    .for("share")
  if (!settings?.metadataEnabled || (matcore && !settings.matcoreEnabled))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: matcore
        ? "Enable MatCore in this community or vocabulary workspace before creating MatCore drafts."
        : "Enable metadata fields in this community or vocabulary workspace before creating a field."
    })
}

async function profileFor(
  reader: Reader,
  profileReleaseId: string | null,
  profileKey: string | null
) {
  if (!profileReleaseId && !profileKey) return null
  if (!profileReleaseId || !profileKey)
    throw new Error("Incomplete metadata profile pin")
  const [release] = await reader
    .select()
    .from(releases)
    .where(eq(releases.id, profileReleaseId))
  const profile = (
    release?.profiles as MatCoreStandardProfile[] | undefined
  )?.find((row) => row.id === profileKey)
  if (!release || !profile) throw new Error("Missing pinned metadata profile")
  return { release: release.source, profile }
}
async function history(
  reader: Reader,
  fieldId: string,
  scope: { draftId?: string; revisionId?: string } = {}
) {
  return reader
    .select({
      id: events.id,
      action: events.action,
      actorId: events.actorId,
      actorName: usersTable.name,
      createdAt: events.createdAt,
      revisionId: events.revisionId,
      detail: events.detail
    })
    .from(events)
    .innerJoin(usersTable, eq(events.actorId, usersTable.id))
    .where(
      and(
        eq(events.fieldId, fieldId),
        scope.draftId
          ? or(
              eq(events.draftId, scope.draftId),
              sql`${events.revisionId} IS NOT NULL`
            )
          : sql`${events.revisionId} IS NOT NULL`,
        // Select the revision before bounding its timeline. Newer activity on
        // other revisions must not hide this revision's published provenance.
        scope.revisionId ? eq(events.revisionId, scope.revisionId) : undefined
      )
    )
    .orderBy(desc(events.id))
    .limit(200)
}
export async function getMatcoreDraft(
  reader: Reader,
  id: string,
  ownerId: number
) {
  const draft = await ownedDraft(reader, id, ownerId)
  const [field] = await reader
    .select()
    .from(fields)
    .where(eq(fields.id, draft.fieldId))
  return {
    ...draft,
    vocabularySlug: field.vocabularySlug,
    community: await fieldCommunity(reader, field.vocabularySlug),
    status: draft.publishedRevisionId
      ? ("published" as const)
      : ("draft" as const),
    ...(await sourceFor(reader, draft.sourceOccurrenceId)),
    profileContext: await profileFor(
      reader,
      draft.profileReleaseId,
      draft.profileKey
    ),
    history: await history(reader, draft.fieldId, { draftId: draft.id })
  }
}
export async function listMatcoreDrafts(
  reader: Reader,
  ownerId: number,
  input: {
    vocabularySlug?: string
    communitySlug?: string
    profileKey?: MatcoreProfileKey
    offset?: number
    limit?: number
    recentUnpublished?: boolean
  }
) {
  const filter = and(
    eq(drafts.ownerId, ownerId),
    input.recentUnpublished
      ? sql`${drafts.publishedRevisionId} IS NULL`
      : undefined,
    vocabularyContentVisible(fields.vocabularySlug, ownerId),
    sql`(${drafts.profileReleaseId} IS NULL OR EXISTS (SELECT 1 FROM ${sourceGrants} sg WHERE sg."vocabularySlug"=${fields.vocabularySlug} AND sg."releaseId"=${drafts.profileReleaseId}))`,
    input.vocabularySlug
      ? eq(fields.vocabularySlug, input.vocabularySlug)
      : undefined,
    input.profileKey ? eq(drafts.profileKey, input.profileKey) : undefined,
    input.communitySlug
      ? sql`EXISTS (SELECT 1 FROM ${communitiesTable} c WHERE c."vocabularySlug" = ${fields.vocabularySlug} AND c.slug = ${input.communitySlug})`
      : undefined
  )
  const [count] = await reader
    .select({ total: sql<number>`count(*)::int` })
    .from(drafts)
    .innerJoin(fields, eq(drafts.fieldId, fields.id))
    .where(filter)
  const rows = await reader
    .select({
      id: drafts.id,
      version: drafts.version,
      label: sql<string>`${drafts.payload}->>'label'`,
      profileKey: drafts.profileKey,
      path: sql<string>`${drafts.payload}->'specification'->>'path'`,
      status: sql<
        "draft" | "published"
      >`CASE WHEN ${drafts.publishedRevisionId} IS NULL THEN 'draft' ELSE 'published' END`,
      updatedAt: drafts.updatedAt,
      fieldId: drafts.fieldId,
      publishedRevisionId: drafts.publishedRevisionId,
      vocabularySlug: fields.vocabularySlug
    })
    .from(drafts)
    .innerJoin(fields, eq(drafts.fieldId, fields.id))
    .where(filter)
    .orderBy(
      ...(input.recentUnpublished ? [sql`${drafts.updatedAt} DESC`] : []),
      sql`CASE ${drafts.profileKey} WHEN 'minimal' THEN 0 WHEN 'dft' THEN 1 ELSE 2 END`,
      asc(drafts.profileKey),
      asc(sql`${drafts.payload}->'specification'->>'path'`),
      asc(drafts.id)
    )
    .limit(input.limit ?? 40)
    .offset(input.offset ?? 0)
  return { drafts: rows, total: count.total }
}

export async function importMatcoreStandard(
  tx: MatcoreTransaction,
  vocabularySlug: string,
  ownerId: number,
  selectedReleaseId?: string
) {
  await lockOwner(tx, ownerId)
  await requireVocabularyContent(tx, vocabularySlug, ownerId, { lock: true })
  await requireSetupVocabularyForContribution(tx, vocabularySlug, ownerId, true)
  await requireWorkspaceCreation(tx, vocabularySlug, true)
  const sourceRelease = await recordedSourceRelease(
    tx,
    vocabularySlug,
    selectedReleaseId
  )
  const releaseId = sourceRelease.id
  const rows = await tx
    .select()
    .from(occurrences)
    .where(eq(occurrences.releaseId, releaseId))
    .orderBy(
      sql`CASE ${occurrences.profileKey} WHEN 'minimal' THEN 0 WHEN 'dft' THEN 1 WHEN 'md' THEN 2 WHEN 'mbpt' THEN 3 WHEN 'ml' THEN 4 WHEN 'pf' THEN 5 ELSE 6 END`,
      asc(occurrences.id)
    )
  if (rows.length > MATCORE_DRAFT_LIMIT)
    throw new Error("The reviewed release exceeds its bounded import quota")
  const keys = rows.map((row) => `${vocabularySlug}:${row.id}`)
  const existing = await tx
    .select({ importKey: drafts.importKey })
    .from(drafts)
    .where(and(eq(drafts.ownerId, ownerId), inArray(drafts.importKey, keys)))
  const imported = new Set(existing.map((row) => row.importKey))
  const remaining = rows.filter(
    (row) => !imported.has(`${vocabularySlug}:${row.id}`)
  )
  const chunk = remaining.slice(0, MATCORE_IMPORT_CHUNK)
  // Check capacity for the entire remainder before committing this chunk.
  // A bounded import must not knowingly stop halfway through the release.
  await enforceQuota(tx, ownerId, remaining.length)
  for (const row of chunk) {
    await tx
      .insert(fields)
      .values({
        id: randomUUID(),
        vocabularySlug,
        sourceFieldId: row.sourceFieldId,
        label: row.baseline.label,
        createdById: ownerId
      })
      .onConflictDoNothing()
    const [field] = await tx
      .select()
      .from(fields)
      .where(
        and(
          eq(fields.vocabularySlug, vocabularySlug),
          eq(fields.sourceFieldId, row.sourceFieldId)
        )
      )
    const id = randomUUID()
    await tx.insert(drafts).values({
      id,
      ownerId,
      fieldId: field.id,
      occurrenceKey: row.id,
      profileKey: row.profileKey,
      profileReleaseId: releaseId,
      sourceOccurrenceId: row.id,
      importKey: `${vocabularySlug}:${row.id}`,
      payload: row.baseline,
      creationHash: contributionFingerprint(row.baseline)
    })
    await addEvent(tx, {
      fieldId: field.id,
      draftId: id,
      actorId: ownerId,
      action: "imported",
      detail: {
        authority: "source_import",
        sourcePublisher: sourceRelease.source.attribution,
        sourceHash: sourceRelease.source.sha256
      }
    })
  }
  return {
    created: chunk.length,
    existing: existing.length,
    total: rows.length,
    complete: remaining.length === chunk.length
  }
}

export async function createMatcoreDraft(
  tx: MatcoreTransaction,
  input: {
    id: string
    vocabularySlug: string
    profileKey?: MatcoreProfileKey
    profileReleaseId?: string
    payload: MatcoreDraftPayload
  },
  ownerId: number
) {
  const payload = matcoreDraftPayloadSchema.parse(input.payload)
  const creationHash = contributionFingerprint({
    vocabularySlug: input.vocabularySlug,
    profileKey: input.profileKey,
    ...(input.profileReleaseId
      ? { profileReleaseId: input.profileReleaseId }
      : {}),
    payload
  })
  await lockOwner(tx, ownerId)
  await requireVocabularyContent(tx, input.vocabularySlug, ownerId, {
    lock: true
  })
  const [prior] = await tx.select().from(drafts).where(eq(drafts.id, input.id))
  if (prior) {
    if (prior.ownerId !== ownerId || prior.creationHash !== creationHash)
      throw conflict()
    return getMatcoreDraft(tx, prior.id, ownerId)
  }
  await requireSetupVocabularyForContribution(
    tx,
    input.vocabularySlug,
    ownerId,
    true
  )
  await requireWorkspaceCreation(
    tx,
    input.vocabularySlug,
    Boolean(input.profileKey)
  )
  await enforceQuota(tx, ownerId, 1)
  if (input.profileReleaseId && !input.profileKey)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select a profile with its source release."
    })
  const sourceRelease = input.profileKey
    ? await recordedSourceRelease(
        tx,
        input.vocabularySlug,
        input.profileReleaseId
      )
    : null
  if (
    sourceRelease &&
    !sourceRelease.profiles.some((profile) => profile.id === input.profileKey)
  )
    throw sourceMissing()
  const fieldId = randomUUID()
  await tx.insert(fields).values({
    id: fieldId,
    vocabularySlug: input.vocabularySlug,
    label: payload.label || "New metadata field",
    createdById: ownerId
  })
  await tx.insert(drafts).values({
    id: input.id,
    ownerId,
    fieldId,
    occurrenceKey: `local:${fieldId}:${input.profileKey ?? "field"}`,
    profileKey: input.profileKey ?? null,
    profileReleaseId: sourceRelease?.id ?? null,
    payload,
    creationHash
  })
  await addEvent(tx, {
    fieldId,
    draftId: input.id,
    actorId: ownerId,
    action: "created"
  })
  return getMatcoreDraft(tx, input.id, ownerId)
}
export async function updateMatcoreDraft(
  tx: MatcoreTransaction,
  input: {
    id: string
    expectedVersion: number
    mutationId: string
    payload: MatcoreDraftPayload
  },
  ownerId: number
) {
  const payload = matcoreDraftPayloadSchema.parse(input.payload)
  const draft = await ownedDraft(tx, input.id, ownerId, true)
  if (draft.publishedRevisionId) throw conflict()
  const hash = contributionFingerprint({
    expectedVersion: input.expectedVersion,
    payload
  })
  if (draft.lastMutationId === input.mutationId) {
    if (draft.lastMutationHash !== hash) throw conflict()
    return getMatcoreDraft(tx, input.id, ownerId)
  }
  if (draft.version !== input.expectedVersion) throw conflict()
  await tx
    .update(drafts)
    .set({
      payload,
      version: draft.version + 1,
      lastMutationId: input.mutationId,
      lastMutationHash: hash,
      updatedAt: sql`now()`
    })
    .where(eq(drafts.id, draft.id))
  await addEvent(tx, {
    fieldId: draft.fieldId,
    draftId: draft.id,
    actorId: ownerId,
    action: "saved",
    detail: {
      fromVersion: draft.version,
      toVersion: draft.version + 1,
      mutationId: input.mutationId
    }
  })
  return getMatcoreDraft(tx, input.id, ownerId)
}

async function latestRevision(
  reader: Reader,
  fieldId: string,
  occurrenceKey: string
) {
  const [revision] = await reader
    .select()
    .from(revisions)
    .where(
      and(
        eq(revisions.fieldId, fieldId),
        eq(revisions.occurrenceKey, occurrenceKey)
      )
    )
    .orderBy(desc(revisions.version))
    .limit(1)
  return revision ?? null
}
export async function publishMatcoreDraft(
  tx: MatcoreTransaction,
  input: { id: string; expectedVersion: number },
  ownerId: number
) {
  const result = await publishFieldDraft(tx, input, ownerId, true)
  if (!result.term || result.definitionRevisionId === null)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This proposal was submitted independently of the dictionary."
    })
  return {
    ...result,
    term: result.term,
    definitionRevisionId: result.definitionRevisionId
  }
}

export async function submitMatcoreDraft(
  tx: MatcoreTransaction,
  input: { id: string; expectedVersion: number },
  ownerId: number
) {
  return publishFieldDraft(tx, input, ownerId, false)
}

async function publishFieldDraft(
  tx: MatcoreTransaction,
  input: { id: string; expectedVersion: number },
  ownerId: number,
  dictionary: boolean
) {
  // Follow the shared contribution lock order before locking publication rows.
  await lockContributionSubmissions(tx, ownerId)
  const draft = await ownedDraft(tx, input.id, ownerId, true)
  if (draft.version !== input.expectedVersion) throw conflict()
  if (draft.publication) return draft.publication
  const parsed = matcorePublicationPayloadSchema.safeParse(draft.payload)
  if (!parsed.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: parsed.error.issues[0].message
    })
  const payload = parsed.data
  const [preview] = await tx
    .select()
    .from(fields)
    .where(eq(fields.id, draft.fieldId))
  await requireSetupVocabularyForContribution(
    tx,
    preview.vocabularySlug,
    ownerId,
    true
  )
  const [field] = await tx
    .select()
    .from(fields)
    .where(eq(fields.id, draft.fieldId))
    .for("update")
  const previous = await latestRevision(tx, field.id, draft.occurrenceKey)
  if ((previous?.id ?? null) !== draft.baseRevisionId)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "A newer proposal has been published for this field. Your draft remains saved. Review the newer proposal before starting a revision."
    })
  let term: { id: number; slug: string; vocabularySlug: string } | null = null
  let definitionRevisionId: number | null = null
  let newDefinitionRevision = false
  if (!field.termId && !dictionary) {
    await reserveContributionSubmission(tx, {
      userId: ownerId,
      kind: "definition",
      fingerprint: contributionFingerprint({ fieldId: field.id, payload })
    })
  } else if (!field.termId) {
    // The legacy route may create an initial dictionary entry, but must not
    // convert a field after independent revisions exist in any profile.
    const [independentRevision] = await tx
      .select({ id: revisions.id })
      .from(revisions)
      .where(eq(revisions.fieldId, field.id))
      .limit(1)
    if (independentRevision)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This field uses independent proposals. Submit this draft for review instead."
      })
    const created = await publishNewTerm(
      tx,
      {
        vocabularySlug: field.vocabularySlug,
        expectedVocabularySlug: field.vocabularySlug,
        term: payload.label,
        definition: payload.definition,
        initialExample: payload.example
      },
      ownerId
    )
    term = created.term
    definitionRevisionId = created.definition.currentRevisionId!
    newDefinitionRevision = true
    await tx
      .update(fields)
      .set({ termId: term.id, label: payload.label })
      .where(eq(fields.id, field.id))
  } else {
    const [savedTerm] = await tx
      .select({
        id: termsTable.id,
        slug: termsTable.slug,
        vocabularySlug: termsTable.vocabularySlug
      })
      .from(termsTable)
      .where(eq(termsTable.id, field.termId))
    if (!savedTerm || savedTerm.vocabularySlug !== field.vocabularySlug)
      throw conflict()
    term = savedTerm
    if (
      previous &&
      previous.definitionRevisionId !== null &&
      previous.payload.definition === payload.definition &&
      previous.payload.example === payload.example
    ) {
      definitionRevisionId = previous.definitionRevisionId
    } else {
      await reserveContributionSubmission(tx, {
        userId: ownerId,
        kind: "definition",
        fingerprint: contributionFingerprint({
          kind: "matcore-definition",
          termId: term.id,
          definition: payload.definition,
          example: payload.example
        })
      })
      const [previousDefinition] = previous?.definitionRevisionId
        ? await tx
            .select({ definitionId: definitionRevisionsTable.definitionId })
            .from(definitionRevisionsTable)
            .where(
              eq(definitionRevisionsTable.id, previous.definitionRevisionId)
            )
        : []
      const created = await createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: ownerId,
        definition: payload.definition,
        example: "",
        initialExample: payload.example,
        source: "initial",
        replacesDefinitionId: previousDefinition?.definitionId,
        derivedFromRevisionId: previous?.definitionRevisionId ?? undefined,
        changeNote:
          "Explanatory definition for a MatSci-SAM metadata field proposal."
      })
      definitionRevisionId = created.revision.id
      newDefinitionRevision = true
    }
  }
  if (
    newDefinitionRevision &&
    definitionRevisionId !== null &&
    draft.sourceOccurrenceId
  ) {
    const preserved = await sourceFor(tx, draft.sourceOccurrenceId)
    const [priorOrigin] = previous?.definitionRevisionId
      ? await tx
          .select()
          .from(revisionImportOriginsTable)
          .where(
            eq(
              revisionImportOriginsTable.revisionId,
              previous.definitionRevisionId
            )
          )
      : []
    const receipt = priorOrigin?.receipt ?? {
      schemaVersion: 1 as const,
      parserVersion: preserved.sourceRelease!.parserVersion,
      inputHash: preserved.sourceRelease!.sha256,
      rowHash: contributionFingerprint(preserved.sourceOccurrence),
      rowIdentity: draft.sourceOccurrenceId,
      record: preserved.sourceOccurrence!.sourceRow,
      importedAt: draft.createdAt,
      importedById: ownerId,
      originalTerm: preserved.baseline!.label,
      originalDefinition: preserved.baseline!.definition,
      publishOriginalWording: false,
      declaredOrigin: {
        title: `MatCore ${preserved.sourceRelease!.version}: ${preserved.baseline!.label}`,
        creator: preserved.sourceRelease!.attribution,
        url: preserved.sourceOccurrence!.sourceUrl,
        version: preserved.sourceRelease!.version,
        license: preserved.sourceRelease!.license ?? ""
      },
      ontology: [],
      scopeNote: null
    }
    await tx.insert(revisionImportOriginsTable).values({
      revisionId: definitionRevisionId,
      importedById: receipt.importedById,
      receipt
    })
  }
  const revisionId = randomUUID()
  await tx.insert(revisions).values({
    id: revisionId,
    fieldId: field.id,
    occurrenceKey: draft.occurrenceKey,
    profileKey: draft.profileKey,
    profileReleaseId: draft.profileReleaseId,
    sourceOccurrenceId: draft.sourceOccurrenceId,
    version: (previous?.version ?? 0) + 1,
    previousRevisionId: previous?.id ?? null,
    definitionRevisionId,
    payload,
    createdById: ownerId,
    policyVersion: MATCORE_WORKFLOW_POLICY
  })
  const publication = {
    fieldId: field.id,
    revisionId,
    definitionRevisionId,
    term
  }
  await tx
    .update(drafts)
    .set({
      publishedRevisionId: revisionId,
      publication,
      updatedAt: sql`now()`
    })
    .where(eq(drafts.id, draft.id))
  const preservedSource = draft.sourceOccurrenceId
    ? await sourceFor(tx, draft.sourceOccurrenceId)
    : null
  await addEvent(tx, {
    fieldId: field.id,
    draftId: draft.id,
    revisionId,
    actorId: ownerId,
    action: "published",
    detail: {
      reason: payload.rationale,
      ...(preservedSource?.sourceRelease
        ? {
            sourcePublisher: preservedSource.sourceRelease.attribution,
            sourceHash: preservedSource.sourceRelease.sha256
          }
        : {})
    }
  })
  return publication
}

export async function getMatcoreField(
  reader: Reader,
  id: string,
  revisionId?: string,
  viewerId: number | null = null
) {
  const [field] = await reader
    .select({
      id: fields.id,
      termId: fields.termId,
      label: fields.label,
      vocabularySlug: fields.vocabularySlug,
      termSlug: termsTable.slug
    })
    .from(fields)
    .leftJoin(termsTable, eq(fields.termId, termsTable.id))
    .where(
      and(
        eq(fields.id, id),
        vocabularyContentVisible(fields.vocabularySlug, viewerId),
        or(
          isNull(fields.termId),
          and(
            eq(fields.vocabularySlug, termsTable.vocabularySlug),
            termIsListed()
          )
        )
      )
    )
  if (!field) throw missing()
  const rows = await reader
    .select({ revision: revisions })
    .from(revisions)
    .leftJoin(
      definitionRevisionsTable,
      eq(revisions.definitionRevisionId, definitionRevisionsTable.id)
    )
    .leftJoin(
      definitionsTable,
      eq(definitionRevisionsTable.definitionId, definitionsTable.id)
    )
    .where(
      and(
        eq(revisions.fieldId, id),
        field.termId === null
          ? isNull(revisions.definitionRevisionId)
          : eq(definitionsTable.termId, field.termId)
      )
    )
    .orderBy(desc(revisions.createdAt), desc(revisions.version))
    .then((result) => result.map((row) => row.revision))
  if (!rows.length) throw missing()
  const selected = revisionId
    ? rows.find((row) => row.id === revisionId)
    : rows[0]
  if (!selected) throw missing()
  for (const row of rows)
    if (row.profileReleaseId)
      await recordedSourceRelease(
        reader,
        field.vocabularySlug,
        row.profileReleaseId
      )
  const timeline = await history(reader, id, { revisionId })
  const decisions = await reader
    .selectDistinctOn([events.revisionId], {
      revisionId: events.revisionId,
      detail: events.detail
    })
    .from(events)
    .where(
      and(
        eq(events.fieldId, id),
        inArray(events.action, ["reviewed", "withdrawn"])
      )
    )
    .orderBy(asc(events.revisionId), desc(events.id))
  return {
    field,
    canReview: (
      await getVocabularyWorkspace(reader, field.vocabularySlug, viewerId)
    ).canManage,
    community: await fieldCommunity(reader, field.vocabularySlug),
    revisions: rows.map((row) => ({
      ...row,
      reviewState:
        decisions.find((event) => event.revisionId === row.id)?.detail
          .decision ?? "awaiting_review"
    })),
    selectedRevisionId: selected.id,
    history: timeline,
    profileContext: await profileFor(
      reader,
      selected.profileReleaseId,
      selected.profileKey
    ),
    ...(await sourceFor(reader, selected.sourceOccurrenceId))
  }
}
export async function reviseMatcoreField(
  tx: MatcoreTransaction,
  revisionId: string,
  ownerId: number
) {
  await lockOwner(tx, ownerId)
  const [revision] = await tx
    .select()
    .from(revisions)
    .where(eq(revisions.id, revisionId))
  if (!revision) throw missing()
  await getMatcoreField(tx, revision.fieldId, revision.id, ownerId)
  const [field] = await tx
    .select()
    .from(fields)
    .where(eq(fields.id, revision.fieldId))
  await requireVocabularyContent(tx, field.vocabularySlug, ownerId, {
    lock: true
  })
  await requireSetupVocabularyForContribution(
    tx,
    field.vocabularySlug,
    ownerId,
    true
  )
  if (
    (await latestRevision(tx, field.id, revision.occurrenceKey))?.id !==
    revision.id
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "Start your revision from the latest proposal for this profile."
    })
  const [existing] = await tx
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.ownerId, ownerId),
        eq(drafts.baseRevisionId, revision.id),
        isNull(drafts.publishedRevisionId)
      )
    )
  if (existing) return getMatcoreDraft(tx, existing.id, ownerId)
  await enforceQuota(tx, ownerId, 1)
  const id = randomUUID()
  const payload = { ...revision.payload, rationale: "" }
  await tx.insert(drafts).values({
    id,
    ownerId,
    fieldId: field.id,
    occurrenceKey: revision.occurrenceKey,
    profileKey: revision.profileKey,
    profileReleaseId: revision.profileReleaseId,
    sourceOccurrenceId: revision.sourceOccurrenceId,
    baseRevisionId: revision.id,
    payload,
    creationHash: contributionFingerprint({ revisionId, payload })
  })
  await addEvent(tx, {
    fieldId: field.id,
    draftId: id,
    actorId: ownerId,
    action: "revision_started"
  })
  return getMatcoreDraft(tx, id, ownerId)
}
// Call after recording a decision, while holding the vocabulary write lock.
// A reversal may restore an older accepted revision at a now-occupied path.
async function validateWorkingStandardChange(
  tx: MatcoreTransaction,
  vocabularySlug: string,
  referenceReleaseId: string | null,
  actorId: number
) {
  const { getCommunityStandard, assertStandardPaths } = await import(
    "./community-standard"
  )
  const standard = await getCommunityStandard(
    tx,
    { vocabularySlug, referenceReleaseId: referenceReleaseId ?? undefined },
    actorId
  )
  assertStandardPaths(standard.working.entries)
}

export async function reviewMatcoreRevision(
  tx: MatcoreTransaction,
  input: {
    revisionId: string
    decision: "accepted" | "changes_requested" | "declined"
    reason: string
  },
  actorId: number
) {
  const [revision] = await tx
    .select()
    .from(revisions)
    .where(eq(revisions.id, input.revisionId))
  if (!revision) throw missing()
  const [scope] = await tx
    .select({ vocabularySlug: fields.vocabularySlug })
    .from(fields)
    .where(eq(fields.id, revision.fieldId))
  const workspace = await getVocabularyWorkspace(
    tx,
    scope.vocabularySlug,
    actorId,
    true
  )
  if (!workspace.canManage)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "A community steward or site administrator must review proposals."
    })
  const [user] = await tx
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, actorId))
  await tx
    .select({ id: fields.id })
    .from(fields)
    .where(eq(fields.id, revision.fieldId))
    .for("update")
  if (
    (await latestRevision(tx, revision.fieldId, revision.occurrenceKey))?.id !==
    revision.id
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This review names an older proposal. Review the latest revision; earlier decisions remain in its history."
    })
  const [withdrawal] = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(eq(events.revisionId, revision.id), eq(events.action, "withdrawn"))
    )
    .limit(1)
  if (withdrawal)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This proposal was withdrawn. Start a new revision before requesting another decision."
    })
  await addEvent(tx, {
    fieldId: revision.fieldId,
    revisionId: revision.id,
    actorId,
    action: "reviewed",
    detail: {
      authority:
        user.role === "admin" ? "site_administrator" : "community_steward",
      decision: input.decision,
      reason: input.reason.trim()
    }
  })
  await validateWorkingStandardChange(
    tx,
    scope.vocabularySlug,
    revision.profileReleaseId,
    actorId
  )
  return getMatcoreField(tx, revision.fieldId, undefined, actorId)
}

export async function withdrawMatcoreRevision(
  tx: MatcoreTransaction,
  input: { revisionId: string; reason: string },
  actorId: number
) {
  const [revision] = await tx
    .select()
    .from(revisions)
    .where(eq(revisions.id, input.revisionId))
  if (!revision) throw missing()
  const currentField = await getMatcoreField(
    tx,
    revision.fieldId,
    revision.id,
    actorId
  )
  // Serialize withdrawals with reviews and releases before locking the field.
  await getVocabularyWorkspace(
    tx,
    currentField.field.vocabularySlug,
    actorId,
    true
  )
  const [actor] = await tx
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, actorId))
  if (revision.createdById !== actorId && actor?.role !== "admin")
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Only the proposal's contributor or a site administrator can withdraw it."
    })
  await tx
    .select({ id: fields.id })
    .from(fields)
    .where(eq(fields.id, revision.fieldId))
    .for("update")
  if (
    (await latestRevision(tx, revision.fieldId, revision.occurrenceKey))?.id !==
    revision.id
  )
    throw conflict()
  const [existing] = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(eq(events.revisionId, revision.id), eq(events.action, "withdrawn"))
    )
    .limit(1)
  if (!existing) {
    await addEvent(tx, {
      fieldId: revision.fieldId,
      revisionId: revision.id,
      actorId,
      action: "withdrawn",
      detail: {
        authority:
          revision.createdById === actorId
            ? "contributor"
            : "site_administrator",
        decision: "withdrawn",
        reason: input.reason.trim()
      }
    })
    await validateWorkingStandardChange(
      tx,
      currentField.field.vocabularySlug,
      revision.profileReleaseId,
      actorId
    )
  }
  return getMatcoreField(tx, revision.fieldId, undefined, actorId)
}
