import "server-only"

import {
  commentsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  termsTable,
  vocabulariesTable,
  voteEventsTable
} from "@yamz/db"
import { asc, eq, inArray } from "drizzle-orm"

export async function loadTermActivityRecords(termId: number) {
  const [term] = await db
    .select({
      label: termsTable.term,
      slug: termsTable.slug,
      vocabularySlug: termsTable.vocabularySlug,
      vocabularyTitle: vocabulariesTable.title
    })
    .from(termsTable)
    .innerJoin(
      vocabulariesTable,
      eq(vocabulariesTable.slug, termsTable.vocabularySlug)
    )
    .where(eq(termsTable.id, termId))
    .limit(1)

  if (!term) return null

  const definitions = await db
    .select({
      id: definitionsTable.id,
      number: definitionsTable.definitionNumber,
      currentRevisionId: definitionsTable.currentRevisionId
    })
    .from(definitionsTable)
    .where(eq(definitionsTable.termId, termId))
    .orderBy(asc(definitionsTable.definitionNumber))

  const definitionIds = definitions.map((definition) => definition.id)
  if (definitionIds.length === 0)
    return {
      term,
      definitions,
      revisions: [],
      comments: [],
      votes: [],
      externalSources: []
    }

  const [revisions, comments, votes] = await Promise.all([
    db
      .select({
        id: definitionRevisionsTable.id,
        definitionId: definitionRevisionsTable.definitionId,
        version: definitionRevisionsTable.version,
        previousRevisionId: definitionRevisionsTable.previousRevisionId,
        derivedFromRevisionId: definitionRevisionsTable.derivedFromRevisionId,
        definitionDiff: definitionRevisionsTable.definitionDiff,
        source: definitionRevisionsTable.source,
        legacyIncomplete: definitionRevisionsTable.legacyIncomplete,
        createdAt: definitionRevisionsTable.createdAt
      })
      .from(definitionRevisionsTable)
      .where(inArray(definitionRevisionsTable.definitionId, definitionIds))
      .orderBy(
        asc(definitionRevisionsTable.createdAt),
        asc(definitionRevisionsTable.id)
      ),
    db
      .select({
        revisionId: commentsTable.revisionId,
        message: commentsTable.message,
        migratedLegacy: commentsTable.migratedLegacy,
        createdAt: commentsTable.createdAt
      })
      .from(commentsTable)
      .where(inArray(commentsTable.definitionId, definitionIds))
      .orderBy(asc(commentsTable.createdAt), asc(commentsTable.id)),
    db
      .select({
        revisionId: voteEventsTable.revisionId,
        kind: voteEventsTable.kind,
        backfilled: voteEventsTable.backfilled,
        migratedLegacy: voteEventsTable.migratedLegacy,
        createdAt: voteEventsTable.createdAt
      })
      .from(voteEventsTable)
      .where(inArray(voteEventsTable.definitionId, definitionIds))
      .orderBy(asc(voteEventsTable.createdAt), asc(voteEventsTable.id))
  ])

  const localRevisionIds = new Set(revisions.map((revision) => revision.id))
  const missingDerivedIds = Array.from(
    new Set(
      revisions
        .map((revision) => revision.derivedFromRevisionId)
        .filter((id): id is number => id !== null && !localRevisionIds.has(id))
    )
  )
  const externalSources = missingDerivedIds.length
    ? await db
        .select({
          id: definitionRevisionsTable.id,
          version: definitionRevisionsTable.version,
          definitionDiff: definitionRevisionsTable.definitionDiff,
          legacyIncomplete: definitionRevisionsTable.legacyIncomplete,
          definitionNumber: definitionsTable.definitionNumber,
          termSlug: termsTable.slug,
          vocabularySlug: termsTable.vocabularySlug
        })
        .from(definitionRevisionsTable)
        .innerJoin(
          definitionsTable,
          eq(definitionsTable.id, definitionRevisionsTable.definitionId)
        )
        .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
        .where(inArray(definitionRevisionsTable.id, missingDerivedIds))
    : []

  return { term, definitions, revisions, comments, votes, externalSources }
}

export type TermActivityRecords = NonNullable<
  Awaited<ReturnType<typeof loadTermActivityRecords>>
>
