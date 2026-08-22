/*
 * Database checks for the knowledge-organization ledger. Needs a migrated
 * DATABASE_URL (the CI db-invariants job runs this after db:migrate). Opens
 * one transaction, inserts fixture rows, exercises every CHECK, index and the
 * purge helper through savepoints, and rolls everything back at the end.
 *
 * Together with scripts/test-kos.ts this proves that lib/kos.ts and the
 * statements_predicate_shape CHECK agree on which (predicate, subject kind,
 * object kind) shapes exist.
 */

import assert from "node:assert/strict"
import { and, asc, eq, isNull, sql } from "drizzle-orm"

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must point at a migrated database")
    process.exit(2)
  }

  const {
    collectionsTable,
    commentsTable,
    conceptSchemesTable,
    conceptsTable,
    db,
    definitionsTable,
    statementsTable,
    termsTable,
    usersTable,
    voteEventsTable,
    votesTable
  } = await import("../drizzle")
  const { castVote } = await import("../lib/participation")
  const { createDefinitionWithInitialRevision } = await import(
    "../lib/definition-revisions"
  )
  const { deleteDefinitionRows } = await import("../lib/definition-purge")
  const { PREDICATE_VALUES, predicateAccepts } = await import("../lib/kos")
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
  type SubjectKind = import("../lib/kos").SubjectKind
  type ObjectKind = import("../lib/kos").ObjectKind

  class Rollback extends Error {}

  // Run one statement inside a savepoint and report how the database
  // answered, without losing the outer transaction.
  type Outcome =
    | { ok: true }
    | {
        ok: false
        code: string
        constraint: string | undefined
        message: string
      }
  const attempt = async (
    tx: Tx,
    run: (sp: Tx) => Promise<unknown>
  ): Promise<Outcome> => {
    try {
      await tx.transaction(async (sp) => {
        await run(sp)
      })
      return { ok: true }
    } catch (error) {
      const cause = (error as { cause?: Record<string, unknown> }).cause ?? {}
      const code = String(
        cause.code ?? (error as { code?: unknown }).code ?? ""
      )
      const constraint =
        typeof cause.constraint === "string" ? cause.constraint : undefined
      return { ok: false, code, constraint, message: String(error) }
    }
  }
  const expectRejected = (
    outcome: Outcome,
    code: string,
    constraint: string,
    label: string
  ) => {
    assert.ok(!outcome.ok, `${label}: expected rejection`)
    if (outcome.ok) return
    assert.equal(outcome.code, code, `${label}: SQLSTATE (${outcome.message})`)
    assert.equal(outcome.constraint, constraint, `${label}: constraint`)
  }
  const expectAccepted = (outcome: Outcome, label: string) =>
    assert.ok(outcome.ok, `${label}: ${outcome.ok ? "" : outcome.message}`)

  const stamp = Date.now().toString(36)

  try {
    await db.transaction(async (tx) => {
      // --- Seed from 0029 is present ---

      const schemes = await tx.select().from(conceptSchemesTable)
      const topics = schemes.find((s) => s.slug === "topics")
      const pspp = schemes.find((s) => s.slug === "pspp")
      assert.ok(topics, "topics scheme seeded")
      assert.equal(topics.attachesAt, "definition")
      assert.equal(topics.assertableBy, "contributor")
      assert.equal(topics.bridgeable, true)
      assert.equal(topics.conceptOrder, "label")
      assert.ok(pspp, "pspp scheme seeded")
      assert.equal(pspp.attachesAt, "term")
      assert.equal(pspp.assertableBy, "curator")
      assert.equal(pspp.bridgeable, false)
      assert.equal(pspp.conceptOrder, "seeded")
      const facets = await tx
        .select()
        .from(conceptsTable)
        .where(eq(conceptsTable.schemeId, pspp.id))
      assert.deepEqual(facets.map((f) => f.slug).sort(), [
        "performance",
        "processing",
        "properties",
        "structure"
      ])
      assert.ok(facets.every((f) => f.definition && f.status === "approved"))

      // --- Fixtures ---

      const [user] = await tx
        .insert(usersTable)
        .values({ name: `KOS ledger test ${stamp}` })
        .returning({ id: usersTable.id })
      const [termA, termB, termC] = await tx
        .insert(termsTable)
        .values([
          { term: `kos test a ${stamp}`, slug: `kos_test_a_${stamp}` },
          { term: `kos test b ${stamp}`, slug: `kos_test_b_${stamp}` },
          { term: `kos test c ${stamp}`, slug: `kos_test_c_${stamp}` }
        ])
        .returning({ id: termsTable.id })
      assert.ok(termA.id < termB.id && termB.id < termC.id)
      const { definition } = await createDefinitionWithInitialRevision(tx, {
        termId: termA.id,
        authorId: user.id,
        definition: "A fixture definition for the KOS ledger test.",
        example: "Rolled back at the end.",
        changeNote: "fixture",
        source: "initial"
      })
      const [topicX, topicY] = await tx
        .insert(conceptsTable)
        .values([
          {
            schemeId: topics.id,
            slug: `kos_test_x_${stamp}`,
            prefLabel: `KOS test X ${stamp}`,
            createdById: user.id
          },
          {
            schemeId: topics.id,
            slug: `kos_test_y_${stamp}`,
            prefLabel: `KOS test Y ${stamp}`,
            createdById: user.id
          }
        ])
        .returning({ id: conceptsTable.id })
      assert.ok(topicX.id < topicY.id)
      const [collection] = await tx
        .insert(collectionsTable)
        .values({
          slug: `kos-test-${stamp}`,
          title: `KOS test ${stamp}`,
          createdById: user.id
        })
        .returning({ id: collectionsTable.id })

      const EXTERNAL =
        "https://w3id.org/emmo#EMMO_03441eb3_d1fd_4906_b953_b83312d7589e"

      const subjectFor = (kind: SubjectKind) =>
        ({
          term: { subjectTermId: termA.id },
          definition: { subjectDefinitionId: definition.id },
          concept: { subjectConceptId: topicX.id },
          collection: { subjectCollectionId: collection.id }
        })[kind]
      const objectFor = (kind: ObjectKind) =>
        ({
          term: { objectTermId: termB.id },
          concept: { objectConceptId: topicY.id },
          iri: { objectIri: EXTERNAL }
        })[kind]

      // --- Every (predicate, subject kind, object kind) shape: the CHECK and
      // lib/kos.ts must agree ---

      const subjectKinds: SubjectKind[] = [
        "term",
        "definition",
        "concept",
        "collection"
      ]
      const objectKinds: ObjectKind[] = ["term", "concept", "iri"]
      let shapesChecked = 0
      for (const predicate of PREDICATE_VALUES)
        for (const sk of subjectKinds)
          for (const ok of objectKinds) {
            const outcome = await attempt(tx, (sp) =>
              sp.insert(statementsTable).values({
                predicate,
                ...subjectFor(sk),
                ...objectFor(ok),
                assertedById: user.id
              })
            )
            const label = `${predicate} ${sk} -> ${ok}`
            if (predicateAccepts(predicate, sk, ok))
              expectAccepted(outcome, label)
            else
              expectRejected(
                outcome,
                "23514",
                "statements_predicate_shape",
                label
              )
            shapesChecked++
          }
      assert.equal(shapesChecked, PREDICATE_VALUES.length * 12)
      await tx
        .delete(statementsTable)
        .where(eq(statementsTable.assertedById, user.id))

      // The bridge specifically: a concept may name a term, no other mapping
      // predicate may, and the link is one-to-one in both directions.
      expectAccepted(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "skos:exactMatch",
            subjectConceptId: topicX.id,
            objectTermId: termB.id,
            assertedById: user.id
          })
        ),
        "concept bridged to a term"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "skos:closeMatch",
            subjectConceptId: topicY.id,
            objectTermId: termC.id,
            assertedById: user.id
          })
        ),
        "23514",
        "statements_predicate_shape",
        "closeMatch may not name a term"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "skos:exactMatch",
            subjectConceptId: topicX.id,
            objectTermId: termC.id,
            assertedById: user.id
          })
        ),
        "23505",
        "statements_concept_link_unique",
        "a concept links to one term"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "skos:exactMatch",
            subjectConceptId: topicY.id,
            objectTermId: termB.id,
            assertedById: user.id
          })
        ),
        "23505",
        "statements_term_link_unique",
        "a term is linked from one concept"
      )
      await tx
        .delete(statementsTable)
        .where(eq(statementsTable.predicate, "skos:exactMatch"))

      // --- Exactly one subject, exactly one object ---

      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "dcterms:subject",
            subjectTermId: termA.id,
            subjectDefinitionId: definition.id,
            objectConceptId: topicY.id,
            assertedById: user.id
          })
        ),
        "23514",
        "statements_one_subject",
        "two subjects"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "skos:exactMatch",
            subjectTermId: termA.id,
            objectConceptId: topicY.id,
            objectIri: EXTERNAL,
            assertedById: user.id
          })
        ),
        "23514",
        "statements_one_object",
        "two objects"
      )

      // --- Active-unique: duplicates blocked, re-assert after retraction ---

      const topicOnDefinition = {
        predicate: "dcterms:subject" as const,
        subjectDefinitionId: definition.id,
        objectConceptId: topicX.id,
        assertedById: user.id
      }
      const [first] = await tx
        .insert(statementsTable)
        .values(topicOnDefinition)
        .returning({ id: statementsTable.id, key: statementsTable.key })
      assert.match(first.key, /^[0-9a-f-]{36}$/, "statement key is a uuid")
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values(topicOnDefinition)
        ),
        "23505",
        "statements_active_unique",
        "duplicate active statement"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp
            .update(statementsTable)
            .set({ retractedAt: sql`now()` })
            .where(eq(statementsTable.id, first.id))
        ),
        "23514",
        "statements_retraction_pair",
        "retractedAt without retractedById"
      )
      await tx
        .update(statementsTable)
        .set({ retractedAt: sql`now()`, retractedById: user.id })
        .where(eq(statementsTable.id, first.id))
      expectAccepted(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values(topicOnDefinition)
        ),
        "re-assert after retraction"
      )
      const active = await tx
        .select({ id: statementsTable.id })
        .from(statementsTable)
        .where(
          and(
            eq(statementsTable.subjectDefinitionId, definition.id),
            isNull(statementsTable.retractedAt)
          )
        )
      assert.equal(active.length, 1)

      // --- Asserter or legacy ---

      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "dcterms:subject",
            subjectTermId: termA.id,
            objectConceptId: topicY.id
          })
        ),
        "23514",
        "statements_asserter_or_legacy",
        "no asserter and not legacy"
      )
      expectAccepted(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "dcterms:subject",
            subjectTermId: termA.id,
            objectConceptId: topicY.id,
            migratedLegacy: true
          })
        ),
        "legacy row without asserter"
      )

      // --- skos:related: canonical order, mirror rejected ---

      expectAccepted(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "skos:related",
            subjectConceptId: topicX.id,
            objectConceptId: topicY.id,
            assertedById: user.id
          })
        ),
        "related in canonical order"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "skos:related",
            subjectConceptId: topicY.id,
            objectConceptId: topicX.id,
            assertedById: user.id
          })
        ),
        "23514",
        "statements_symmetric_canonical",
        "related mirror"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "skos:related",
            subjectTermId: termB.id,
            objectTermId: termA.id,
            assertedById: user.id
          })
        ),
        "23514",
        "statements_symmetric_canonical",
        "term related mirror"
      )

      // --- No self relation ---

      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "skos:broader",
            subjectTermId: termA.id,
            objectTermId: termA.id,
            assertedById: user.id
          })
        ),
        "23514",
        "statements_no_self_relation",
        "term broader itself"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "skos:broader",
            subjectConceptId: topicX.id,
            objectConceptId: topicX.id,
            assertedById: user.id
          })
        ),
        "23514",
        "statements_no_self_relation",
        "concept broader itself"
      )

      // --- Object IRI CHECK mirrors lib/kos.ts isAbsoluteHttpIri ---

      const mapping = (objectIri: string) => (sp: Tx) =>
        sp.insert(statementsTable).values({
          predicate: "skos:closeMatch",
          subjectTermId: termC.id,
          objectIri,
          assertedById: user.id
        })
      for (const bad of [
        "https://example.org/a b",
        "https://example.org/a\\b",
        "https://example.org/a\x01b",
        "https://example.org/a\x7fb",
        "https://example.org/a^b",
        "https://example.org/a`b",
        "ftp://example.org/x",
        "example.org/x"
      ])
        expectRejected(
          await attempt(tx, mapping(bad)),
          "23514",
          "statements_object_iri_absolute",
          `IRI ${JSON.stringify(bad)}`
        )
      for (const good of [
        "https://w3id.org/pmd/co/PMD_0000934",
        "http://qudt.org/vocab/quantitykind/GapEnergy",
        "https://example.org/über/straße"
      ])
        expectAccepted(await attempt(tx, mapping(good)), `IRI ${good}`)

      // --- Concepts: label-unique partial index, retirement rules, slugs ---

      const label = `KOS Test Label ${stamp}`
      const [kept] = await tx
        .insert(conceptsTable)
        .values({
          schemeId: topics.id,
          slug: `kos_test_label_${stamp}`,
          prefLabel: label,
          createdById: user.id
        })
        .returning({ id: conceptsTable.id })
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(conceptsTable).values({
            schemeId: topics.id,
            slug: `kos_test_label_2_${stamp}`,
            prefLabel: `  ${label.toLowerCase()} `,
            createdById: user.id
          })
        ),
        "23505",
        "concepts_scheme_label_unique",
        "normalized duplicate label in one scheme"
      )
      expectAccepted(
        await attempt(tx, (sp) =>
          sp.insert(conceptsTable).values({
            schemeId: pspp.id,
            slug: `kos_test_label_${stamp}`,
            prefLabel: label,
            createdById: user.id
          })
        ),
        "same label in another scheme"
      )
      expectAccepted(
        await attempt(tx, (sp) =>
          sp.insert(conceptsTable).values({
            schemeId: topics.id,
            slug: `kos_test_label_2_${stamp}`,
            prefLabel: label.toLowerCase(),
            status: "retired",
            replacedById: kept.id,
            createdById: user.id
          })
        ),
        "retired duplicate keeps its row"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(conceptsTable).values({
            schemeId: topics.id,
            slug: `kos_test_label_3_${stamp}`,
            prefLabel: `Other ${stamp}`,
            replacedById: kept.id,
            createdById: user.id
          })
        ),
        "23514",
        "concepts_replaced_only_when_retired",
        "replacement pointer on a live concept"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp
            .update(conceptsTable)
            .set({ status: "retired", replacedById: kept.id })
            .where(eq(conceptsTable.id, kept.id))
        ),
        "23514",
        "concepts_not_self_replaced",
        "concept replacing itself"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(conceptsTable).values({
            schemeId: topics.id,
            slug: `kos_test_label_${stamp}`,
            prefLabel: `Yet another ${stamp}`,
            createdById: user.id
          })
        ),
        "23505",
        "concepts_scheme_slug_unique",
        "duplicate slug in one scheme"
      )
      for (const bad of ["Bad Slug", "-leading", "_leading", "ünïcode", ""])
        expectRejected(
          await attempt(tx, (sp) =>
            sp.insert(conceptsTable).values({
              schemeId: topics.id,
              slug: bad,
              prefLabel: `Slug ${bad} ${stamp}`,
              createdById: user.id
            })
          ),
          "23514",
          "concepts_slug_shape",
          `concept slug ${JSON.stringify(bad)}`
        )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(conceptsTable).values({
            schemeId: topics.id,
            slug: `kos_blank_${stamp}`,
            prefLabel: "   ",
            createdById: user.id
          })
        ),
        "23514",
        "concepts_label_nonblank",
        "blank label"
      )
      expectAccepted(
        await attempt(tx, (sp) =>
          sp.insert(conceptsTable).values({
            schemeId: topics.id,
            slug: `topic_9${stamp}`,
            prefLabel: `王明 ${stamp}`,
            createdById: user.id
          })
        ),
        "fallback-style slug with a non-ASCII label"
      )

      // --- Scope note ---

      expectAccepted(
        await attempt(tx, (sp) =>
          sp.insert(conceptsTable).values({
            schemeId: topics.id,
            slug: `kos_scope_${stamp}`,
            prefLabel: `KOS scope ${stamp}`,
            scopeNote: "Use for the thing, not the other thing.",
            createdById: user.id
          })
        ),
        "concept with a scope note"
      )

      // --- Scheme and collection slugs ---

      for (const bad of ["123", "0", "Bad", "-x", ""])
        expectRejected(
          await attempt(tx, (sp) =>
            sp.insert(conceptSchemesTable).values({ slug: bad, title: "x" })
          ),
          "23514",
          "concept_schemes_slug_shape",
          `scheme slug ${JSON.stringify(bad)}`
        )
      expectAccepted(
        await attempt(tx, (sp) =>
          sp
            .insert(conceptSchemesTable)
            .values({ slug: `kos-test-9${stamp}`, title: "KOS test scheme" })
        ),
        "scheme slug with digits but not all digits"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(collectionsTable).values({
            slug: "-bad",
            title: "x",
            createdById: user.id
          })
        ),
        "23514",
        "collections_slug_shape",
        "collection slug"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(collectionsTable).values({
            slug: `kos-blank-${stamp}`,
            title: " ",
            createdById: user.id
          })
        ),
        "23514",
        "collections_title_nonblank",
        "collection blank title"
      )

      // --- Purge: definition-level statements go with the definition; the
      // term-level facet on the same term stays ---

      await tx.insert(statementsTable).values({
        predicate: "dcterms:subject",
        subjectTermId: termA.id,
        objectConceptId: facets[0].id,
        assertedById: user.id
      })
      const before = await tx
        .select({ id: statementsTable.id })
        .from(statementsTable)
        .where(eq(statementsTable.subjectDefinitionId, definition.id))
      assert.equal(
        before.length,
        2,
        "one active and one retracted topic before purge"
      )

      const deleted = await deleteDefinitionRows(tx, definition.id)
      assert.equal(deleted?.id, definition.id)
      const after = await tx
        .select({ id: statementsTable.id })
        .from(statementsTable)
        .where(eq(statementsTable.subjectDefinitionId, definition.id))
      assert.equal(after.length, 0, "definition-level statements purged")
      const remainingFacet = await tx
        .select({ id: statementsTable.id })
        .from(statementsTable)
        .where(
          and(
            eq(statementsTable.subjectTermId, termA.id),
            eq(statementsTable.objectConceptId, facets[0].id)
          )
        )
      assert.equal(
        remainingFacet.length,
        1,
        "term-level facet survives the purge"
      )
      const gone = await tx
        .select({ id: definitionsTable.id })
        .from(definitionsTable)
        .where(eq(definitionsTable.id, definition.id))
      assert.equal(gone.length, 0)

      // --- Vote and comment provenance (migration 0040) ---

      const { definition: defB, revision: revB } =
        await createDefinitionWithInitialRevision(tx, {
          termId: termB.id,
          authorId: user.id,
          definition: "A second fixture definition, for the vote record.",
          example: "Rolled back at the end.",
          changeNote: "fixture",
          source: "initial"
        })

      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(commentsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: user.id,
            message: "a human comment must not carry a stamp",
            authorKind: "human",
            model: "gemma4:26b"
          })
        ),
        "23514",
        "comments_human_carries_no_stamp",
        "human comment with a stamp"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(commentsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: user.id,
            message: "a stamp arrives whole or not at all",
            authorKind: "model",
            model: "gemma4:26b",
            promptHash: "abc123"
          })
        ),
        "23514",
        "comments_stamp_pair",
        "stamp hash without text"
      )
      expectAccepted(
        await attempt(tx, (sp) =>
          sp.insert(commentsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: user.id,
            message: "a whole stamp on a model comment",
            authorKind: "model",
            model: "gemma4:26b",
            promptKey: "pilot-persona-comment",
            promptHash: "abc123",
            promptText: "the registered prompt text"
          })
        ),
        "stamped model comment"
      )
      const { definition: defC } = await createDefinitionWithInitialRevision(
        tx,
        {
          termId: termC.id,
          authorId: user.id,
          definition: "A third fixture definition, the wrong FK target.",
          example: "Rolled back at the end.",
          changeNote: "fixture",
          source: "initial"
        }
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(voteEventsTable).values({
            definitionId: defC.id,
            revisionId: revB.id,
            userId: user.id,
            kind: "up",
            actorKind: "human"
          })
        ),
        "23503",
        "vote_events_revision_same_definition_fk",
        "vote event whose revision belongs to another definition"
      )

      // The full act sequence through the one write path: cast, change,
      // withdraw. Three events, in order, and the current-state row is gone
      // while the record of how it got there stays.
      await castVote(tx, {
        definitionId: defB.id,
        revisionId: revB.id,
        userId: user.id,
        vote: "up",
        actorKind: "human",
        communityId: null
      })
      await castVote(tx, {
        definitionId: defB.id,
        revisionId: revB.id,
        userId: user.id,
        vote: "down",
        actorKind: "human",
        communityId: null
      })
      const [afterWithdrawal] = await castVote(tx, {
        definitionId: defB.id,
        revisionId: revB.id,
        userId: user.id,
        vote: "down",
        actorKind: "human",
        communityId: null
      })
      assert.equal(afterWithdrawal.score, 0, "score returns to zero")
      const actRecord = await tx
        .select({ kind: voteEventsTable.kind })
        .from(voteEventsTable)
        .where(eq(voteEventsTable.revisionId, revB.id))
        .orderBy(asc(voteEventsTable.id))
      assert.deepEqual(
        actRecord.map((event) => event.kind),
        ["up", "down", null],
        "cast, change, withdrawal recorded in order"
      )
      const standing = await tx
        .select({ kind: votesTable.kind })
        .from(votesTable)
        .where(eq(votesTable.revisionId, revB.id))
      assert.equal(standing.length, 0, "withdrawal removes the standing vote")

      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }

  console.log("KOS ledger database tests passed")
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
