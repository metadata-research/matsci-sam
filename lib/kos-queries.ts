import "server-only"

import {
  collectionsTable,
  communityCollectionsTable,
  definitionRevisionsTable,
  conceptSchemesTable,
  conceptsTable,
  db,
  definitionsTable,
  statementsTable,
  termsTable,
  vocabulariesTable
} from "@yamz/db"
import { and, asc, eq, exists, isNull, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { TOPICS_SCHEME_SLUG, type ConceptRow } from "./kos"

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | DatabaseTransaction

/*
 * Read queries shared by the knowledge-organization pages. A statement is
 * active while retractedAt is null; rows are never deleted, so that is the
 * only liveness test. Counts come from a LEFT JOIN whose predicate and
 * liveness conditions sit in the ON clause: moved into WHERE they would turn
 * the join inner and drop every concept that nothing is filed under.
 */

// A concept is reached at term level in a facet scheme and at
// definition level in an open one (a topic). Counting the subject column that
// is non-null for the level in question yields zero for an unused concept and
// ignores a row asserted at the wrong level.
const activeSubjectOfConcept = and(
  eq(statementsTable.objectConceptId, conceptsTable.id),
  eq(statementsTable.predicate, "dcterms:subject"),
  isNull(statementsTable.retractedAt)
)

// Terms reached either way: directly for a facet, through the definition for
// a topic, deduplicated because two definitions of one term may share a topic.
const termCount = sql<number>`cast(count(distinct coalesce(${statementsTable.subjectTermId}, ${definitionsTable.termId})) as int)`
const definitionCount = sql<number>`cast(count(${statementsTable.subjectDefinitionId}) as int)`

export type ConceptSummary = {
  id: number
  slug: string
  label: string
  definition: string | null
  terms: number
  definitions: number
}

/*
 * Live concepts of one scheme with the number of terms and definitions filed
 * under each. `order` is "seeded" for a facet scheme, where the sequence the
 * curator established carries meaning (Processing, Structure, Properties,
 * Performance), and "label" for an open scheme browsed alphabetically.
 *
 * The label sort matches concepts_scheme_label_unique, which is on
 * lower(btrim(prefLabel)), so the index can serve it.
 */
export const conceptsOfScheme = async (
  schemeSlug: string,
  order: "label" | "seeded" = "label"
): Promise<ConceptSummary[]> =>
  await db
    .select({
      id: conceptsTable.id,
      slug: conceptsTable.slug,
      label: conceptsTable.prefLabel,
      definition: conceptsTable.definition,
      terms: termCount,
      definitions: definitionCount
    })
    .from(conceptsTable)
    .innerJoin(
      conceptSchemesTable,
      eq(conceptSchemesTable.id, conceptsTable.schemeId)
    )
    .leftJoin(statementsTable, activeSubjectOfConcept)
    .leftJoin(
      definitionsTable,
      eq(definitionsTable.id, statementsTable.subjectDefinitionId)
    )
    .where(
      and(
        eq(conceptSchemesTable.slug, schemeSlug),
        eq(conceptsTable.status, "approved")
      )
    )
    .groupBy(conceptsTable.id)
    .orderBy(
      order === "seeded"
        ? asc(conceptsTable.id)
        : asc(sql`lower(btrim(${conceptsTable.prefLabel}))`)
    )

export const topicConcepts = () => conceptsOfScheme(TOPICS_SCHEME_SLUG, "label")

export type SchemeSummary = {
  id: number
  slug: string
  title: string
  description: string | null
  conceptOrder: "seeded" | "label"
}

// Facet schemes are the ones that attach at term level. Reading the policy
// rather than naming `pspp` keeps a second facet scheme visible without
// another edit here.
export const facetSchemes = async (): Promise<SchemeSummary[]> =>
  await db
    .select({
      id: conceptSchemesTable.id,
      slug: conceptSchemesTable.slug,
      title: conceptSchemesTable.title,
      description: conceptSchemesTable.description,
      conceptOrder: conceptSchemesTable.conceptOrder
    })
    .from(conceptSchemesTable)
    .where(eq(conceptSchemesTable.attachesAt, "term"))
    .orderBy(asc(conceptSchemesTable.id))

// Every facet concept, for the term-page editor. Same row shape the tags
// router returns, so a picked row can be spliced into the facets cache.
export const facetOptions = async (): Promise<ConceptRow[]> =>
  await db
    .select({
      id: conceptsTable.id,
      name: conceptsTable.prefLabel,
      slug: conceptsTable.slug,
      schemeSlug: conceptSchemesTable.slug
    })
    .from(conceptsTable)
    .innerJoin(
      conceptSchemesTable,
      eq(conceptSchemesTable.id, conceptsTable.schemeId)
    )
    .where(
      and(
        eq(conceptSchemesTable.attachesAt, "term"),
        eq(conceptsTable.status, "approved")
      )
    )
    .orderBy(asc(conceptSchemesTable.id), asc(conceptsTable.id))

// Retired collections are hidden by default. A curator asks for them when
// deciding whether to restore one.
/*
 * The collections index. Passing a communityId narrows it to that community's
 * worklist. The narrowing goes in WHERE, not in the count join's ON clause:
 * the ON conditions decide what is counted and must stay there so a collection
 * with no members survives, whereas the scope decides which collections exist
 * for this viewer at all. With no communityId the emitted SQL is unchanged.
 */
export const collectionsWithCounts = async ({
  includeRetired = false,
  communityId
}: { includeRetired?: boolean; communityId?: number } = {}) =>
  await db
    .select({
      id: collectionsTable.id,
      slug: collectionsTable.slug,
      title: collectionsTable.title,
      description: collectionsTable.description,
      retiredAt: collectionsTable.retiredAt,
      members: sql<number>`cast(count(${statementsTable.objectTermId}) as int)`
    })
    .from(collectionsTable)
    .leftJoin(
      statementsTable,
      and(
        eq(statementsTable.subjectCollectionId, collectionsTable.id),
        eq(statementsTable.predicate, "skos:member"),
        isNull(statementsTable.retractedAt)
      )
    )
    .where(
      and(
        includeRetired ? undefined : isNull(collectionsTable.retiredAt),
        communityId === undefined
          ? undefined
          : exists(
              db
                .select({ one: sql`1` })
                .from(communityCollectionsTable)
                .where(
                  and(
                    eq(
                      communityCollectionsTable.collectionId,
                      collectionsTable.id
                    ),
                    eq(communityCollectionsTable.communityId, communityId),
                    isNull(communityCollectionsTable.removedAt)
                  )
                )
            )
      )
    )
    .groupBy(collectionsTable.id)
    .orderBy(asc(sql`lower(btrim(${collectionsTable.title}))`))

// Members drive from the statements table, so the liveness conditions belong
// in WHERE here; there is no outer join to degrade.
export const collectionMembers = async (
  collectionId: number,
  executor: Executor = db
) =>
  await executor
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      vocabularySlug: termsTable.vocabularySlug,
      vocabularyTitle: vocabulariesTable.title,
      definitions: sql<number>`cast(count(${definitionsTable.id}) as int)`
    })
    .from(statementsTable)
    .innerJoin(termsTable, eq(termsTable.id, statementsTable.objectTermId))
    .innerJoin(
      vocabulariesTable,
      eq(vocabulariesTable.slug, termsTable.vocabularySlug)
    )
    .leftJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
    .where(
      and(
        eq(statementsTable.predicate, "skos:member"),
        eq(statementsTable.subjectCollectionId, collectionId),
        isNull(statementsTable.retractedAt)
      )
    )
    .groupBy(termsTable.id, vocabulariesTable.slug)
    .orderBy(
      asc(sql`lower(btrim(${termsTable.term}))`),
      asc(sql`lower(btrim(${vocabulariesTable.title}))`)
    )

