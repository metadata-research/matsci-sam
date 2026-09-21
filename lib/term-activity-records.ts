import "server-only"

import {
  aiContributionSuggestionsTable,
  commentsTable,
  db,
  definitionExamplesTable,
  definitionExampleSelectionsTable,
  definitionRevisionReferencesTable,
  definitionRevisionsTable,
  definitionsTable,
  termsTable,
  usersTable,
  vocabulariesTable,
  voteEventsTable
} from "@yamz/db"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

const selectedByUsers = alias(usersTable, "activityExampleSelectedBy")
const endedByUsers = alias(usersTable, "activityExampleEndedBy")

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
      examples: [],
      exampleSelections: [],
      revisionReferences: [],
      acceptedSuggestions: [],
      externalSources: []
    }

  const [
    revisions,
    comments,
    votes,
    examples,
    exampleSelections,
    revisionReferences,
    acceptedSuggestions
  ] = await Promise.all([
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
        model: definitionRevisionsTable.model,
        inference: definitionRevisionsTable.inference,
        editor: {
          id: usersTable.id,
          name: usersTable.name,
          isAi: usersTable.isAi,
          isProfilePublic: usersTable.isProfilePublic
        },
        createdAt: definitionRevisionsTable.createdAt
      })
      .from(definitionRevisionsTable)
      .leftJoin(
        usersTable,
        eq(definitionRevisionsTable.editorId, usersTable.id)
      )
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
      .orderBy(asc(voteEventsTable.createdAt), asc(voteEventsTable.id)),
    db
      .select({
        id: definitionExamplesTable.id,
        definitionId: definitionExamplesTable.definitionId,
        exampleNumber: definitionExamplesTable.exampleNumber,
        sourceRevisionId: definitionExamplesTable.sourceRevisionId,
        text: definitionExamplesTable.text,
        legacyBackfill: definitionExamplesTable.legacyBackfill,
        createdAt: definitionExamplesTable.createdAt,
        author: {
          id: usersTable.id,
          name: usersTable.name,
          isAi: usersTable.isAi,
          isProfilePublic: usersTable.isProfilePublic
        }
      })
      .from(definitionExamplesTable)
      .leftJoin(usersTable, eq(definitionExamplesTable.authorId, usersTable.id))
      .where(inArray(definitionExamplesTable.definitionId, definitionIds))
      .orderBy(
        asc(definitionExamplesTable.definitionId),
        asc(definitionExamplesTable.exampleNumber)
      ),
    db
      .select({
        id: definitionExampleSelectionsTable.id,
        definitionId: definitionExampleSelectionsTable.definitionId,
        exampleId: definitionExampleSelectionsTable.exampleId,
        selectedAt: definitionExampleSelectionsTable.selectedAt,
        endedAt: definitionExampleSelectionsTable.endedAt,
        legacyBackfill: definitionExampleSelectionsTable.legacyBackfill,
        selectedBy: {
          id: selectedByUsers.id,
          name: selectedByUsers.name,
          isAi: selectedByUsers.isAi,
          isProfilePublic: selectedByUsers.isProfilePublic
        },
        endedBy: {
          id: endedByUsers.id,
          name: endedByUsers.name,
          isAi: endedByUsers.isAi,
          isProfilePublic: endedByUsers.isProfilePublic
        }
      })
      .from(definitionExampleSelectionsTable)
      .leftJoin(
        selectedByUsers,
        eq(definitionExampleSelectionsTable.selectedById, selectedByUsers.id)
      )
      .leftJoin(
        endedByUsers,
        eq(definitionExampleSelectionsTable.endedById, endedByUsers.id)
      )
      .where(
        inArray(definitionExampleSelectionsTable.definitionId, definitionIds)
      )
      .orderBy(
        asc(definitionExampleSelectionsTable.selectedAt),
        asc(definitionExampleSelectionsTable.id)
      ),
    db
      .select({ revisionId: definitionRevisionReferencesTable.revisionId })
      .from(definitionRevisionReferencesTable)
      .innerJoin(
        definitionRevisionsTable,
        eq(
          definitionRevisionReferencesTable.revisionId,
          definitionRevisionsTable.id
        )
      )
      .where(inArray(definitionRevisionsTable.definitionId, definitionIds)),
    db
      .select({
        outputDefinitionId: aiContributionSuggestionsTable.outputDefinitionId,
        status: aiContributionSuggestionsTable.status,
        model: aiContributionSuggestionsTable.model,
        inference: aiContributionSuggestionsTable.inference,
        modelInputCount:
          sql<number>`coalesce(jsonb_array_length(${aiContributionSuggestionsTable.referenceInputs}), 0)`.mapWith(
            Number
          )
      })
      .from(aiContributionSuggestionsTable)
      .where(
        and(
          eq(aiContributionSuggestionsTable.status, "accepted"),
          inArray(
            aiContributionSuggestionsTable.outputDefinitionId,
            definitionIds
          )
        )
      )
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

  return {
    term,
    definitions,
    revisions,
    comments,
    votes,
    examples,
    exampleSelections,
    revisionReferences,
    acceptedSuggestions,
    externalSources
  }
}

export type TermActivityRecords = NonNullable<
  Awaited<ReturnType<typeof loadTermActivityRecords>>
>
