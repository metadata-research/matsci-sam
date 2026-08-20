/*
 * Export the facets a person assigned, as a fixture for evaluating automatic
 * classification later.
 *
 * The ledger records who asserted each statement, so human and machine
 * judgements are separable without reconstruction. Only assertions made by a
 * human identity are exported: scoring a model against another model's
 * assignments measures agreement between models, not correctness.
 *
 *   DATABASE_URL=... pnpm facets:export > fixtures/facets.json
 *
 * Rows carry the asserter and the time so a later reader can tell how the
 * ground truth was built, and so a fixture can be regenerated and compared.
 */

import { and, eq, isNull } from "drizzle-orm"

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must point at a migrated database")
    process.exit(2)
  }

  const {
    conceptSchemesTable,
    conceptsTable,
    db,
    statementsTable,
    termsTable,
    usersTable
  } = await import("../drizzle")

  const rows = await db
    .select({
      termSlug: termsTable.slug,
      termLabel: termsTable.term,
      facetSlug: conceptsTable.slug,
      facetLabel: conceptsTable.prefLabel,
      schemeSlug: conceptSchemesTable.slug,
      assertedAt: statementsTable.createdAt,
      asserterId: usersTable.id,
      asserterIsAi: usersTable.isAi
    })
    .from(statementsTable)
    .innerJoin(termsTable, eq(termsTable.id, statementsTable.subjectTermId))
    .innerJoin(
      conceptsTable,
      eq(conceptsTable.id, statementsTable.objectConceptId)
    )
    .innerJoin(
      conceptSchemesTable,
      eq(conceptSchemesTable.id, conceptsTable.schemeId)
    )
    .innerJoin(usersTable, eq(usersTable.id, statementsTable.assertedById))
    .where(
      and(
        eq(statementsTable.predicate, "dcterms:subject"),
        isNull(statementsTable.retractedAt),
        eq(conceptSchemesTable.attachesAt, "term"),
        eq(usersTable.isAi, false)
      )
    )
    .orderBy(termsTable.term, conceptsTable.id)

  const byTerm = new Map<
    string,
    {
      term: string
      termLabel: string
      facets: string[]
      assertedBy: number[]
      assertedAt: string[]
    }
  >()
  for (const row of rows) {
    const entry = byTerm.get(row.termSlug) ?? {
      term: row.termSlug,
      termLabel: row.termLabel,
      facets: [],
      assertedBy: [],
      assertedAt: []
    }
    entry.facets.push(`${row.schemeSlug}/${row.facetSlug}`)
    entry.assertedBy.push(row.asserterId)
    entry.assertedAt.push(row.assertedAt)
    byTerm.set(row.termSlug, entry)
  }

  const cases = [...byTerm.values()]
  const asserters = new Set(rows.map((row) => row.asserterId))

  console.log(
    JSON.stringify(
      {
        // Everything a later reader needs to judge what this fixture is.
        generatedAt: new Date().toISOString(),
        source: "human-assigned facets, excluding AI identities",
        termCount: cases.length,
        assignmentCount: rows.length,
        asserterCount: asserters.size,
        cases
      },
      null,
      2
    )
  )

  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
