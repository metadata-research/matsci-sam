import "server-only"
import { TRPCError } from "@trpc/server"
import { and, desc, eq, isNull, or, sql } from "drizzle-orm"
import {
  db,
  definitionsTable as definitions,
  definitionRevisionsTable as definitionRevisions,
  termsTable as terms,
  matcoreFieldsTable as fields,
  matcoreSpecRevisionsTable as proposals,
  matcoreSourceReleasesTable as sourceReleases,
  matcoreWorkflowEventsTable as events,
  vocabularyMatcoreSourcesTable as sourceGrants
} from "@yamz/db"
import { requireVocabularyContent } from "./community-access"
import { participationContentVisible } from "./content-access"
import { compareCommunityContributions } from "./community-contribution-order"
import { revisionPath } from "./public-identifiers"

type Reader = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export type PersonalCommunityContribution = {
  target: string
  kind: "definition" | "proposal"
  label: string
  href: string
  version: string
  status: string
  createdAt: string
  referenceReleaseId: string | null
  referenceVersion: string | null
}

/** Owner-scoped work, independent of the community's currently selected reference. */
export async function communityPersonalContributions(
  reader: Reader,
  ownerId: number,
  input: {
    vocabularySlug: string
    profile?: string
    offset?: number
    limit?: number
  }
) {
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0)
    throw new TRPCError({ code: "UNAUTHORIZED" })
  const offset = input.offset ?? 0
  const limit = input.limit ?? 40
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new TRPCError({ code: "BAD_REQUEST" })
  await requireVocabularyContent(reader, input.vocabularySlug, ownerId)
  // Fetch a bounded prefix from each source so the merged page has stable order.
  const prefix = offset + limit + 1
  const [definitionRows, proposalRows] = await Promise.all([
    reader
      .select({
        id: definitionRevisions.id,
        version: definitionRevisions.version,
        definitionNumber: definitions.definitionNumber,
        label: terms.term,
        slug: terms.slug,
        createdAt: definitionRevisions.createdAt
      })
      .from(definitions)
      .innerJoin(terms, eq(terms.id, definitions.termId))
      .innerJoin(
        definitionRevisions,
        eq(definitionRevisions.id, definitions.currentRevisionId)
      )
      .where(
        and(
          eq(definitions.authorId, ownerId),
          eq(terms.vocabularySlug, input.vocabularySlug),
          isNull(terms.hiddenAt),
          participationContentVisible(
            definitionRevisions.surveyStepId,
            ownerId
          ),
          sql`NOT EXISTS (SELECT 1 FROM ${proposals} WHERE ${proposals.definitionRevisionId} = ${definitionRevisions.id})`
        )
      )
      .orderBy(
        desc(definitionRevisions.createdAt),
        desc(definitionRevisions.id)
      )
      .limit(prefix),
    reader
      .select({
        id: proposals.id,
        fieldId: proposals.fieldId,
        version: proposals.version,
        label: sql<string>`${proposals.payload}->>'label'`,
        profileReleaseId: proposals.profileReleaseId,
        referenceVersion: sourceReleases.version,
        createdAt: proposals.createdAt,
        status: sql<string>`COALESCE((SELECT ${events.detail}->>'decision' FROM ${events}
        WHERE ${events.revisionId} = ${proposals.id} AND ${events.action} IN ('reviewed', 'withdrawn')
        ORDER BY ${events.id} DESC LIMIT 1), 'awaiting_review')`
      })
      .from(proposals)
      .innerJoin(fields, eq(fields.id, proposals.fieldId))
      .leftJoin(
        sourceReleases,
        eq(sourceReleases.id, proposals.profileReleaseId)
      )
      .leftJoin(terms, eq(terms.id, fields.termId))
      .where(
        and(
          eq(proposals.createdById, ownerId),
          eq(fields.vocabularySlug, input.vocabularySlug),
          or(
            isNull(fields.termId),
            and(
              eq(terms.vocabularySlug, fields.vocabularySlug),
              isNull(terms.hiddenAt)
            )
          ),
          sql`(${proposals.profileReleaseId} IS NULL OR EXISTS (SELECT 1 FROM ${sourceGrants} sg
          WHERE sg."vocabularySlug" = ${fields.vocabularySlug} AND sg."releaseId" = ${proposals.profileReleaseId}))`,
          sql`(${proposals.definitionRevisionId} IS NULL OR EXISTS (SELECT 1 FROM ${definitionRevisions}
          WHERE ${definitionRevisions.id} = ${proposals.definitionRevisionId}
          AND ${participationContentVisible(definitionRevisions.surveyStepId, ownerId)}))`,
          input.profile ? eq(proposals.profileKey, input.profile) : undefined,
          // Keep the author's latest submitted revision, even if another member
          // later proposed a revision of the same field. Never substitute theirs.
          sql`NOT EXISTS (SELECT 1 FROM ${proposals} newer
          WHERE newer."fieldId" = ${proposals.fieldId} AND newer."occurrenceKey" = ${proposals.occurrenceKey}
          AND newer."createdById" = ${ownerId} AND newer.version > ${proposals.version})`
        )
      )
      .orderBy(desc(proposals.createdAt), desc(proposals.id))
      .limit(prefix)
  ])
  const rows: PersonalCommunityContribution[] = [
    ...definitionRows.map((row) => ({
      target: `definition:${row.id}`,
      kind: "definition" as const,
      label: row.label,
      href: revisionPath(
        row.slug,
        row.definitionNumber,
        row.version,
        input.vocabularySlug
      ),
      version: `Definition ${row.definitionNumber}, revision ${row.version}`,
      status: "published",
      createdAt: row.createdAt,
      referenceReleaseId: null,
      referenceVersion: null
    })),
    ...proposalRows.map((row) => ({
      target: `proposal:${row.id}`,
      kind: "proposal" as const,
      label: row.label,
      href: `/metadata/fields/${row.fieldId}?revision=${row.id}`,
      version: `Revision ${row.version}`,
      status: row.status,
      createdAt: row.createdAt,
      referenceReleaseId: row.profileReleaseId,
      referenceVersion: row.referenceVersion
    }))
  ].sort(compareCommunityContributions)
  return {
    rows: rows.slice(offset, offset + limit),
    hasMore: offset + limit <= 10000 && rows.length > offset + limit
  }
}