export type CommunityCollectionVocabularyCount = {
  collectionId: number
  vocabularySlug: string
  vocabularyTitle: string
  terms: number
}

/*
 * Vocabulary composition for every collection on one community's worklist.
 * This is one batched query rather than one collectionMembers call per card on
 * the community page. A vocabulary other than the community's own is a
 * reference there; the page applies that relative label while this query
 * returns the source namespace and count.
 */
export const communityCollectionVocabularyCounts = async (
  communityId: number
): Promise<CommunityCollectionVocabularyCount[]> =>
  await db
    .select({
      collectionId: communityCollectionsTable.collectionId,
      vocabularySlug: termsTable.vocabularySlug,
      vocabularyTitle: vocabulariesTable.title,
      terms: sql<number>`cast(count(distinct ${termsTable.id}) as int)`
    })
    .from(communityCollectionsTable)
    .innerJoin(
      statementsTable,
      and(
        eq(
          statementsTable.subjectCollectionId,
          communityCollectionsTable.collectionId
        ),
        eq(statementsTable.predicate, "skos:member"),
        isNull(statementsTable.retractedAt)
      )
    )
    .innerJoin(termsTable, eq(termsTable.id, statementsTable.objectTermId))
    .innerJoin(
      vocabulariesTable,
      eq(vocabulariesTable.slug, termsTable.vocabularySlug)
    )
    .where(
      and(
        eq(communityCollectionsTable.communityId, communityId),
        isNull(communityCollectionsTable.removedAt)
      )
    )
    .groupBy(
      communityCollectionsTable.collectionId,
      termsTable.vocabularySlug,
      vocabulariesTable.slug
    )
    .orderBy(
      asc(communityCollectionsTable.collectionId),
      asc(sql`lower(btrim(${vocabulariesTable.title}))`)
    )

