import "server-only"

import {
  collectionsTable,
  conceptSchemesTable,
  conceptsTable,
  db,
  definitionsTable,
  statementsTable,
  termsTable
} from "@yamz/db"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { TOPICS_SCHEME_SLUG, type ConceptRow } from "./kos"

/*
 * Read queries shared by the knowledge-organization pages. A statement is
 * active while retractedAt is null; rows are never deleted, so that is the
 * only liveness test. Counts come from a LEFT JOIN whose predicate and
 * liveness conditions sit in the ON clause: moved into WHERE they would turn
 * the join inner and drop every concept that nothing is filed under.
 */

// A concept is reached at term level in a curated scheme (a facet) and at
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
 * under each. `order` is "seeded" for a curated scheme, where the sequence the
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
  curated: boolean
}

// Curated schemes hold facets. Reading the flag rather than naming `pspp`
// keeps a second facet scheme visible without another edit here.
export const facetSchemes = async (): Promise<SchemeSummary[]> =>
  await db
    .select({
      id: conceptSchemesTable.id,
      slug: conceptSchemesTable.slug,
      title: conceptSchemesTable.title,
      description: conceptSchemesTable.description,
      curated: conceptSchemesTable.curated
    })
    .from(conceptSchemesTable)
    .where(eq(conceptSchemesTable.curated, true))
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
        eq(conceptSchemesTable.curated, true),
        eq(conceptsTable.status, "approved")
      )
    )
    .orderBy(asc(conceptSchemesTable.id), asc(conceptsTable.id))

export const collectionsWithCounts = async () =>
  await db
    .select({
      id: collectionsTable.id,
      slug: collectionsTable.slug,
      title: collectionsTable.title,
      description: collectionsTable.description,
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
    .groupBy(collectionsTable.id)
    .orderBy(asc(sql`lower(btrim(${collectionsTable.title}))`))

// Members drive from the statements table, so the liveness conditions belong
// in WHERE here; there is no outer join to degrade.
export const collectionMembers = async (collectionId: number) =>
  await db
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      definitions: sql<number>`cast(count(${definitionsTable.id}) as int)`
    })
    .from(statementsTable)
    .innerJoin(termsTable, eq(termsTable.id, statementsTable.objectTermId))
    .leftJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
    .where(
      and(
        eq(statementsTable.predicate, "skos:member"),
        eq(statementsTable.subjectCollectionId, collectionId),
        isNull(statementsTable.retractedAt)
      )
    )
    .groupBy(termsTable.id)
    .orderBy(asc(termsTable.term))

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
