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
import { readFileSync } from "node:fs"
import path from "node:path"
import { DiffOp } from "diff-match-patch-ts"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { DEFAULT_VOCABULARY_SLUG } from "../lib/public-identifiers"

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must point at a migrated database")
    process.exit(2)
  }

  const {
    collectionsTable,
    commentsTable,
    communitiesTable,
    communityMembersTable,
    conceptSchemesTable,
    conceptsTable,
    db,
    definitionRevisionsTable,
    definitionsTable,
    statementsTable,
    studiesTable,
    surveyResponsesTable,
    surveyStepCompletionsTable,
    surveyStepPositionsTable,
    surveyStepsTable,
    termsTable,
    usersTable,
    vocabulariesTable,
    voteEventsTable,
    votesTable
  } = await import("../drizzle")
  const { castVote, insertComment } = await import("../lib/participation")
  const { mayRegenerateSteps, planSteps, recordCompletion, DEFAULT_QUESTIONS } =
    await import("../lib/surveys")
  const {
    actNamesStep,
    appendQuestionStep,
    completionCountOfStudy,
    gateOf,
    hasPosition,
    nextPositionFor,
    positionsOf,
    recordResponse,
    replaceSteps,
    responseOf,
    stepWithStudy,
    studyProgress,
    walkthroughOf
  } = await import("../lib/survey-queries")
  const { createDefinitionWithInitialRevision } = await import(
    "../lib/definition-revisions"
  )
  const { acceptPositionCandidate, recordPositionCompletion } = await import(
    "../lib/survey-positions"
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

  // Run a check inside a savepoint that is rolled back whatever happens, so
  // a change the check needs leaves the fixture as it was. An assertion
  // failing inside is thrown through.
  const within = async (tx: Tx, run: (sp: Tx) => Promise<void>) => {
    try {
      await tx.transaction(async (sp) => {
        await run(sp)
        throw new Rollback()
      })
    } catch (error) {
      if (!(error instanceof Rollback)) throw error
    }
  }

  // drizzle/invariants.sql is one DO block behind a psql directive. Run the
  // block inside a savepoint, so a planted violation and the exception it
  // raises both roll back with it, and the fixture stays as it was.
  const invariantsSql = readFileSync(
    path.join(process.cwd(), "drizzle", "invariants.sql"),
    "utf8"
  )
    .split("\n")
    .filter((line) => !line.startsWith("\\"))
    .join("\n")
  const runInvariants = (sp: Tx) => sp.execute(sql.raw(invariantsSql))
  const expectInvariant = (outcome: Outcome, text: string, label: string) => {
    assert.ok(!outcome.ok, `${label}: expected the invariant to raise`)
    if (outcome.ok) return
    assert.equal(
      outcome.code,
      "P0001",
      `${label}: SQLSTATE (${outcome.message})`
    )
    assert.ok(
      outcome.message.includes(text),
      `${label}: raised "${outcome.message}", wanted "${text}"`
    )
  }

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
      // An AI-flag account for the model and simulated acts below. The
      // release-time invariants hold the kind of an act to the flag of its
      // account, and the fixture is checked against them at the end.
      const [aiUser] = await tx
        .insert(usersTable)
        .values({ name: `KOS ledger test model ${stamp}`, isAi: true })
        .returning({ id: usersTable.id })
      const [termA, termB, termC] = await tx
        .insert(termsTable)
        .values([
          {
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            term: `kos test a ${stamp}`,
            slug: `kos_test_a_${stamp}`
          },
          {
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            term: `kos test b ${stamp}`,
            slug: `kos_test_b_${stamp}`
          },
          {
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            term: `kos test c ${stamp}`,
            slug: `kos_test_c_${stamp}`
          }
        ])
        .returning({ id: termsTable.id })
      assert.ok(termA.id < termB.id && termB.id < termC.id)
      const { definition, revision: fixtureRevision } =
        await createDefinitionWithInitialRevision(tx, {
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

      // A term-level subject takes a facet, the level the pspp scheme
      // attaches at, so the accepted row also satisfies the release-time
      // invariant the fixture is checked against at the end.
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(statementsTable).values({
            predicate: "dcterms:subject",
            subjectTermId: termA.id,
            objectConceptId: facets[1].id
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
            objectConceptId: facets[1].id,
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

      // A vote on the definition before the purge: its event goes with the
      // definition, the one hard delete of the act record, where the
      // foreign key to the revision would otherwise refuse the purge.
      await castVote(tx, {
        definitionId: definition.id,
        revisionId: fixtureRevision.id,
        userId: user.id,
        vote: "up",
        actorKind: "human",
        communityId: null
      })

      const deleted = await deleteDefinitionRows(tx, definition.id)
      assert.equal(deleted?.id, definition.id)
      const after = await tx
        .select({ id: statementsTable.id })
        .from(statementsTable)
        .where(eq(statementsTable.subjectDefinitionId, definition.id))
      assert.equal(after.length, 0, "definition-level statements purged")
      const eventsAfter = await tx
        .select({ id: voteEventsTable.id })
        .from(voteEventsTable)
        .where(eq(voteEventsTable.definitionId, definition.id))
      assert.equal(
        eventsAfter.length,
        0,
        "the vote events of a purged definition go with it"
      )
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
            userId: aiUser.id,
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
            userId: aiUser.id,
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

      // --- The legacy vote backfill (migration 0043) ---

      // The release-time rules the backfill established, each shown to
      // raise on a planted row. A current vote with no event for its pair
      // is what the backfill left none of.
      const legacyTime = "2025-07-01 12:00:00+00"
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(votesTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: aiUser.id,
            kind: "up",
            createdAt: legacyTime,
            migratedLegacy: true
          })
          await runInvariants(sp)
        }),
        "current vote without a vote event",
        "vote with no event"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(votesTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: aiUser.id,
            kind: "up",
            createdAt: legacyTime,
            migratedLegacy: true
          })
          await sp.insert(voteEventsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: aiUser.id,
            kind: "up",
            actorKind: "model",
            createdAt: "2025-07-02 12:00:00+00",
            backfilled: true,
            migratedLegacy: true
          })
          await runInvariants(sp)
        }),
        "backfilled vote event time disagrees with its vote",
        "backfilled event at another time than its vote"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(voteEventsTable).values([
            {
              definitionId: defB.id,
              revisionId: revB.id,
              userId: aiUser.id,
              kind: "up",
              actorKind: "model",
              createdAt: legacyTime,
              backfilled: true,
              migratedLegacy: true
            },
            {
              definitionId: defB.id,
              revisionId: revB.id,
              userId: aiUser.id,
              kind: "down",
              actorKind: "model",
              createdAt: legacyTime,
              backfilled: true,
              migratedLegacy: true
            }
          ])
          await runInvariants(sp)
        }),
        "more than one backfilled vote event for one vote",
        "two backfilled events for one vote"
      )
      // What the backfill leaves passes, and so does the voter acting again
      // afterwards: a withdrawal and a fresh cast through castVote leave a
      // current row with a time of its own, which the time rule lets be
      // once a later event exists. Unwound with its savepoint, so the
      // fixture keeps no backfilled row.
      class Unwind extends Error {}
      const unwound = await attempt(tx, async (sp) => {
        await sp.insert(votesTable).values({
          definitionId: defB.id,
          revisionId: revB.id,
          userId: aiUser.id,
          kind: "up",
          createdAt: legacyTime,
          migratedLegacy: true
        })
        await sp.insert(voteEventsTable).values({
          definitionId: defB.id,
          revisionId: revB.id,
          userId: aiUser.id,
          kind: "up",
          actorKind: "model",
          createdAt: legacyTime,
          backfilled: true,
          migratedLegacy: true
        })
        await runInvariants(sp)
        const again = {
          definitionId: defB.id,
          revisionId: revB.id,
          userId: aiUser.id,
          vote: "up" as const,
          actorKind: "model" as const,
          communityId: null
        }
        await castVote(sp, again)
        await castVote(sp, again)
        const [recast] = await sp
          .select({ createdAt: votesTable.createdAt })
          .from(votesTable)
          .where(
            and(
              eq(votesTable.revisionId, revB.id),
              eq(votesTable.userId, aiUser.id)
            )
          )
        assert.notEqual(
          recast.createdAt,
          legacyTime,
          "the recast has its own time"
        )
        await runInvariants(sp)
        throw new Unwind("backfill probe unwound")
      })
      assert.ok(
        !unwound.ok && unwound.message.includes("backfill probe unwound"),
        `backfilled vote, withdrawn and recast: ${unwound.ok ? "" : unwound.message}`
      )

      // --- Survey walkthrough (migration 0041) ---

      // The context a walkthrough needs: a community the fixture account is
      // in, and a study of it working through the fixture collection. The
      // membership episode opens at the now() of this transaction, which is
      // also when every completion below is stamped, so the release-time
      // rule that a completion falls inside an episode holds on the fixture.
      const communitySlug = `kos-test-${stamp}`
      await tx.insert(vocabulariesTable).values({
        slug: communitySlug,
        title: `KOS test community ${stamp}`,
        createdById: user.id
      })
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug: communitySlug,
          vocabularySlug: communitySlug,
          title: `KOS test community ${stamp}`,
          createdById: user.id
        })
        .returning({ id: communitiesTable.id })
      await tx.insert(communityMembersTable).values({
        communityId: community.id,
        userId: user.id,
        addedById: user.id
      })
      const [study] = await tx
        .insert(studiesTable)
        .values({
          slug: `kos-test-${stamp}`,
          communityId: community.id,
          collectionId: collection.id,
          title: `KOS test study ${stamp}`,
          createdById: user.id
        })
        .returning({ id: studiesTable.id })

      // A well-formed instructions step, varied one column at a time so each
      // probe breaks exactly one rule.
      const stepRow = (
        values: Partial<typeof surveyStepsTable.$inferInsert>
      ) => ({
        studyId: study.id,
        position: 1,
        kind: "instructions" as const,
        prompt: "Read this first.",
        ...values
      })
      const probeStep = (
        values: Partial<typeof surveyStepsTable.$inferInsert>
      ) =>
        attempt(tx, (sp) => sp.insert(surveyStepsTable).values(stepRow(values)))

      expectRejected(
        await probeStep({ position: 0 }),
        "23514",
        "survey_steps_position_positive",
        "position zero"
      )
      expectRejected(
        await probeStep({ kind: "define", prompt: null }),
        "23514",
        "survey_steps_term_by_kind",
        "define step without a term"
      )
      expectRejected(
        await probeStep({ termId: termA.id }),
        "23514",
        "survey_steps_term_by_kind",
        "instructions step with a term"
      )
      expectRejected(
        await probeStep({ kind: "question", prompt: "How sure are you?" }),
        "23514",
        "survey_steps_response_by_kind",
        "question without a response kind"
      )
      expectRejected(
        await probeStep({
          kind: "review",
          termId: termA.id,
          prompt: null,
          responseKind: "text"
        }),
        "23514",
        "survey_steps_response_by_kind",
        "review step with a response kind"
      )
      expectRejected(
        await probeStep({ prompt: "   " }),
        "23514",
        "survey_steps_prompt_by_kind",
        "blank instructions"
      )
      expectRejected(
        await probeStep({
          kind: "question",
          prompt: null,
          responseKind: "scale"
        }),
        "23514",
        "survey_steps_prompt_by_kind",
        "question without its text"
      )
      expectAccepted(
        await probeStep({ kind: "define", termId: termA.id, prompt: null }),
        "define step without a nudge"
      )
      expectRejected(
        await probeStep({ kind: "review", termId: termA.id, prompt: null }),
        "23505",
        "survey_steps_study_position_unique",
        "two steps at one position"
      )
      await tx
        .delete(surveyStepsTable)
        .where(eq(surveyStepsTable.studyId, study.id))

      // --- The walkthrough as the application writes it, through the same
      // lib/ helpers the router and the pilot driver call ---

      // Instructions, a define and a review step per term, then the two
      // questions: the plan for a two-term collection, positions from 1.
      const steps = await replaceSteps(
        tx,
        study.id,
        planSteps({
          welcome: null,
          terms: [
            { id: termA.id, term: `kos test a ${stamp}` },
            { id: termB.id, term: `kos test b ${stamp}` }
          ],
          questions: DEFAULT_QUESTIONS
        })
      )
      assert.deepEqual(
        steps.map((step) => [step.position, step.kind, step.termId]),
        [
          [1, "instructions", null],
          [2, "define", termA.id],
          [3, "define", termB.id],
          [4, "review", termA.id],
          [5, "review", termB.id],
          [6, "question", null],
          [7, "question", null]
        ]
      )
      const stepAt = (position: number) =>
        steps.find((step) => step.position === position)!
      const instructions = stepAt(1)
      const defineA = stepAt(2)
      const defineB = stepAt(3)
      const reviewA = stepAt(4)
      const reviewB = stepAt(5)
      const scaleQuestion = stepAt(6)
      const textQuestion = stepAt(7)
      assert.equal(scaleQuestion.responseKind, "scale")
      assert.equal(textQuestion.responseKind, "text")

      // Nothing has started: the steps may be replaced, and replacing them
      // again keeps the count and renumbers from 1.
      assert.equal(
        mayRegenerateSteps(await completionCountOfStudy(tx, study.id)),
        true
      )
      const located = await stepWithStudy(tx, defineA.id)
      assert.equal(located?.study.id, study.id)
      assert.equal(located?.study.communityId, community.id)
      assert.equal(located?.step.kind, "define")

      // Instructions complete on the press. A second press is not an error
      // and records nothing new.
      assert.ok(
        await recordCompletion(tx, { stepId: instructions.id, userId: user.id })
      )
      assert.equal(
        await recordCompletion(tx, {
          stepId: instructions.id,
          userId: user.id
        }),
        null,
        "a completion recorded twice stands once"
      )

      // The define step of termA, taken by replacing the candidates: the
      // initial revision names the step, and is the position. The fixture
      // definition of termA was purged above, so the account has no original
      // there and may write one.
      assert.equal(
        await hasPosition(tx, defineA.id, user.id),
        false,
        "no position before any act names the step"
      )
      const { definition: defA, revision: revA } =
        await createDefinitionWithInitialRevision(tx, {
          termId: termA.id,
          authorId: user.id,
          definition: "A fixture definition written inside a define step.",
          example: "Rolled back at the end.",
          changeNote: "Initial contribution",
          source: "initial",
          surveyStepId: defineA.id
        })
      assert.equal(revA.surveyStepId, defineA.id, "revision names its step")
      assert.equal(revA.version, 1)
      assert.equal(await hasPosition(tx, defineA.id, user.id), true)
      assert.equal(
        await hasPosition(tx, defineA.id, aiUser.id),
        false,
        "another account's definition is not the caller's position"
      )
      await recordPositionCompletion(tx, {
        stepId: defineA.id,
        userId: user.id,
        kind: "proposed",
        definitionId: defA.id,
        revisionId: revA.id
      })

      // Accept is one atomic position write in each possible standing-vote
      // state. The savepoints leave defineB incomplete for the resumption
      // assertions below.
      const voteEventCount = async (sp: Tx) => {
        const [row] = await sp
          .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
          .from(voteEventsTable)
          .where(
            and(
              eq(voteEventsTable.definitionId, defB.id),
              eq(voteEventsTable.revisionId, revB.id),
              eq(voteEventsTable.userId, user.id)
            )
          )
        return row.count
      }
      const definitionScore = async (sp: Tx) =>
        (
          await sp
            .select({ score: definitionsTable.score })
            .from(definitionsTable)
            .where(eq(definitionsTable.id, defB.id))
        )[0].score
      const acceptInSavepoint = (sp: Tx) =>
        acceptPositionCandidate(sp, {
          stepId: defineB.id,
          termId: termB.id,
          userId: user.id,
          definitionId: defB.id,
          revisionId: revB.id,
          actorKind: "human",
          communityId: community.id
        })

      await within(tx, async (sp) => {
        const scoreBefore = await definitionScore(sp)
        const accepted = await acceptInSavepoint(sp)
        assert.equal(accepted.standingVote, null)
        assert.equal(accepted.score, scoreBefore + 1)
        assert.equal(
          (await positionsOf(sp, [defineB.id], user.id)).get(defineB.id)
            ?.definitionId,
          defB.id
        )
        await runInvariants(sp)
      })

      await within(tx, async (sp) => {
        await castVote(sp, {
          definitionId: defB.id,
          revisionId: revB.id,
          userId: user.id,
          vote: "up",
          actorKind: "human",
          communityId: community.id,
          surveyStepId: null
        })
        const [scoreBefore, eventsBefore] = await Promise.all([
          definitionScore(sp),
          voteEventCount(sp)
        ])
        const accepted = await acceptInSavepoint(sp)
        assert.equal(accepted.standingVote, "up")
        assert.equal(accepted.score, scoreBefore)
        assert.equal(await voteEventCount(sp), eventsBefore)
        await runInvariants(sp)
      })

      await within(tx, async (sp) => {
        await castVote(sp, {
          definitionId: defB.id,
          revisionId: revB.id,
          userId: user.id,
          vote: "down",
          actorKind: "human",
          communityId: community.id,
          surveyStepId: null
        })
        const [scoreBefore, eventsBefore] = await Promise.all([
          definitionScore(sp),
          voteEventCount(sp)
        ])
        const accepted = await acceptInSavepoint(sp)
        assert.equal(accepted.standingVote, "down")
        assert.equal(accepted.score, scoreBefore + 2)
        assert.equal(await voteEventCount(sp), eventsBefore + 1)
        await runInvariants(sp)
      })

      // The define step of termB, taken by accepting a candidate: an upvote
      // naming the step. The position is held without the completion, which
      // the press records; the step stays where the walkthrough resumes.
      await castVote(tx, {
        definitionId: defB.id,
        revisionId: revB.id,
        userId: user.id,
        vote: "up",
        actorKind: "human",
        communityId: community.id,
        surveyStepId: defineB.id
      })
      assert.equal(
        await hasPosition(tx, defineB.id, user.id),
        true,
        "an upvote naming the define step is a position"
      )
      expectAccepted(
        await attempt(tx, runInvariants),
        "a vote event inside the define step of its term"
      )
      await within(tx, async (sp) => {
        const completion = await recordCompletion(sp, {
          stepId: defineB.id,
          userId: user.id
        })
        assert.ok(completion)
        const recovered = await recordPositionCompletion(sp, {
          stepId: defineB.id,
          userId: user.id,
          kind: "accepted",
          definitionId: defB.id,
          revisionId: revB.id
        })
        assert.equal(recovered.completion.id, completion.id)
        assert.equal(recovered.position.recordedAt, completion.completedAt)
        await runInvariants(sp)
      })

      // A standing upvote on the current revision of a definition of the
      // term is a position on its define step: the gate reads it, and the
      // walkthrough reports no held position for it, so the shell shows the
      // candidates with Accept open on that one. It is not an act naming
      // the step, so a vote inside the step is not a second act.
      await castVote(tx, {
        definitionId: defB.id,
        revisionId: revB.id,
        userId: aiUser.id,
        vote: "up",
        actorKind: "simulated",
        communityId: community.id,
        surveyStepId: null
      })
      assert.equal(
        await hasPosition(tx, defineB.id, aiUser.id),
        true,
        "a standing upvote on a definition of the term is a position"
      )
      const standingWalk = await walkthroughOf(tx, study.id, aiUser.id)
      assert.equal(standingWalk.steps[2].hasPosition, true)
      assert.equal(
        standingWalk.steps[2].held,
        null,
        "a standing upvote is not reported as a held position"
      )
      assert.equal(
        await actNamesStep(tx, defineB.id, aiUser.id),
        false,
        "a standing upvote names no step"
      )
      assert.equal(
        await actNamesStep(tx, defineB.id, user.id),
        true,
        "the upvote cast inside the step names it"
      )
      assert.equal(
        await hasPosition(tx, defineA.id, aiUser.id),
        false,
        "an upvote on a definition of another term is not a position"
      )

      // A standing downvote is not a position: the define step of termA,
      // whose one definition the AI account votes down.
      await castVote(tx, {
        definitionId: defA.id,
        revisionId: revA.id,
        userId: aiUser.id,
        vote: "down",
        actorKind: "simulated",
        communityId: community.id,
        surveyStepId: null
      })
      assert.equal(
        await hasPosition(tx, defineA.id, aiUser.id),
        false,
        "a standing downvote is not a position"
      )

      // An upvote on a superseded revision is not a position: the voter can
      // neither see it on the candidates nor recast it. A later revision
      // becomes current inside a savepoint, and the fixture keeps revB.
      await within(tx, async (sp) => {
        const [next] = await sp
          .insert(definitionRevisionsTable)
          .values({
            definitionId: defB.id,
            version: 2,
            previousRevisionId: revB.id,
            definitionDiff: [[DiffOp.Equal, "A fixture definition, revised."]],
            exampleDiff: [[DiffOp.Equal, "Rolled back with the savepoint."]],
            editorId: user.id,
            changeNote: "a revision that supersedes the voted one",
            source: "author_edit",
            changeDelta: "0.000"
          })
          .returning({ id: definitionRevisionsTable.id })
        await sp
          .update(definitionsTable)
          .set({ currentRevisionId: next.id })
          .where(eq(definitionsTable.id, defB.id))
        assert.equal(
          await hasPosition(sp, defineB.id, aiUser.id),
          false,
          "an upvote on a superseded revision is not a position"
        )
        assert.equal(
          await hasPosition(sp, defineB.id, user.id),
          true,
          "an upvote event naming the step stays one"
        )
      })

      // A downvote or a withdrawal naming a define step is not a position
      // and is not a held position, whatever got it into the record: the
      // invariant below refuses such rows, and the reads do not count them.
      for (const kind of ["down", null] as const) {
        await within(tx, async (sp) => {
          await sp.insert(voteEventsTable).values({
            definitionId: defA.id,
            revisionId: revA.id,
            userId: aiUser.id,
            kind,
            actorKind: "simulated",
            communityId: community.id,
            surveyStepId: defineA.id
          })
          assert.equal(
            await hasPosition(sp, defineA.id, aiUser.id),
            false,
            `a ${kind ?? "withdrawal"} event naming the define step is not a position`
          )
          assert.equal(
            (await walkthroughOf(sp, study.id, aiUser.id)).steps[1].held,
            null,
            `a ${kind ?? "withdrawal"} event naming the define step is not held`
          )
        })
      }

      // The gate as the router evaluates it, with its facts loaded.
      assert.deepEqual(await gateOf(tx, instructions, aiUser.id), { ok: true })
      assert.deepEqual(
        await gateOf(tx, defineA, aiUser.id),
        { ok: false, reason: "Take a position on this term first" },
        "a standing downvote does not pass the define gate"
      )
      assert.deepEqual(
        await gateOf(tx, defineB, aiUser.id),
        { ok: true },
        "a standing upvote passes the define gate"
      )
      assert.deepEqual(
        await gateOf(tx, defineB, user.id),
        { ok: true },
        "an upvote event naming the step passes the define gate"
      )
      assert.deepEqual(
        await gateOf(tx, scaleQuestion, user.id),
        { ok: false, reason: "Answer the question first" },
        "an unanswered question does not pass its gate"
      )

      // The review step of termB: a comment and a vote, each naming it. The
      // vote changes the one cast in the define step, so the event records
      // the new standing.
      const { comment } = await insertComment(tx, {
        definitionId: defB.id,
        revisionId: revB.id,
        userId: user.id,
        message: "a comment posted inside a review step",
        actorKind: "human",
        surveyStepId: reviewB.id
      })
      assert.equal(comment.surveyStepId, reviewB.id, "comment names its step")
      await castVote(tx, {
        definitionId: defB.id,
        revisionId: revB.id,
        userId: user.id,
        vote: "down",
        actorKind: "human",
        communityId: community.id,
        surveyStepId: reviewB.id
      })
      const stepEvents = await tx
        .select({ kind: voteEventsTable.kind })
        .from(voteEventsTable)
        .where(eq(voteEventsTable.surveyStepId, reviewB.id))
      assert.deepEqual(
        stepEvents.map((event) => event.kind),
        ["down"],
        "the vote event names its step"
      )
      await recordCompletion(tx, { stepId: reviewB.id, userId: user.id })

      // A question: its answer and its completion, together.
      assert.equal(await responseOf(tx, scaleQuestion.id, user.id), null)
      const answer = await recordResponse(tx, {
        stepId: scaleQuestion.id,
        userId: user.id,
        authorKind: "human",
        valueScale: 4
      })
      assert.equal(answer.valueScale, 4)
      assert.equal(
        (await responseOf(tx, scaleQuestion.id, user.id))?.id,
        answer.id
      )
      assert.deepEqual(
        await gateOf(tx, scaleQuestion, user.id),
        { ok: true },
        "an answered question passes its gate"
      )

      // --- What the router and the pages read back ---

      // Done: 1, 2, 5, 6. The lowest position without a completion is 3.
      assert.equal(await nextPositionFor(tx, study.id, user.id), 3)
      assert.equal(await completionCountOfStudy(tx, study.id), 4)
      assert.equal(
        mayRegenerateSteps(await completionCountOfStudy(tx, study.id)),
        false,
        "steps are append-only once anyone has started"
      )

      const mine = await walkthroughOf(tx, study.id, user.id)
      assert.equal(mine.resumePosition, 3)
      assert.deepEqual(
        [...mine.completedStepIds].sort((a, b) => a - b),
        [instructions.id, defineA.id, reviewB.id, scaleQuestion.id].sort(
          (a, b) => a - b
        )
      )
      assert.deepEqual(
        mine.steps.map((step) => step.completed),
        [true, true, false, false, true, true, false]
      )
      assert.equal(mine.steps[1].hasPosition, true, "define A: a definition")
      assert.deepEqual(
        mine.steps[1].held,
        {
          kind: "proposed",
          definitionId: defA.id,
          revisionId: revA.id,
          definitionNumber: defA.definitionNumber,
          revisionVersion: revA.version
        },
        "the definition written inside the step is the position"
      )
      assert.equal(mine.steps[2].hasPosition, true, "define B: an upvote")
      assert.deepEqual(
        mine.steps[2].held,
        {
          kind: "accepted",
          definitionId: defB.id,
          revisionId: revB.id,
          definitionNumber: defB.definitionNumber,
          revisionVersion: revB.version
        },
        "the candidate upvoted inside the step is the position"
      )
      assert.ok(
        mine.steps
          .filter((step) => step.kind !== "define")
          .every((step) => !step.hasPosition && step.held === null),
        "only a define step holds a position"
      )
      assert.equal(mine.steps[1].term, `kos test a ${stamp}`)
      assert.equal(mine.steps[0].term, null)
      assert.deepEqual(mine.steps[5].response, {
        valueText: null,
        valueScale: 4
      })
      assert.equal(mine.steps[6].response, null)
      assert.deepEqual(
        mine.steps[3].reviewRecord,
        { votes: [], comments: [] },
        "a review without acts has an empty record"
      )
      assert.deepEqual(mine.steps[4].reviewRecord, {
        votes: [
          {
            kind: "down",
            definitionNumber: defB.definitionNumber,
            revisionVersion: revB.version
          }
        ],
        comments: [
          {
            message: "a comment posted inside a review step",
            definitionNumber: defB.definitionNumber,
            revisionVersion: revB.version
          }
        ]
      })
      assert.ok(
        mine.steps
          .filter((step) => step.kind !== "review")
          .every((step) => step.reviewRecord === null),
        "only review steps expose a review record"
      )

      // Public study, private progress: a signed-out viewer sees the steps
      // and nothing of anyone's progress.
      const anyone = await walkthroughOf(tx, study.id, null)
      assert.equal(anyone.steps.length, 7)
      assert.equal(anyone.resumePosition, 1)
      assert.deepEqual(anyone.completedStepIds, [])
      assert.ok(
        anyone.steps.every(
          (step) =>
            !step.completed &&
            !step.hasPosition &&
            step.held === null &&
            step.response === null &&
            step.reviewRecord === null
        )
      )

      const progress = await studyProgress(tx, study.id)
      assert.ok(progress)
      assert.equal(progress.total, 7)
      assert.equal(progress.finished, 0)
      assert.deepEqual(
        progress.participants.map((p) => [p.userId, p.completed, p.total]),
        [[user.id, 4, 7]],
        "the one live member, four of seven"
      )
      assert.deepEqual(
        progress.steps.map((step) => step.completions),
        [1, 1, 0, 0, 1, 1, 0]
      )

      // A question appended after a start lengthens the list, not anyone's
      // position, and the positions stay contiguous.
      const appended = await appendQuestionStep(tx, study.id, {
        prompt: "Anything else?",
        responseKind: "text"
      })
      assert.equal(appended.position, 8)
      assert.equal(await nextPositionFor(tx, study.id, user.id), 3)
      assert.equal((await studyProgress(tx, study.id))?.total, 8)

      // --- Each CHECK on a response, and the pairs answered once ---

      const probeResponse = (
        values: Partial<typeof surveyResponsesTable.$inferInsert>
      ) =>
        attempt(tx, (sp) =>
          sp.insert(surveyResponsesTable).values({
            stepId: textQuestion.id,
            userId: user.id,
            authorKind: "human",
            ...values
          })
        )
      expectRejected(
        await probeResponse({}),
        "23514",
        "survey_responses_one_value",
        "response with no value"
      )
      expectRejected(
        await probeResponse({ valueText: "both", valueScale: 3 }),
        "23514",
        "survey_responses_one_value",
        "response with both values"
      )
      expectRejected(
        await probeResponse({ valueScale: 0 }),
        "23514",
        "survey_responses_scale_range",
        "scale below 1"
      )
      expectRejected(
        await probeResponse({ valueScale: 6 }),
        "23514",
        "survey_responses_scale_range",
        "scale above 5"
      )
      expectRejected(
        await probeResponse({ valueText: "   " }),
        "23514",
        "survey_responses_text_nonblank",
        "blank text"
      )
      expectRejected(
        await probeResponse({
          valueText: "a human answer with a stamp",
          model: "gemma4:26b"
        }),
        "23514",
        "survey_responses_human_carries_no_stamp",
        "stamp on a human answer"
      )
      expectRejected(
        await probeResponse({
          userId: aiUser.id,
          authorKind: "simulated",
          valueText: "a simulated answer with half a stamp",
          promptHash: "0123456789abcdef",
          model: "gemma4:26b"
        }),
        "23514",
        "survey_responses_stamp_pair",
        "prompt hash without its text"
      )
      expectRejected(
        await probeResponse({ stepId: scaleQuestion.id, valueScale: 2 }),
        "23505",
        "survey_responses_step_user_unique",
        "a question answered twice"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp
            .insert(surveyStepCompletionsTable)
            .values({ stepId: instructions.id, userId: user.id })
        ),
        "23505",
        "survey_step_completions_step_user_unique",
        "a step completed twice"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(surveyStepPositionsTable).values({
            stepId: defineA.id,
            userId: user.id,
            kind: "proposed",
            definitionId: defA.id,
            revisionId: revA.id
          })
        ),
        "23505",
        "survey_step_positions_step_user_pk",
        "a second candidate for one Position step"
      )
      expectRejected(
        await attempt(tx, (sp) =>
          sp.insert(surveyStepPositionsTable).values({
            stepId: defineB.id,
            userId: user.id,
            kind: "accepted",
            definitionId: defB.id,
            revisionId: revB.id
          })
        ),
        "23503",
        "survey_step_positions_completion_fk",
        "a position without its completion"
      )
      expectRejected(
        await attempt(tx, async (sp) => {
          await sp
            .delete(surveyStepPositionsTable)
            .where(
              and(
                eq(surveyStepPositionsTable.stepId, defineA.id),
                eq(surveyStepPositionsTable.userId, user.id)
              )
            )
          await sp.insert(surveyStepPositionsTable).values({
            stepId: defineA.id,
            userId: user.id,
            kind: "proposed",
            definitionId: defA.id,
            revisionId: revB.id
          })
        }),
        "23503",
        "survey_step_positions_revision_definition_fk",
        "a position whose revision belongs to another definition"
      )

      // An exceptional definition purge removes the exact target but keeps
      // durable study progress, which is why these are separate tables.
      await within(tx, async (sp) => {
        await deleteDefinitionRows(sp, defA.id)
        assert.ok(
          await sp.query.surveyStepCompletionsTable.findFirst({
            where: and(
              eq(surveyStepCompletionsTable.stepId, defineA.id),
              eq(surveyStepCompletionsTable.userId, user.id)
            )
          })
        )
        assert.equal(
          await sp.query.surveyStepPositionsTable.findFirst({
            where: and(
              eq(surveyStepPositionsTable.stepId, defineA.id),
              eq(surveyStepPositionsTable.userId, user.id)
            )
          }),
          undefined
        )
        await runInvariants(sp)
      })

      // The backstop behind mayRegenerateSteps: a step an act refers to
      // cannot be deleted. Three foreign keys could answer and their order is
      // not promised, so only the class is asserted.
      const deletion = await attempt(tx, (sp) =>
        sp.delete(surveyStepsTable).where(eq(surveyStepsTable.id, reviewB.id))
      )
      assert.ok(
        !deletion.ok && deletion.code === "23503",
        "deleting a step an act refers to is refused by foreign key"
      )

      // --- The release-time invariants, each shown to raise on a planted
      // violation, then passing on the fixture ---

      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp
            .insert(surveyStepCompletionsTable)
            .values({ stepId: reviewA.id, userId: user.id })
          await sp.insert(surveyStepPositionsTable).values({
            stepId: reviewA.id,
            userId: user.id,
            kind: "accepted",
            definitionId: defB.id,
            revisionId: revB.id
          })
          await runInvariants(sp)
        }),
        "survey position is not on the term of a define step",
        "position target attached to a review step"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp
            .update(surveyStepPositionsTable)
            .set({
              recordedAt: sql`${surveyStepPositionsTable.recordedAt} + interval '1 second'`
            })
            .where(
              and(
                eq(surveyStepPositionsTable.stepId, defineA.id),
                eq(surveyStepPositionsTable.userId, user.id)
              )
            )
          await runInvariants(sp)
        }),
        "survey position and completion were not recorded together",
        "position added after its completion"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp
            .update(surveyStepPositionsTable)
            .set({ kind: "accepted" })
            .where(
              and(
                eq(surveyStepPositionsTable.stepId, defineA.id),
                eq(surveyStepPositionsTable.userId, user.id)
              )
            )
          await runInvariants(sp)
        }),
        "accepted survey position has no preceding upvote",
        "accepted position without an upvote on its exact revision"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          const [later] = await sp
            .insert(definitionRevisionsTable)
            .values({
              definitionId: defA.id,
              version: 2,
              previousRevisionId: revA.id,
              definitionDiff: [
                [
                  DiffOp.Equal,
                  "A fixture definition written inside a define step."
                ]
              ],
              exampleDiff: [[DiffOp.Equal, "Rolled back at the end."]],
              editorId: user.id,
              changeNote: "later edit is not the proposed position",
              source: "author_edit",
              changeDelta: "0.000"
            })
            .returning({ id: definitionRevisionsTable.id })
          await sp
            .update(surveyStepPositionsTable)
            .set({ revisionId: later.id })
            .where(
              and(
                eq(surveyStepPositionsTable.stepId, defineA.id),
                eq(surveyStepPositionsTable.userId, user.id)
              )
            )
          await runInvariants(sp)
        }),
        "proposed survey position is not its participant initial revision in the step",
        "proposed position attached to a later edit"
      )

      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(commentsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: user.id,
            message: "posted inside the review step of another term",
            authorKind: "human",
            surveyStepId: reviewA.id
          })
          await runInvariants(sp)
        }),
        "comment step is not a review step",
        "comment on the review step of another term"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(voteEventsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: user.id,
            kind: "down",
            actorKind: "human",
            communityId: community.id,
            surveyStepId: defineA.id
          })
          await runInvariants(sp)
        }),
        "vote event step is not a define or review step",
        "vote event inside the define step of another term"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(voteEventsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: user.id,
            kind: "down",
            actorKind: "human",
            communityId: community.id,
            surveyStepId: instructions.id
          })
          await runInvariants(sp)
        }),
        "vote event step is not a define or review step",
        "vote event inside the instructions step"
      )
      // The position rule on the record: inside a define step the vote is
      // an upvote, and one act per person.
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(voteEventsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: aiUser.id,
            kind: "down",
            actorKind: "simulated",
            communityId: community.id,
            surveyStepId: defineB.id
          })
          await runInvariants(sp)
        }),
        "vote event inside a define step is not an upvote",
        "downvote event naming the define step of its term"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(voteEventsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: aiUser.id,
            kind: null,
            actorKind: "simulated",
            communityId: community.id,
            surveyStepId: defineB.id
          })
          await runInvariants(sp)
        }),
        "vote event inside a define step is not an upvote",
        "withdrawal event naming the define step of its term"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(voteEventsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: user.id,
            kind: "up",
            actorKind: "human",
            communityId: community.id,
            surveyStepId: defineB.id
          })
          await runInvariants(sp)
        }),
        "more than one act by one person inside a define step",
        "a second upvote event by one person naming a define step"
      )
      // The AI account, which has no act naming the step and no original
      // on termB: an upvote event naming the step passes on its own, and an
      // initial revision beside it does not.
      expectAccepted(
        await attempt(tx, async (sp) => {
          await sp.insert(voteEventsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: aiUser.id,
            kind: "up",
            actorKind: "simulated",
            communityId: community.id,
            surveyStepId: defineB.id
          })
          await runInvariants(sp)
        }),
        "one upvote event by one person naming a define step"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(voteEventsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: aiUser.id,
            kind: "up",
            actorKind: "simulated",
            communityId: community.id,
            surveyStepId: defineB.id
          })
          await createDefinitionWithInitialRevision(sp, {
            termId: termB.id,
            authorId: aiUser.id,
            definition: "A definition beside an upvote, inside the step.",
            example: "Rolled back with the savepoint.",
            changeNote: "fixture",
            source: "ai_generation",
            surveyStepId: defineB.id
          })
          await runInvariants(sp)
        }),
        "more than one act by one person inside a define step",
        "an initial revision beside an upvote event by one person in a define step"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(voteEventsTable).values({
            definitionId: defB.id,
            revisionId: revB.id,
            userId: user.id,
            kind: "down",
            actorKind: "human",
            communityId: null,
            surveyStepId: reviewB.id
          })
          await runInvariants(sp)
        }),
        "vote event community is not the community of the study",
        "vote event inside a step, recorded outside the community of the study"
      )
      // Revisions are immutable, so both plants are inserts: a definition
      // of another term written inside the step, and an edit that names it.
      expectInvariant(
        await attempt(tx, async (sp) => {
          await createDefinitionWithInitialRevision(sp, {
            termId: termC.id,
            authorId: aiUser.id,
            definition: "A definition of another term, inside the step.",
            example: "Rolled back with the savepoint.",
            changeNote: "fixture",
            source: "ai_generation",
            surveyStepId: defineA.id
          })
          await runInvariants(sp)
        }),
        "revision step is not a define step on the term of its definition",
        "definition of another term inside the define step"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(definitionRevisionsTable).values({
            definitionId: defA.id,
            version: 2,
            previousRevisionId: revA.id,
            definitionDiff: [[DiffOp.Equal, "A fixture definition, edited."]],
            exampleDiff: [[DiffOp.Equal, "Rolled back with the savepoint."]],
            editorId: user.id,
            changeNote: "an edit that names the step",
            source: "author_edit",
            changeDelta: "0.000",
            surveyStepId: defineA.id
          })
          await runInvariants(sp)
        }),
        "or the revision is not the first",
        "a later revision inside the define step"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(surveyResponsesTable).values({
            stepId: textQuestion.id,
            userId: user.id,
            valueText: "an answer with no completion",
            authorKind: "human"
          })
          await runInvariants(sp)
        }),
        "response does not answer a question step",
        "response without its completion"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(surveyResponsesTable).values({
            stepId: textQuestion.id,
            userId: user.id,
            valueScale: 2,
            authorKind: "human"
          })
          await sp
            .insert(surveyStepCompletionsTable)
            .values({ stepId: textQuestion.id, userId: user.id })
          await runInvariants(sp)
        }),
        "response does not answer a question step",
        "scale answer to a text question"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp
            .update(surveyResponsesTable)
            .set({ authorKind: "simulated" })
            .where(eq(surveyResponsesTable.stepId, scaleQuestion.id))
          await runInvariants(sp)
        }),
        "survey response authorKind disagrees",
        "simulated answer under a human account"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp.insert(surveyResponsesTable).values({
            stepId: textQuestion.id,
            userId: aiUser.id,
            valueText: "generated text with no stamp",
            authorKind: "simulated"
          })
          await sp
            .insert(surveyStepCompletionsTable)
            .values({ stepId: textQuestion.id, userId: aiUser.id })
          await runInvariants(sp)
        }),
        "text answer without its generation stamp",
        "simulated text answer without a stamp"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp
            .insert(surveyStepCompletionsTable)
            .values({ stepId: textQuestion.id, userId: user.id })
          await runInvariants(sp)
        }),
        "question step completion without its response",
        "question completed without an answer"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp
            .insert(surveyStepCompletionsTable)
            .values({ stepId: instructions.id, userId: aiUser.id })
          await runInvariants(sp)
        }),
        "completion by a person without a membership episode",
        "completion by a non-member"
      )
      expectInvariant(
        await attempt(tx, async (sp) => {
          await sp
            .update(surveyStepsTable)
            .set({ position: 10 })
            .where(eq(surveyStepsTable.id, appended.id))
          await runInvariants(sp)
        }),
        "do not run from 1 without gaps",
        "a gap in the positions"
      )

      // And the fixture as written passes every invariant in the file, the
      // walkthrough rows and the rest alike.
      expectAccepted(
        await attempt(tx, runInvariants),
        "release invariants on the fixture"
      )

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