export type RelatedConcept = { id: number; slug: string; label: string }

/*
 * The concepts immediately above and below one concept. Only skos:broader is
 * stored; narrower is the same rows read from the other end. Both ends stay
 * inside one scheme, which drizzle/invariants.sql enforces, so the caller
 * already knows the scheme slug.
 */
export const conceptRelations = async (conceptId: number) => {
  const related = async (
    fromColumn: AnyPgColumn,
    toColumn: AnyPgColumn
  ): Promise<RelatedConcept[]> =>
    await db
      .select({
        id: conceptsTable.id,
        slug: conceptsTable.slug,
        label: conceptsTable.prefLabel
      })
      .from(statementsTable)
      .innerJoin(conceptsTable, eq(conceptsTable.id, toColumn))
      .where(
        and(
          eq(statementsTable.predicate, "skos:broader"),
          eq(fromColumn, conceptId),
          isNull(statementsTable.retractedAt)
        )
      )
      .orderBy(asc(sql`lower(btrim(${conceptsTable.prefLabel}))`))

  const [broader, narrower] = await Promise.all([
    related(statementsTable.subjectConceptId, statementsTable.objectConceptId),
    related(statementsTable.objectConceptId, statementsTable.subjectConceptId)
  ])

  return { broader, narrower }
}

/*
 * Tags whose meaning may have moved.
 *
 * A tag bridged to a term takes its meaning from that term's definitions, and
 * those definitions keep changing. A statement filed under the tag in one year
 * may therefore not mean what the same tag means in the next, with nothing in
 * the tag itself recording that. Revisions are immutable and dated and carry
 * the size of their own diff, so the question is answerable: has a revision
 * landed, since statements were filed under this tag, that changed the text
 * substantially?
 *
 * This reports rather than decides. A curator reads it and either leaves the
 * tag alone, edits its scope note, or retires it and mints a replacement.
 */
export type TagDrift = {
  conceptId: number
  conceptSlug: string
  conceptLabel: string
  schemeSlug: string
  termSlug: string
  termVocabularySlug: string
  termLabel: string
  linkedAt: string
  filedCount: number
  largestChange: string
  changedAt: string
}

// A revision that rewrote at least this much of the text is worth a look.
export const DRIFT_THRESHOLD = "0.25"

export const tagsWithDrift = async (): Promise<TagDrift[]> => {
  const rows = await db.execute(sql`
    WITH bridge AS (
      SELECT
        s."subjectConceptId" AS concept_id,
        s."objectTermId"     AS term_id,
        min(s."createdAt")   AS linked_at
      FROM ${statementsTable} s
      WHERE s."retractedAt" IS NULL
        AND s.predicate = 'skos:exactMatch'
        AND s."objectTermId" IS NOT NULL
      GROUP BY s."subjectConceptId", s."objectTermId"
    ),
    filed AS (
      SELECT
        s."objectConceptId" AS concept_id,
        count(*)            AS filed_count,
        min(s."createdAt")  AS first_filed
      FROM ${statementsTable} s
      WHERE s."retractedAt" IS NULL
        AND s.predicate = 'dcterms:subject'
      GROUP BY s."objectConceptId"
    )
    SELECT
      c.id                    AS "conceptId",
      c.slug                  AS "conceptSlug",
      c."prefLabel"           AS "conceptLabel",
      cs.slug                 AS "schemeSlug",
      t.slug                  AS "termSlug",
      t."vocabularySlug"      AS "termVocabularySlug",
      t.term                  AS "termLabel",
      bridge.linked_at        AS "linkedAt",
      filed.filed_count       AS "filedCount",
      max(r."changeDelta")    AS "largestChange",
      max(r."createdAt")      AS "changedAt"
    FROM bridge
    JOIN filed ON filed.concept_id = bridge.concept_id
    JOIN ${conceptsTable} c ON c.id = bridge.concept_id
    JOIN ${conceptSchemesTable} cs ON cs.id = c."schemeId"
    JOIN ${termsTable} t ON t.id = bridge.term_id
    JOIN ${definitionsTable} d ON d."termId" = bridge.term_id
    JOIN ${definitionRevisionsTable} r ON r."definitionId" = d.id
    WHERE r."changeDelta" >= ${DRIFT_THRESHOLD}::numeric
      AND r."createdAt" > filed.first_filed
    GROUP BY
      c.id, c.slug, c."prefLabel", cs.slug, t.slug, t."vocabularySlug", t.term,
      bridge.linked_at, filed.filed_count
    ORDER BY max(r."changeDelta") DESC
  `)

  return rows.rows as TagDrift[]
}
