/*
 * Database checks for vocabulary ownership, public route safety and exact
 * collection membership. Fixtures are rolled back or explicitly removed.
 */

import assert from "node:assert/strict"
import { and, eq, isNull, sql } from "drizzle-orm"
import {
  lockCollectionMembershipRow,
  reserveCollectionMembership
} from "../lib/collection-membership-lock"
import { DEFAULT_VOCABULARY_SLUG } from "../lib/public-identifiers"
import { retractCollectionTerm } from "./curate-pilot-collections"

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must point at a migrated database")
    process.exit(2)
  }

  const {
    collectionsTable,
    communitiesTable,
    db,
    statementsTable,
    termRouteAliasesTable,
    termsTable,
    usersTable,
    vocabulariesTable,
    vocabularyRootRoutesTable
  } = await import("../drizzle")
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

  class Rollback extends Error {}

  const sqlState = (error: unknown) => {
    const cause = (error as { cause?: { code?: unknown } }).cause
    return String(cause?.code ?? (error as { code?: unknown }).code ?? "")
  }

  const rejectedWith = async (
    tx: Tx,
    code: string,
    run: (savepoint: Tx) => Promise<unknown>,
    label: string
  ) => {
    let error: unknown
    try {
      await tx.transaction(run)
    } catch (caught) {
      error = caught
    }
    assert.ok(error, `${label}: expected the database to reject the write`)
    assert.equal(sqlState(error), code, `${label}: unexpected SQLSTATE`)
  }

  const stamp = `${Date.now().toString(36)}_${process.pid}`
  const communitySlug = `vocab_test_${stamp}`
  const secondVocabularySlug = `vocab_second_${stamp}`
  const mismatchVocabularySlug = `vocab_mismatch_${stamp}`
  const sharedTermSlug = `shared_term_${stamp}`
  const localParentSlug = `local_parent_${stamp}`
  const aliasSourceSlug = `alias_source_${stamp}`
  const unaliasedMoveSlug = `unaliased_move_${stamp}`
  const edgeSubjectSlug = `edge_subject_${stamp}`
  const edgeObjectSlug = `edge_object_${stamp}`

  try {
    await db.transaction(async (tx) => {
      const defaults = await tx
        .select({ slug: vocabulariesTable.slug })
        .from(vocabulariesTable)
        .where(eq(vocabulariesTable.isDefault, true))
      assert.deepEqual(defaults, [{ slug: DEFAULT_VOCABULARY_SLUG }])

      const [user] = await tx
        .insert(usersTable)
        .values({ name: `Vocabulary test ${stamp}` })
        .returning({ id: usersTable.id })

      await tx.insert(vocabulariesTable).values([
        {
          slug: communitySlug,
          title: `Vocabulary test ${stamp}`,
          createdById: user.id
        },
        {
          slug: secondVocabularySlug,
          title: `Second vocabulary test ${stamp}`,
          createdById: user.id
        },
        {
          slug: mismatchVocabularySlug,
          title: `Mismatch vocabulary test ${stamp}`,
          createdById: user.id
        }
      ])
      await tx.insert(communitiesTable).values({
        slug: communitySlug,
        vocabularySlug: communitySlug,
        title: `Vocabulary test ${stamp}`,
        createdById: user.id
      })

      // Identical labels and slugs are distinct concepts when their owning
      // vocabulary differs.
      const insertedTerms = await tx
        .insert(termsTable)
        .values([
          {
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            term: `Shared term ${stamp}`,
            slug: sharedTermSlug
          },
          {
            vocabularySlug: communitySlug,
            term: `Shared term ${stamp}`,
            slug: sharedTermSlug
          },
          {
            vocabularySlug: communitySlug,
            term: `Local parent ${stamp}`,
            slug: localParentSlug
          },
          {
            vocabularySlug: secondVocabularySlug,
            term: `Shared term ${stamp}`,
            slug: sharedTermSlug
          }
        ])
        .returning({
          id: termsTable.id,
          slug: termsTable.slug,
          vocabularySlug: termsTable.vocabularySlug
        })

      const defaultTerm = insertedTerms.find(
        (row) => row.vocabularySlug === DEFAULT_VOCABULARY_SLUG
      )
      const communityTerm = insertedTerms.find(
        (row) =>
          row.vocabularySlug === communitySlug && row.slug === sharedTermSlug
      )
      const localParent = insertedTerms.find(
        (row) =>
          row.vocabularySlug === communitySlug && row.slug === localParentSlug
      )
      assert.ok(defaultTerm && communityTerm && localParent)

      const [exactCollection] = await tx
        .insert(collectionsTable)
        .values({
          slug: `exact_collection_${stamp}`,
          title: `Exact collection ${stamp}`,
          createdById: user.id
        })
        .returning({ id: collectionsTable.id })
      const exactMemberships = await tx
        .insert(statementsTable)
        .values([
          {
            predicate: "skos:member",
            subjectCollectionId: exactCollection.id,
            objectTermId: communityTerm.id,
            assertedById: user.id
          },
          {
            predicate: "skos:member",
            subjectCollectionId: exactCollection.id,
            objectTermId: localParent.id,
            assertedById: user.id
          }
        ])
        .returning({
          id: statementsTable.id,
          termId: statementsTable.objectTermId
        })
      const omittedMembership = exactMemberships.find(
        (row) => row.termId === localParent.id
      )
      assert.ok(omittedMembership)
      assert.equal(
        await retractCollectionTerm(tx, {
          statementId: omittedMembership.id,
          collectionId: exactCollection.id,
          termId: localParent.id,
          operatorId: user.id
        }),
        true
      )
      assert.equal(
        await retractCollectionTerm(tx, {
          statementId: omittedMembership.id,
          collectionId: exactCollection.id,
          termId: localParent.id,
          operatorId: user.id
        }),
        false,
        "an exact retry cannot overwrite the first retraction provenance"
      )
      const exactHistory = await tx
        .select({
          termId: statementsTable.objectTermId,
          retractedAt: statementsTable.retractedAt,
          retractedById: statementsTable.retractedById
        })
        .from(statementsTable)
        .where(eq(statementsTable.subjectCollectionId, exactCollection.id))
      assert.equal(exactHistory.length, 2, "exact mode preserves ledger rows")
      assert.deepEqual(
        exactHistory.find((row) => row.termId === communityTerm.id),
        {
          termId: communityTerm.id,
          retractedAt: null,
          retractedById: null
        },
        "the desired membership stays live"
      )
      const omittedHistory = exactHistory.find(
        (row) => row.termId === localParent.id
      )
      assert.ok(omittedHistory?.retractedAt)
      assert.equal(omittedHistory.retractedById, user.id)

      const [retiringCollection] = await tx
        .insert(collectionsTable)
        .values({
          slug: `retiring_collection_${stamp}`,
          title: `Retiring collection ${stamp}`,
          createdById: user.id
        })
        .returning({ id: collectionsTable.id })
      const [retiringMembership] = await tx
        .insert(statementsTable)
        .values({
          predicate: "skos:member",
          subjectCollectionId: retiringCollection.id,
          objectTermId: communityTerm.id,
          assertedById: user.id
        })
        .returning({ id: statementsTable.id })
      await tx
        .update(collectionsTable)
        .set({ retiredAt: sql`now()` })
        .where(eq(collectionsTable.id, retiringCollection.id))

      const retiredMembershipViolations = async () => {
        const result = await tx.execute(sql`
          SELECT count(*)::int AS count
          FROM ${statementsTable} statement
          JOIN ${collectionsTable} collection
            ON collection.id = statement."subjectCollectionId"
          WHERE statement.predicate = 'skos:member'
            AND statement."retractedAt" IS NULL
            AND collection."retiredAt" IS NOT NULL
        `)
        return Number(result.rows[0]?.count ?? 0)
      }
      assert.equal(
        await retiredMembershipViolations(),
        1,
        "the invariant detects active membership on a retired collection"
      )
      assert.equal(
        await retractCollectionTerm(tx, {
          statementId: retiringMembership.id,
          collectionId: retiringCollection.id,
          termId: communityTerm.id,
          operatorId: user.id
        }),
        true
      )
      assert.equal(
        await retiredMembershipViolations(),
        0,
        "ledger retraction restores the retired collection invariant"
      )

      const routeOwners = await tx
        .select()
        .from(vocabularyRootRoutesTable)
        .where(
          // Every created vocabulary and the one default term allocate their
          // shared root route. Community-owned terms do not.
          sql`${vocabularyRootRoutesTable.slug} IN (${communitySlug}, ${secondVocabularySlug}, ${mismatchVocabularySlug}, ${sharedTermSlug})`
        )
      assert.deepEqual(
        routeOwners.map((row) => `${row.slug}:${row.ownerKind}`).sort(),
        [
          `${communitySlug}:vocabulary`,
          `${mismatchVocabularySlug}:vocabulary`,
          `${secondVocabularySlug}:vocabulary`,
          `${sharedTermSlug}:default_term`
        ].sort()
      )

      await tx.insert(statementsTable).values({
        predicate: "skos:broader",
        subjectTermId: communityTerm.id,
        objectTermId: localParent.id,
        assertedById: user.id
      })

      await rejectedWith(
        tx,
        "23514",
        (sp) =>
          sp.insert(statementsTable).values({
            predicate: "skos:broader",
            subjectTermId: communityTerm.id,
            objectTermId: defaultTerm.id,
            assertedById: user.id
          }),
        "term hierarchy relations stay inside one vocabulary"
      )

      await rejectedWith(
        tx,
        "23505",
        (sp) =>
          sp.insert(termsTable).values({
            vocabularySlug: communitySlug,
            term: `  SHARED TERM ${stamp}  `,
            slug: `other_${stamp}`
          }),
        "normalized labels are unique within a vocabulary"
      )

      await rejectedWith(
        tx,
        "23514",
        (sp) =>
          sp.insert(termsTable).values({
            vocabularySlug: communitySlug,
            term: `Reserved route ${stamp}`,
            slug: "definitions"
          }),
        "community term route keyword"
      )

      await rejectedWith(
        tx,
        "23514",
        (sp) =>
          sp.insert(communitiesTable).values({
            slug: `wrong_${stamp}`,
            vocabularySlug: mismatchVocabularySlug,
            title: `Wrong namespace ${stamp}`,
            createdById: user.id
          }),
        "community and vocabulary slugs must match"
      )

      await rejectedWith(
        tx,
        "23505",
        (sp) =>
          sp.insert(vocabulariesTable).values({
            slug: sharedTermSlug,
            title: `Route collision ${stamp}`
          }),
        "a vocabulary cannot shadow a default term"
      )

      await rejectedWith(
        tx,
        "23505",
        (sp) =>
          sp.insert(termsTable).values({
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            term: `Vocabulary route collision ${stamp}`,
            slug: secondVocabularySlug
          }),
        "a default term cannot shadow a vocabulary"
      )

      const [movedTerm] = await tx
        .insert(termsTable)
        .values({
          vocabularySlug: DEFAULT_VOCABULARY_SLUG,
          term: `Alias source ${stamp}`,
          slug: aliasSourceSlug
        })
        .returning({ id: termsTable.id })

      await tx
        .update(termsTable)
        .set({ vocabularySlug: secondVocabularySlug })
        .where(eq(termsTable.id, movedTerm.id))
      await tx.insert(termRouteAliasesTable).values({
        vocabularySlug: DEFAULT_VOCABULARY_SLUG,
        termSlug: aliasSourceSlug,
        termId: movedTerm.id,
        createdById: user.id
      })

      // Curation is idempotent: retrying the exact alias does not collide with
      // the permanent default-root reservation created by the first insert.
      await tx
        .insert(termRouteAliasesTable)
        .values({
          vocabularySlug: DEFAULT_VOCABULARY_SLUG,
          termSlug: aliasSourceSlug,
          termId: movedTerm.id,
          createdById: user.id
        })
        .onConflictDoNothing()

      await rejectedWith(
        tx,
        "23505",
        (sp) =>
          sp
            .insert(termRouteAliasesTable)
            .values({
              vocabularySlug: DEFAULT_VOCABULARY_SLUG,
              termSlug: aliasSourceSlug,
              termId: communityTerm.id,
              createdById: user.id
            })
            .onConflictDoNothing(),
        "an idempotent alias retry cannot hide a different target"
      )

      const [aliasLookup] = await tx
        .select({
          termId: termRouteAliasesTable.termId,
          currentVocabulary: termsTable.vocabularySlug,
          currentSlug: termsTable.slug
        })
        .from(termRouteAliasesTable)
        .innerJoin(termsTable, eq(termsTable.id, termRouteAliasesTable.termId))
        .where(
          and(
            eq(termRouteAliasesTable.vocabularySlug, DEFAULT_VOCABULARY_SLUG),
            eq(termRouteAliasesTable.termSlug, aliasSourceSlug)
          )
        )
      assert.deepEqual(aliasLookup, {
        termId: movedTerm.id,
        currentVocabulary: secondVocabularySlug,
        currentSlug: aliasSourceSlug
      })

      const [aliasRoot] = await tx
        .select({ ownerKind: vocabularyRootRoutesTable.ownerKind })
        .from(vocabularyRootRoutesTable)
        .where(eq(vocabularyRootRoutesTable.slug, aliasSourceSlug))
      assert.deepEqual(aliasRoot, { ownerKind: "default_alias" })

      await rejectedWith(
        tx,
        "23505",
        (sp) =>
          sp.insert(termsTable).values({
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            term: `Alias route collision ${stamp}`,
            slug: aliasSourceSlug
          }),
        "a canonical term cannot shadow a permanent alias"
      )

      await rejectedWith(
        tx,
        "23505",
        (sp) =>
          sp.insert(vocabulariesTable).values({
            slug: aliasSourceSlug,
            title: `Alias root collision ${stamp}`
          }),
        "a vocabulary cannot shadow a default term alias"
      )

      await rejectedWith(
        tx,
        "23505",
        (sp) =>
          sp.insert(termRouteAliasesTable).values({
            vocabularySlug: secondVocabularySlug,
            termSlug: aliasSourceSlug,
            termId: movedTerm.id,
            createdById: user.id
          }),
        "an alias cannot repeat a canonical term route"
      )

      await rejectedWith(
        tx,
        "23514",
        (sp) =>
          sp.insert(termRouteAliasesTable).values({
            vocabularySlug: communitySlug,
            termSlug: "definitions",
            termId: movedTerm.id,
            createdById: user.id
          }),
        "community alias route keyword"
      )

      await rejectedWith(
        tx,
        "55000",
        (sp) =>
          sp
            .update(termRouteAliasesTable)
            .set({ termSlug: `changed_${stamp}` })
            .where(
              and(
                eq(
                  termRouteAliasesTable.vocabularySlug,
                  DEFAULT_VOCABULARY_SLUG
                ),
                eq(termRouteAliasesTable.termSlug, aliasSourceSlug)
              )
            ),
        "published aliases are immutable"
      )

      await rejectedWith(
        tx,
        "23514",
        async (sp) => {
          const [unaliased] = await sp
            .insert(termsTable)
            .values({
              vocabularySlug: communitySlug,
              term: `Unaliased move ${stamp}`,
              slug: unaliasedMoveSlug
            })
            .returning({ id: termsTable.id })
          await sp
            .update(termsTable)
            .set({ vocabularySlug: secondVocabularySlug })
            .where(eq(termsTable.id, unaliased.id))
          await sp.execute(
            sql.raw("SET CONSTRAINTS terms_route_move_requires_alias IMMEDIATE")
          )
        },
        "a term route move requires its old-route alias"
      )

      const edgeTerms = await tx
        .insert(termsTable)
        .values([
          {
            vocabularySlug: communitySlug,
            term: `Edge subject ${stamp}`,
            slug: edgeSubjectSlug
          },
          {
            vocabularySlug: communitySlug,
            term: `Edge object ${stamp}`,
            slug: edgeObjectSlug
          }
        ])
        .returning({ id: termsTable.id, slug: termsTable.slug })
      const edgeSubject = edgeTerms.find(
        (term) => term.slug === edgeSubjectSlug
      )
      const edgeObject = edgeTerms.find((term) => term.slug === edgeObjectSlug)
      assert.ok(edgeSubject && edgeObject)
      await tx.insert(statementsTable).values({
        predicate: "skos:broader",
        subjectTermId: edgeSubject.id,
        objectTermId: edgeObject.id,
        assertedById: user.id
      })

      await rejectedWith(
        tx,
        "23514",
        async (sp) => {
          await sp
            .update(termsTable)
            .set({ vocabularySlug: secondVocabularySlug })
            .where(eq(termsTable.id, edgeSubject.id))
          await sp.insert(termRouteAliasesTable).values({
            vocabularySlug: communitySlug,
            termSlug: edgeSubject.slug,
            termId: edgeSubject.id,
            createdById: user.id
          })
          await sp.execute(
            sql.raw(
              "SET CONSTRAINTS terms_move_relations_same_vocabulary IMMEDIATE"
            )
          )
        },
        "a term move cannot strand an active cross-vocabulary relation"
      )

      // Exercise the deferred success path before the fixture rolls back.
      await tx.execute(sql.raw("SET CONSTRAINTS ALL IMMEDIATE"))

      await tx.delete(termsTable).where(eq(termsTable.id, defaultTerm.id))
      const released = await tx
        .select({ slug: vocabularyRootRoutesTable.slug })
        .from(vocabularyRootRoutesTable)
        .where(eq(vocabularyRootRoutesTable.slug, sharedTermSlug))
      assert.deepEqual(
        released,
        [],
        "deleting a default term releases its route"
      )

      await tx.insert(vocabulariesTable).values({
        slug: sharedTermSlug,
        title: `Released route ${stamp}`,
        createdById: user.id
      })

      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }

  // Interactive edits and exact curation share one membership lock. Two
  // concurrent retractions serialize, so exactly one actor owns the immutable
  // provenance and the loser observes that no active assertion remains.
  const concurrentTermSlug = `membership_race_term_${stamp}`
  const concurrentCollectionSlug = `membership_race_collection_${stamp}`
  const concurrentFixture = await db.transaction(async (tx) => {
    const actors = await tx
      .insert(usersTable)
      .values([
        { name: `Membership actor A ${stamp}` },
        { name: `Membership actor B ${stamp}` }
      ])
      .returning({ id: usersTable.id })
    const [term] = await tx
      .insert(termsTable)
      .values({
        vocabularySlug: DEFAULT_VOCABULARY_SLUG,
        term: `Membership race term ${stamp}`,
        slug: concurrentTermSlug
      })
      .returning({ id: termsTable.id })
    const [collection] = await tx
      .insert(collectionsTable)
      .values({
        slug: concurrentCollectionSlug,
        title: `Membership race collection ${stamp}`,
        createdById: actors[0].id
      })
      .returning({ id: collectionsTable.id })
    const [membership] = await tx
      .insert(statementsTable)
      .values({
        predicate: "skos:member",
        subjectCollectionId: collection.id,
        objectTermId: term.id,
        assertedById: actors[0].id
      })
      .returning({ id: statementsTable.id })
    return { actors, collection, membership, term }
  })

  let concurrentRetractions: boolean[] = []
  try {
    concurrentRetractions = await Promise.all(
      concurrentFixture.actors.map((actor) =>
        db.transaction(async (tx) => {
          await reserveCollectionMembership(tx, concurrentFixture.collection.id)
          const collection = await lockCollectionMembershipRow(
            tx,
            concurrentFixture.collection.id
          )
          assert.ok(collection && !collection.retiredAt)
          const [active] = await tx
            .select({ id: statementsTable.id })
            .from(statementsTable)
            .where(
              and(
                eq(statementsTable.id, concurrentFixture.membership.id),
                isNull(statementsTable.retractedAt)
              )
            )
            .limit(1)
          if (!active) return false
          return retractCollectionTerm(tx, {
            statementId: active.id,
            collectionId: concurrentFixture.collection.id,
            termId: concurrentFixture.term.id,
            operatorId: actor.id
          })
        })
      )
    )

    assert.equal(
      concurrentRetractions.filter(Boolean).length,
      1,
      "one concurrent retraction records the act"
    )
    const [history] = await db
      .select({
        retractedAt: statementsTable.retractedAt,
        retractedById: statementsTable.retractedById
      })
      .from(statementsTable)
      .where(eq(statementsTable.id, concurrentFixture.membership.id))
    assert.ok(history.retractedAt)
    assert.ok(
      concurrentFixture.actors.some(
        (actor) => actor.id === history.retractedById
      ),
      "the winning actor keeps the retraction provenance"
    )
  } finally {
    await db.transaction(async (tx) => {
      await tx
        .delete(statementsTable)
        .where(eq(statementsTable.id, concurrentFixture.membership.id))
      await tx
        .delete(collectionsTable)
        .where(eq(collectionsTable.id, concurrentFixture.collection.id))
      await tx
        .delete(termsTable)
        .where(eq(termsTable.id, concurrentFixture.term.id))
      for (const actor of concurrentFixture.actors)
        await tx.delete(usersTable).where(eq(usersTable.id, actor.id))
    })
  }

  // The two owners can be allocated from separate requests at the same time.
  // Exactly one may commit; the shared route primary key serializes the race.
  const raceSlug = `vocab_race_${stamp}`
  let raceResults: PromiseSettledResult<unknown>[] = []
  try {
    raceResults = await Promise.allSettled([
      db.transaction((tx) =>
        tx.insert(vocabulariesTable).values({
          slug: raceSlug,
          title: `Vocabulary race ${stamp}`
        })
      ),
      db.transaction((tx) =>
        tx.insert(termsTable).values({
          vocabularySlug: DEFAULT_VOCABULARY_SLUG,
          term: `Vocabulary race ${stamp}`,
          slug: raceSlug
        })
      )
    ])
  } finally {
    await db.transaction(async (tx) => {
      await tx
        .delete(termsTable)
        .where(
          and(
            eq(termsTable.vocabularySlug, DEFAULT_VOCABULARY_SLUG),
            eq(termsTable.slug, raceSlug)
          )
        )
      await tx
        .delete(vocabulariesTable)
        .where(eq(vocabulariesTable.slug, raceSlug))
    })
  }

  assert.equal(
    raceResults.filter((result) => result.status === "fulfilled").length,
    1,
    "a default term and vocabulary cannot both claim one root route"
  )
  assert.equal(
    raceResults.filter((result) => result.status === "rejected").length,
    1,
    "one concurrent route claimant must be rejected"
  )
  const rejectedRace = raceResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  )
  assert.ok(rejectedRace)
  assert.ok(
    ["23505", "23514"].includes(sqlState(rejectedRace.reason)),
    "the route race must fail as a uniqueness or collision violation"
  )

  const leakedRaceRoute = await db
    .select({ slug: vocabularyRootRoutesTable.slug })
    .from(vocabularyRootRoutesTable)
    .where(eq(vocabularyRootRoutesTable.slug, raceSlug))
  assert.deepEqual(leakedRaceRoute, [])

  console.log("Vocabulary database tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
