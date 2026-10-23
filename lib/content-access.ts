import "server-only"
import { cache } from "react"
import { TRPCError } from "@trpc/server"
import { Column, getTableName, is, eq, sql, type SQLWrapper } from "drizzle-orm"
import { db, definitionsTable, definitionRevisionsTable } from "@yamz/db"
import { getSession } from "./session"
import {
  collectionContentVisible,
  vocabularyContentVisible,
  readableTermId,
  requireTermContent
} from "./community-access"

type Reader = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Request-only identity. Public dataset loaders always pass null explicitly. */
export const currentContentViewer = cache(
  async () => (await getSession()).id ?? null
)

const qualified = (column: SQLWrapper) =>
  is(column, Column)
    ? sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`
    : column

export const readableStudyId = (
  column: SQLWrapper,
  viewerId: number | null = null
) =>
  sql`${qualified(column)} IN (SELECT access_s.id FROM "studies" access_s JOIN "communities" access_c ON access_c.id=access_s."communityId" WHERE ${vocabularyContentVisible(sql`access_c."vocabularySlug"`, viewerId)} AND ${collectionContentVisible(sql`access_s."collectionId"`, viewerId)})`

/** Ungrouped participation is public with its term; study-linked acts also inherit study access. */
export const participationContentVisible = (
  column: SQLWrapper,
  viewerId: number | null = null
) => sql`(${qualified(column)} IS NULL OR ${qualified(column)} IN (
  SELECT privacy_step.id FROM "surveySteps" privacy_step WHERE ${readableStudyId(sql`privacy_step."studyId"`, viewerId)}
    AND (privacy_step."termId" IS NULL OR ${readableTermId(sql`privacy_step."termId"`, viewerId)})
))`

export const readableDefinitionId = (
  column: SQLWrapper,
  viewerId: number | null = null
) =>
  sql`${qualified(column)} IN (SELECT access_d.id FROM "definitions" access_d WHERE ${readableTermId(sql`access_d."termId"`, viewerId)})`

export const readableRevisionId = (
  column: SQLWrapper,
  viewerId: number | null = null
) =>
  sql`${qualified(column)} IN (SELECT access_r.id FROM "definitionRevisions" access_r WHERE ${readableDefinitionId(sql`access_r."definitionId"`, viewerId)})`

export async function requireDefinitionContent(
  reader: Reader,
  id: number,
  viewerId: number | null = null,
  options: { lock?: boolean; termLock?: "update" } = {}
) {
  const [definition] = await reader
    .select({ id: definitionsTable.id, termId: definitionsTable.termId })
    .from(definitionsTable)
    .where(eq(definitionsTable.id, id))
    .limit(1)
  if (!definition)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This definition is unavailable."
    })
  await requireTermContent(reader, definition.termId, viewerId, options)
  return definition
}

export async function requireRevisionContent(
  reader: Reader,
  id: number,
  viewerId: number | null = null,
  options: { lock?: boolean; termLock?: "update" } = {}
) {
  const [revision] = await reader
    .select({
      id: definitionRevisionsTable.id,
      definitionId: definitionRevisionsTable.definitionId
    })
    .from(definitionRevisionsTable)
    .where(eq(definitionRevisionsTable.id, id))
    .limit(1)
  if (!revision)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This revision is unavailable."
    })
  await requireDefinitionContent(
    reader,
    revision.definitionId,
    viewerId,
    options
  )
  return revision
}
