import { createHash } from "node:crypto"
import { TRPCError } from "@trpc/server"
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm"
import {
  contributionFilesTable,
  contributionSubmissionsTable,
  db,
  termReferenceEntriesTable
} from "@yamz/db"
import type { ContributionFilePublication } from "./contribution-file-types"
import type { ModelReferenceInput } from "./reference-types"
import type { ReferenceSelection } from "./term-references"
import { CONTRIBUTION_LIMITS } from "./contribution-limits"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type ContributionKind = "definition" | "comment" | "example"

export const CONTRIBUTION_DUPLICATE_WINDOW_SECONDS = 60

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalValue(item)])
    )
  return value
}

/** Keep scientific case and internal whitespace; only hash the published act. */
export const contributionFingerprint = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex")

/**
 * Take this before any study or definition lock. A separate advisory lock
 * serializes an account's publications without reversing the user/study row
 * lock order used by enrollment and profile updates.
 */
export const lockContributionSubmissions = async (
  tx: Transaction,
  userId: number
) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(
    hashtext('matsci-sam:contribution-submissions'), ${userId}
  )`)
}

/**
 * Reserve one successful publication in the content transaction. A later
 * validation or write failure rolls this receipt back with the contribution.
 */
export const reserveContributionSubmission = async (
  tx: Transaction,
  input: { userId: number; kind: ContributionKind; fingerprint: string }
) => {
  await lockContributionSubmissions(tx, input.userId)
  // now() was captured before a contended lock. Read the actual database clock
  // after acquiring it, and use that same instant for both checks and receipt.
  const clockResult = await tx.execute<{ now: string }>(
    sql`SELECT clock_timestamp()::text AS now`
  )
  const clock = clockResult.rows[0]
  // Receipts are temporary submission controls, not contribution history.
  // Keep only the longest active window for accounts that continue publishing.
  await tx
    .delete(contributionSubmissionsTable)
    .where(
      and(
        eq(contributionSubmissionsTable.userId, input.userId),
        lt(
          contributionSubmissionsTable.createdAt,
          sql`${clock.now}::timestamptz - ${CONTRIBUTION_LIMITS.definition.seconds} * interval '1 second'`
        )
      )
    )
  const accountKind = and(
    eq(contributionSubmissionsTable.userId, input.userId),
    eq(contributionSubmissionsTable.kind, input.kind)
  )
  const duplicate = await tx.query.contributionSubmissionsTable.findFirst({
    columns: { id: true },
    where: and(
      accountKind,
      eq(contributionSubmissionsTable.fingerprint, input.fingerprint),
      gte(
        contributionSubmissionsTable.createdAt,
        sql`${clock.now}::timestamptz - ${CONTRIBUTION_DUPLICATE_WINDOW_SECONDS} * interval '1 second'`
      )
    )
  })
  if (duplicate)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This contribution was just submitted. Refresh the page to see it before trying again."
    })

  const limit = CONTRIBUTION_LIMITS[input.kind]
  const [recent] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(contributionSubmissionsTable)
    .where(
      and(
        accountKind,
        gte(
          contributionSubmissionsTable.createdAt,
          sql`${clock.now}::timestamptz - ${limit.seconds} * interval '1 second'`
        )
      )
    )
  if (recent.count >= limit.count)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `You can publish up to ${limit.count} ${input.kind}s in ${limit.seconds / 60} ${limit.seconds === 60 ? "minute" : "minutes"}. Please wait before submitting another ${input.kind}.`
    })

  await tx.insert(contributionSubmissionsTable).values({
    ...input,
    createdAt: sql`${clock.now}::timestamptz`
  })
}

const referenceEvidence = (reference: {
  sourceIri: string
  sourceKey: string
  kind: string
  version: string
  license: string | null
  contentHash: string
}) => ({
  sourceIri: reference.sourceIri,
  sourceKey: reference.sourceKey,
  kind: reference.kind,
  version: reference.version,
  license: reference.license,
  contentHash: reference.contentHash
})

const evidenceSet = (items: unknown[]) =>
  [...new Set(items.map(contributionFingerprint))].sort()

/**
 * Receipt/preview identifiers and retrieval times are not content. Resolve
 * selected evidence to its stored values so reopening a preview, reordering
 * citations or uploading the same file cannot defeat duplicate protection.
 * Publication still validates ownership and source binding through its
 * existing helpers, and failure rolls the submission receipt back.
 */
export const definitionSubmissionFingerprint = async (
  tx: Transaction,
  input: {
    vocabularySlug: string
    term: string
    definition: string
    initialExample?: string
    derivedFromRevisionId?: number
    replacesDefinitionId?: number
    surveyStepId?: number
    references?: ReferenceSelection[]
    attachments?: ContributionFilePublication[]
    modelReferences?: ModelReferenceInput[]
  }
) => {
  const referenceIds = [
    ...new Set(
      input.references?.flatMap((item) => item.citedReferenceIds) ?? []
    )
  ]
  const fileIds = input.attachments?.map((item) => item.fileId) ?? []
  const references = referenceIds.length
    ? await tx
        .select({
          sourceIri: termReferenceEntriesTable.sourceIri,
          sourceKey: termReferenceEntriesTable.sourceKey,
          kind: termReferenceEntriesTable.kind,
          version: termReferenceEntriesTable.version,
          license: termReferenceEntriesTable.license,
          contentHash: termReferenceEntriesTable.contentHash
        })
        .from(termReferenceEntriesTable)
        .where(inArray(termReferenceEntriesTable.id, referenceIds))
    : []
  const attachments = fileIds.length
    ? await tx
        .select({
          contentHash: contributionFilesTable.contentHash,
          role: contributionFilesTable.role,
          title: contributionFilesTable.title,
          caption: contributionFilesTable.caption,
          citation: contributionFilesTable.citation,
          page: contributionFilesTable.page
        })
        .from(contributionFilesTable)
        .where(inArray(contributionFilesTable.id, fileIds))
    : []

  return contributionFingerprint({
    vocabularySlug: input.vocabularySlug,
    term: input.term.trim().toLowerCase(),
    definition: input.definition.trim(),
    initialExample: input.initialExample?.trim() ?? "",
    derivedFromRevisionId: input.derivedFromRevisionId ?? null,
    replacesDefinitionId: input.replacesDefinitionId ?? null,
    surveyStepId: input.surveyStepId ?? null,
    references: evidenceSet(references.map(referenceEvidence)),
    attachments: evidenceSet(attachments),
    modelReferences: evidenceSet(
      (input.modelReferences ?? []).map((reference) => ({
        ...referenceEvidence(reference),
        context: reference.context,
        query: reference.query,
        request: reference.request
      }))
    )
  })
}
