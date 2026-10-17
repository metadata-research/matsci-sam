/*
 * Search contract checks. Fixtures span two vocabularies and are rolled back:
 * term search stays global, definition search requires direct evidence, and
 * PSPP facet selections narrow matching terms with OR semantics. Type-ahead
 * preserves short prefixes, vocabulary identities, and discovery visibility.
 */

import assert from "node:assert/strict"
import { and, eq, inArray } from "drizzle-orm"
import "dotenv/config"
import { DEFAULT_VOCABULARY_SLUG } from "../lib/public-identifiers"

class Rollback extends Error {}

const highlightedText = (parts: { text: string; highlighted: boolean }[]) =>
  parts.filter((part) => part.highlighted).map((part) => part.text)

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must point at a migrated database")
    process.exit(2)
  }

  const {
    conceptSchemesTable,
    conceptsTable,
    db,
    definitionsTable,
    statementsTable,
    termsTable,
    usersTable,
    vocabulariesTable
  } = await import("../drizzle")
  const { createDefinitionWithInitialRevision } = await import(
    "../lib/definition-revisions"
  )
  const {
    definitionMatchHeadline,
    definitionMatchSource,
    definitionSearchMatch,
    facetTermScope,
    searchMatch,
    termFacets,
    termMatchHeadlineGrouped,
    termMatchSourceGrouped
  } = await import("../lib/search")
  const { parseSearchHeadline } = await import("../lib/search-evidence")
  const { listedTermId, termIsListed } = await import("../lib/term-visibility")
  const { lookupTerms } = await import("../lib/term-lookup")

  const stamp = Date.now().toString(36)
  const bodyQuery = `chromafluxneedle${stamp}`
  const exampleQuery = `exampleglowneedle${stamp}`
  const secondaryVocabularySlug = `search-test-${stamp}`

  try {
    await db.transaction(async (tx) => {
      const [authorA, authorB] = await tx
        .insert(usersTable)
        .values([
          { name: `Search test A ${stamp}` },
          { name: `Search test B ${stamp}` }
        ])
        .returning({ id: usersTable.id })

      await tx.insert(vocabulariesTable).values({
        slug: secondaryVocabularySlug,
        title: `Search test vocabulary ${stamp}`,
        createdById: authorA.id
      })

      const [termA, termB, termC] = await tx
        .insert(termsTable)
        .values([
          {
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            term: `Search fixture alpha ${stamp}`,
            slug: `search_fixture_alpha_${stamp}`
          },
          {
            vocabularySlug: secondaryVocabularySlug,
            term: `Search fixture beta ${stamp}`,
            slug: `search_fixture_beta_${stamp}`
          },
          {
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            term: `Search fixture example ${stamp}`,
            slug: `search_fixture_example_${stamp}`
          }
        ])
        .returning({ id: termsTable.id })

      const { definition: directA } = await createDefinitionWithInitialRevision(
        tx,
        {
          termId: termA.id,
          authorId: authorA.id,
          definition: `A fixture containing ${bodyQuery} in its own text.`,
          example: "",
          changeNote: "search fixture",
          source: "initial"
        }
      )
      const { definition: siblingA } =
        await createDefinitionWithInitialRevision(tx, {
          termId: termA.id,
          authorId: authorB.id,
          definition: "A sibling definition without the searched signal.",
          example: "",
          changeNote: "search fixture",
          source: "initial"
        })
      const { definition: directB } = await createDefinitionWithInitialRevision(
        tx,
        {
          termId: termB.id,
          authorId: authorA.id,
          definition: `A second fixture containing ${bodyQuery}.`,
          example: "",
          changeNote: "search fixture",
          source: "initial"
        }
      )
      const { definition: exampleDefinition } =
        await createDefinitionWithInitialRevision(tx, {
          termId: termC.id,
          authorId: authorA.id,
          definition: "A definition whose search signal appears only below.",
          example: `A featured example containing ${exampleQuery}.`,
          changeNote: "search fixture",
          source: "initial"
        })

      const fixtureTermIds = [termA.id, termB.id]
      const termMatches = await tx
        .select({
          id: termsTable.id,
          source: termMatchSourceGrouped(bodyQuery),
          headline: termMatchHeadlineGrouped(bodyQuery)
        })
        .from(termsTable)
        .innerJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
        .where(
          and(inArray(termsTable.id, fixtureTermIds), searchMatch(bodyQuery))
        )
        .groupBy(termsTable.id)

      assert.deepEqual(
        termMatches.map((row) => row.id).sort((a, b) => a - b),
        [...fixtureTermIds].sort((a, b) => a - b),
        "term search crosses vocabulary namespaces"
      )
      assert.ok(
        termMatches.every((row) => row.source === "definition"),
        "term results identify definition evidence"
      )
      assert.ok(
        termMatches.every((row) =>
          highlightedText(parseSearchHeadline(row.headline)).some(
            (text) => text.toLowerCase() === bodyQuery
          )
        ),
        "term evidence headlines mark the matching lexeme"
      )

      const lookupByDefinition = await lookupTerms({ query: bodyQuery }, tx)
      assert.deepEqual(
        lookupByDefinition.map((row) => row.id).sort((a, b) => a - b),
        [...fixtureTermIds].sort((a, b) => a - b),
        "type-ahead retains matching definitions across vocabulary namespaces"
      )

      const sharedLabel = `Qxylometallographic characterization ${stamp}`
      const [exact, prefixA, prefixB, hiddenPrefix, undefinedPrefix] = await tx
        .insert(termsTable)
        .values([
          {
            vocabularySlug: secondaryVocabularySlug,
            term: "Qx",
            slug: `lookup_exact_${stamp}`
          },
          {
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            term: sharedLabel,
            slug: `lookup_prefix_${stamp}`
          },
          {
            vocabularySlug: secondaryVocabularySlug,
            term: sharedLabel,
            slug: `lookup_prefix_${stamp}`
          },
          {
            vocabularySlug: secondaryVocabularySlug,
            term: `Qx hidden fixture ${stamp}`,
            slug: `lookup_hidden_${stamp}`,
            hiddenAt: new Date().toISOString(),
            hiddenById: authorA.id,
            hiddenReason: "Hidden type-ahead fixture"
          },
          {
            vocabularySlug: secondaryVocabularySlug,
            term: `Qx undefined fixture ${stamp}`,
            slug: `lookup_undefined_${stamp}`
          }
        ])
        .returning({ id: termsTable.id })

      for (const term of [exact, prefixA, prefixB, hiddenPrefix]) {
        await createDefinitionWithInitialRevision(tx, {
          termId: term.id,
          authorId: authorA.id,
          definition: "A definition for the type-ahead contract fixture.",
          example: "",
          changeNote: "search fixture",
          source: "initial"
        })
      }

      const prefixFixtures = [
        exact.id,
        prefixA.id,
        prefixB.id,
        hiddenPrefix.id,
        undefinedPrefix.id
      ]
      const prefixMatches = await lookupTerms({ query: " QX ", limit: 100 }, tx)
      assert.deepEqual(
        prefixMatches
          .filter((term) => prefixFixtures.includes(term.id))
          .map((term) => term.id)
          .sort((a, b) => a - b),
        [exact.id, prefixA.id, prefixB.id].sort((a, b) => a - b),
        "short prefixes are case-insensitive and exclude hidden or undefined terms"
      )
      assert.deepEqual(
        prefixMatches
          .filter((term) => term.term === sharedLabel)
          .map((term) => term.vocabularySlug)
          .sort(),
        [DEFAULT_VOCABULARY_SLUG, secondaryVocabularySlug].sort(),
        "identical labels remain separate suggestions with vocabulary identity"
      )
      assert.ok(
        prefixMatches
          .filter((term) => term.term === sharedLabel)
          .every((term) => term.vocabularyTitle && term.count === 1),
        "suggestions include vocabulary titles and definition counts"
      )
      assert.deepEqual(
        (await lookupTerms({ query: "qx", limit: 1 }, tx)).map(
          (term) => term.id
        ),
        [exact.id],
        "exact matches rank before prefixes and the requested limit is applied"
      )

      const definitionMatches = await tx
        .select({
          id: definitionsTable.id,
          source: definitionMatchSource(bodyQuery),
          headline: definitionMatchHeadline(bodyQuery)
        })
        .from(termsTable)
        .innerJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
        .where(
          and(
            inArray(definitionsTable.id, [directA.id, siblingA.id, directB.id]),
            definitionSearchMatch(bodyQuery)
          )
        )

      assert.deepEqual(
        definitionMatches.map((row) => row.id).sort((a, b) => a - b),
        [directA.id, directB.id].sort((a, b) => a - b),
        "a body hit does not admit a sibling definition without evidence"
      )
      assert.ok(
        definitionMatches.every((row) => row.source === "definition"),
        "direct body matches identify their evidence source"
      )
      assert.ok(
        definitionMatches.every((row) =>
          highlightedText(parseSearchHeadline(row.headline)).some(
            (text) => text.toLowerCase() === bodyQuery
          )
        ),
        "definition evidence headlines mark the matching lexeme"
      )

      const [exampleMatch] = await tx
        .select({
          id: definitionsTable.id,
          source: definitionMatchSource(exampleQuery),
          headline: definitionMatchHeadline(exampleQuery)
        })
        .from(termsTable)
        .innerJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
        .where(
          and(
            eq(definitionsTable.id, exampleDefinition.id),
            definitionSearchMatch(exampleQuery)
          )
        )
      assert.equal(exampleMatch.id, exampleDefinition.id)
      assert.equal(exampleMatch.source, "example")
      assert.ok(
        highlightedText(parseSearchHeadline(exampleMatch.headline)).some(
          (text) => text.toLowerCase() === exampleQuery
        ),
        "featured-example evidence is highlighted"
      )

      const [pspp] = await tx
        .select({ id: conceptSchemesTable.id })
        .from(conceptSchemesTable)
        .where(eq(conceptSchemesTable.slug, "pspp"))
      assert.ok(pspp, "PSPP scheme is seeded")
      const psppConcepts = await tx
        .select({ id: conceptsTable.id, slug: conceptsTable.slug })
        .from(conceptsTable)
        .where(eq(conceptsTable.schemeId, pspp.id))
      const processing = psppConcepts.find(
        (concept) => concept.slug === "processing"
      )
      const properties = psppConcepts.find(
        (concept) => concept.slug === "properties"
      )
      assert.ok(processing && properties, "PSPP facets are seeded")

      await tx.insert(statementsTable).values([
        {
          predicate: "dcterms:subject",
          subjectTermId: termA.id,
          objectConceptId: processing.id,
          assertedById: authorA.id
        },
        {
          predicate: "dcterms:subject",
          subjectTermId: termB.id,
          objectConceptId: properties.id,
          assertedById: authorA.id
        }
      ])

      const facetedA = await tx
        .select({ id: termsTable.id })
        .from(termsTable)
        .where(
          and(
            inArray(termsTable.id, fixtureTermIds),
            searchMatch(bodyQuery),
            facetTermScope(["pspp:processing"])
          )
        )
      assert.deepEqual(
        facetedA.map((row) => row.id),
        [termA.id]
      )

      const facetedEither = await tx
        .select({ id: termsTable.id })
        .from(termsTable)
        .where(
          and(
            inArray(termsTable.id, fixtureTermIds),
            searchMatch(bodyQuery),
            facetTermScope(["pspp:processing", "pspp:properties"])
          )
        )
      assert.deepEqual(
        facetedEither.map((row) => row.id).sort((a, b) => a - b),
        [...fixtureTermIds].sort((a, b) => a - b),
        "multiple selected PSPP concepts use OR semantics"
      )

      const facetPayload = await tx
        .select({ facets: termFacets().as("facets") })
        .from(termsTable)
        .where(eq(termsTable.id, termA.id))
      assert.deepEqual(
        facetPayload[0]?.facets.map((facet) => facet.key),
        ["pspp:processing"],
        "term results expose active PSPP facet metadata"
      )

      await tx
        .update(termsTable)
        .set({
          hiddenAt: new Date().toISOString(),
          hiddenById: authorA.id,
          hiddenReason: "Reviewed search test fixture"
        })
        .where(eq(termsTable.id, termB.id))

      const listedMatches = () =>
        tx
          .select({ id: termsTable.id })
          .from(termsTable)
          .where(
            and(
              inArray(termsTable.id, fixtureTermIds),
              searchMatch(bodyQuery),
              termIsListed()
            )
          )

      assert.deepEqual(
        (await listedMatches()).map((row) => row.id),
        [termA.id],
        "discovery excludes a hidden term even when its definition matches"
      )
      const listedDefinitions = await tx
        .select({ id: definitionsTable.id })
        .from(definitionsTable)
        .where(
          and(
            inArray(definitionsTable.id, [directA.id, directB.id]),
            listedTermId(definitionsTable.termId)
          )
        )
      assert.deepEqual(
        listedDefinitions.map((row) => row.id),
        [directA.id],
        "listing a definition by term ID follows the same visibility predicate"
      )
      assert.ok(
        await tx.query.termsTable.findFirst({
          where: eq(termsTable.id, termB.id)
        }),
        "direct identity lookup retains the hidden term"
      )
      await tx
        .update(termsTable)
        .set({ hiddenAt: null, hiddenById: null, hiddenReason: null })
        .where(eq(termsTable.id, termB.id))
      assert.deepEqual(
        (await listedMatches()).map((row) => row.id).sort((a, b) => a - b),
        [...fixtureTermIds].sort((a, b) => a - b),
        "restoring discovery returns the same term identities"
      )

      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }

  console.log("Search database tests passed")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
