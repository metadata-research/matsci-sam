/*
 * Administrative visibility and public discovery contracts. Service invariant
 * probes roll back through savepoints. Committed fixtures let the actual
 * routers/export loaders use independent connections, and finally removes
 * the fixtures. Refuse primary or remote databases before any write.
 */
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external"
import { eq, inArray, or, sql } from "drizzle-orm"
import {
  collectionsTable,
  commentsTable,
  conceptSchemesTable,
  conceptsTable,
  db,
  definitionsTable,
  statementsTable,
  termsTable,
  termVisibilityEventsTable,
  usersTable
} from "../drizzle"
import { deleteDefinitionRows } from "../lib/definition-purge"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import {
  collectionMembers,
  collectionsWithCounts,
  conceptsOfScheme
} from "../lib/kos-queries"
import { KosView, kosTurtle } from "../lib/kos-export"
import { buildTermProvenance } from "../lib/provenance"
import { provenanceTurtle } from "../lib/provenance-rdf"
import { DEFAULT_VOCABULARY_SLUG, termUri } from "../lib/public-identifiers"
import {
  buildTermSkos,
  buildTermsSkos,
  loadKos,
  termJsonLd,
  termTurtle
} from "../lib/skos"
import {
  changeTermVisibility,
  listTermVisibility,
  termVisibilityHistory
} from "../lib/term-visibility"
import {
  loadProvenanceDatasetData,
  provenanceDatasetBlocksTurtle,
  ProvenanceDatasetView
} from "../lib/graph/provenance-dataset"
import { appRouter } from "../trpc/routers/_app"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
class Rollback extends Error {}

const main = async () => {
  assert.ok(
    process.env.DATABASE_URL,
    "DATABASE_URL must point at a migrated scratch database"
  )
  const databaseUrl = new URL(process.env.DATABASE_URL)
  const effectiveHost =
    databaseUrl.searchParams.get("host") || databaseUrl.hostname
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]", "/var/run/postgresql"].includes(
      effectiveHost
    ),
    "Visibility fixture tests only run on localhost"
  )
  assert.match(
    databaseUrl.pathname,
    /_(?:test|scratch|ci)(?:_|$)/,
    "Visibility fixture tests require an explicitly disposable database name"
  )
  process.env.GRAPH_PROJECTION_ENABLED = "false"

  const stamp = randomUUID().replaceAll("-", "")
  const needle = `visibilityneedle${stamp}`
  const facetSlug = `visibility_facet_${stamp}`
  const userIds: number[] = []
  const termIds: number[] = []
  const collectionIds: number[] = []
  const schemeIds: number[] = []
  const topicIds: number[] = []
  const context = (id?: number) => ({ session: { id } }) as never
  const publicCaller = appRouter.createCaller(context())
  const invariantsSql = readFileSync(
    path.join(process.cwd(), "drizzle", "invariants.sql"),
    "utf8"
  )
    .split("\n")
    .filter((line) => !line.startsWith("\\"))
    .join("\n")
  const runInvariants = (tx: Tx) => tx.execute(sql.raw(invariantsSql))
  const eventCount = async () => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(termVisibilityEventsTable)
      .where(inArray(termVisibilityEventsTable.termId, termIds))
    return row.count
  }

  try {
    const fixture = await db.transaction(async (tx) => {
      const [admin, contributor] = await tx
        .insert(usersTable)
        .values([
          { name: `Visibility admin ${stamp}`, role: "admin" },
          { name: `Visibility contributor ${stamp}` }
        ])
        .returning()
      userIds.push(admin.id, contributor.id)
      const [listed, moderated] = await tx
        .insert(termsTable)
        .values([
          {
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            term: `${needle} listed`,
            slug: `visibility_listed_${stamp}`
          },
          {
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            term: `${needle} reviewed`,
            slug: `visibility_reviewed_${stamp}`
          }
        ])
        .returning()
      termIds.push(listed.id, moderated.id)
      const definitions = []
      for (const term of [listed, moderated]) {
        const published = await createDefinitionWithInitialRevision(tx, {
          termId: term.id,
          authorId: contributor.id,
          definition: `A publication containing ${needle} for discovery tests.`,
          example: "",
          changeNote: "Visibility test publication",
          source: "initial"
        })
        const [comment] = await tx
          .insert(commentsTable)
          .values({
            definitionId: published.definition.id,
            revisionId: published.revision.id,
            userId: contributor.id,
            authorKind: "human",
            message: `A retained comment for ${term.slug}.`
          })
          .returning()
        definitions.push({ ...published, comment })
      }
      const [scheme] = await tx
        .insert(conceptSchemesTable)
        .values({
          slug: facetSlug,
          title: `Visibility facet ${stamp}`,
          attachesAt: "term"
        })
        .returning()
      schemeIds.push(scheme.id)
      const [facet] = await tx
        .insert(conceptsTable)
        .values({
          schemeId: scheme.id,
          slug: "fixture",
          prefLabel: `Visibility facet ${stamp}`,
          createdById: admin.id
        })
        .returning()
      const [collection] = await tx
        .insert(collectionsTable)
        .values({
          slug: `visibility_collection_${stamp}`,
          title: `Visibility collection ${stamp}`,
          createdById: admin.id
        })
        .returning()
      collectionIds.push(collection.id)
      for (const term of [listed, moderated]) {
        await tx.insert(statementsTable).values([
          {
            predicate: "dcterms:subject",
            subjectTermId: term.id,
            objectConceptId: facet.id,
            assertedById: admin.id
          },
          {
            predicate: "skos:member",
            subjectCollectionId: collection.id,
            objectTermId: term.id,
            assertedById: admin.id
          }
        ])
      }
      await tx.insert(statementsTable).values({
        predicate: "skos:broader",
        subjectTermId: listed.id,
        objectTermId: moderated.id,
        assertedById: admin.id
      })
      return {
        admin,
        contributor,
        listed,
        moderated,
        definitions,
        facet,
        collection
      }
    })
    const {
      admin,
      contributor,
      listed,
      moderated,
      definitions,
      facet,
      collection
    } = fixture
    const adminCaller = appRouter.createCaller(context(admin.id))
    const contributorCaller = appRouter.createCaller(context(contributor.id))
    const hideInput = {
      termId: moderated.id,
      hidden: true,
      reason: "Reviewed production test entry",
      expectedVersion: 0
    }

    for (const caller of [publicCaller, contributorCaller]) {
      const code = caller === publicCaller ? "UNAUTHORIZED" : "FORBIDDEN"
      await assert.rejects(caller.admin.moderation.terms(), { code })
      await assert.rejects(caller.admin.moderation.history(moderated.id), {
        code
      })
      await assert.rejects(caller.admin.moderation.setVisibility(hideInput), {
        code
      })
    }
    await assert.rejects(
      db.transaction((tx) =>
        changeTermVisibility(tx, { ...hideInput, actorId: contributor.id })
      ),
      { code: "FORBIDDEN" },
      "the service independently enforces administrator access"
    )
    await assert.rejects(
      adminCaller.admin.moderation.setVisibility({
        ...hideInput,
        reason: "  "
      }),
      { code: "BAD_REQUEST" }
    )
    assert.equal(
      await eventCount(),
      0,
      "denied and invalid actions create no history"
    )
    assert.equal(
      (await publicCaller.search.terms({ query: needle, limit: 50 })).length,
      2
    )

    const raced = await Promise.allSettled([
      adminCaller.admin.moderation.setVisibility(hideInput),
      adminCaller.admin.moderation.setVisibility(hideInput)
    ])
    assert.equal(
      raced.filter((result) => result.status === "fulfilled").length,
      1
    )
    const rejected = raced.find((result) => result.status === "rejected")
    assert.ok(rejected?.status === "rejected")
    assert.equal(
      rejected.reason.code,
      "CONFLICT",
      "concurrent outdated decisions are rejected"
    )
    assert.equal(await eventCount(), 1)
    const [hidden] = await listTermVisibility({
      query: moderated.term,
      status: "hidden"
    })
    assert.equal(hidden.id, moderated.id)
    assert.equal(hidden.visibilityVersion, 1)
    assert.equal(hidden.hiddenReason, hideInput.reason)
    const noOp = await adminCaller.admin.moderation.setVisibility({
      ...hideInput,
      expectedVersion: 1
    })
    assert.equal(noOp.changed, false)
    assert.equal(
      await eventCount(),
      1,
      "a repeated decision is not another history event"
    )
    await assert.rejects(
      adminCaller.admin.moderation.setVisibility({
        ...hideInput,
        hidden: false
      }),
      { code: "CONFLICT" },
      "an old page cannot undo a newer decision"
    )

    const search = await publicCaller.search.terms({ query: needle, limit: 50 })
    assert.deepEqual(
      search.map((term) => term.id),
      [listed.id]
    )
    const lookup = await publicCaller.search.termLookup({
      query: needle,
      limit: 50
    })
    assert.deepEqual(
      lookup.map((term) => term.id),
      [listed.id]
    )
    const definitionSearch = await publicCaller.search.definitions({
      query: needle,
      limit: 50
    })
    assert.deepEqual(
      definitionSearch.map((definition) => definition.id),
      [definitions[0].definition.id]
    )
    const facets = await publicCaller.search.facets({ query: needle })
    assert.equal(facets.find((row) => row.id === facet.id)?.count, 1)
    const faceted = await publicCaller.search.terms({
      query: needle,
      limit: 50,
      facets: [`${facetSlug}:fixture`]
    })
    assert.deepEqual(
      faceted.map((term) => term.id),
      [listed.id]
    )
    const termList = await publicCaller.terms.list()
    assert.ok(termList.terms.some((term) => term.id === listed.id))
    assert.ok(!termList.terms.some((term) => term.id === moderated.id))
    const hiddenTopic = await contributorCaller.tags.create({
      name: moderated.term
    })
    topicIds.push(hiddenTopic.id)
    assert.deepEqual(
      hiddenTopic.matchedTerms,
      [],
      "new topics do not offer hidden terms as bridge candidates"
    )
    const existingHiddenTopic = await contributorCaller.tags.create({
      name: moderated.term
    })
    assert.equal(
      existingHiddenTopic.id,
      hiddenTopic.id,
      "topic identity lookup still finds the existing concept"
    )
    assert.deepEqual(
      existingHiddenTopic.matchedTerms,
      [],
      "existing topics do not offer hidden terms as bridge candidates"
    )
    const listedTopic = await contributorCaller.tags.create({
      name: listed.term
    })
    topicIds.push(listedTopic.id)
    assert.deepEqual(
      listedTopic.matchedTerms.map((term) => term.id),
      [listed.id],
      "listed terms remain available as bridge candidates"
    )
    const discussion = await publicCaller.discussion.recent({ limit: 50 })
    assert.ok(discussion.some((term) => term.id === listed.id))
    assert.ok(!discussion.some((term) => term.id === moderated.id))
    assert.equal(
      discussion.find((term) => term.id === listed.id)?.def.comments,
      1
    )
    assert.deepEqual(
      (await collectionMembers(collection.id)).map((term) => term.id),
      [listed.id]
    )
    assert.equal(
      (await collectionsWithCounts()).find((row) => row.id === collection.id)
        ?.members,
      1
    )
    assert.equal(
      (await conceptsOfScheme(facetSlug)).find((row) => row.id === facet.id)
        ?.terms,
      1
    )

    const currentKos = await loadKos()
    assert.ok(!currentKos.terms.some((term) => term.id === moderated.id))
    assert.ok(
      !currentKos.statements.some(
        (statement) =>
          statement.subjectTermId === moderated.id ||
          statement.objectTermId === moderated.id
      )
    )
    const currentSkos = await buildTermsSkos(currentKos, termIds)
    assert.deepEqual(
      currentSkos.map((term) => term.id),
      [listed.id]
    )
    const hiddenUri = termUri(moderated.slug, moderated.vocabularySlug)
    assert.ok(
      !kosTurtle(currentKos).includes(hiddenUri),
      "bulk KOS exports omit hidden memberships and relations"
    )
    assert.ok(
      !termTurtle(currentSkos[0], currentKos).includes(hiddenUri),
      "bulk term descriptions omit relations to hidden terms"
    )
    assert.equal(
      await buildTermSkos(moderated.id, undefined, { includeHidden: false }),
      null
    )
    const historicalKos = await loadKos({ includeHidden: true })
    const directSkos = await buildTermSkos(moderated.id, historicalKos)
    assert.ok(directSkos)
    assert.equal(directSkos.hiddenFromListings, true)
    assert.ok(
      termTurtle(directSkos, historicalKos).includes(
        "matsci:hiddenFromListings true"
      )
    )
    assert.equal(
      termJsonLd(directSkos, historicalKos)["matsci:hiddenFromListings"],
      true
    )
    assert.ok(new KosView(historicalKos).termOrNull(moderated.id))
    const directProvenance = await buildTermProvenance(moderated.id)
    assert.ok(directProvenance)
    assert.ok(
      provenanceTurtle(directProvenance).includes(
        definitions[1].comment.message
      )
    )
    const historicalData = await loadProvenanceDatasetData()
    assert.ok(
      historicalData.definitions.some(
        (definition) => definition.id === definitions[1].definition.id
      )
    )
    const historicalTurtle = provenanceDatasetBlocksTurtle(
      new ProvenanceDatasetView(historicalData)
    )
    assert.ok(
      historicalTurtle.includes(`<${hiddenUri}> matsci:hiddenFromListings true`)
    )

    await db
      .transaction(async (tx) => {
        await runInvariants(tx)
        const expectInvariant = async (
          change: (sp: Tx) => Promise<unknown>,
          message: string
        ) => {
          await assert.rejects(
            tx.transaction(async (sp) => {
              await change(sp)
              await runInvariants(sp)
            }),
            (error: unknown) => {
              const cause = (
                error as { cause?: { message?: string; code?: string } }
              ).cause
              assert.equal(cause?.code, "P0001")
              assert.ok(
                cause?.message?.includes(message),
                `expected invariant: ${message}`
              )
              return true
            }
          )
        }
        await expectInvariant(
          (sp) =>
            sp
              .update(termsTable)
              .set({ visibilityVersion: 0 })
              .where(eq(termsTable.id, moderated.id)),
          "term visibility version differs"
        )
        await expectInvariant(
          (sp) =>
            sp
              .update(termsTable)
              .set({ hiddenReason: "Unrecorded edit" })
              .where(eq(termsTable.id, moderated.id)),
          "term visibility state differs"
        )
        await expectInvariant(async (sp) => {
          await sp.insert(termVisibilityEventsTable).values({
            termId: listed.id,
            actorId: admin.id,
            action: "restore",
            reason: "Impossible first event"
          })
          await sp
            .update(termsTable)
            .set({ visibilityVersion: 1 })
            .where(eq(termsTable.id, listed.id))
        }, "term visibility history does not alternate")
        await runInvariants(tx)
        throw new Rollback()
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error
      })

    const restored = await adminCaller.admin.moderation.setVisibility({
      termId: moderated.id,
      hidden: false,
      reason: "Reviewed and approved for discovery",
      expectedVersion: 1
    })
    assert.equal(restored.changed, true)
    assert.equal(restored.term.id, moderated.id)
    assert.equal(restored.term.visibilityVersion, 2)
    assert.equal(restored.term.hiddenAt, null)
    assert.equal(restored.term.hiddenById, null)
    assert.equal(restored.term.hiddenReason, null)
    const restoredNoOp = await adminCaller.admin.moderation.setVisibility({
      termId: moderated.id,
      hidden: false,
      reason: "Still approved",
      expectedVersion: 2
    })
    assert.equal(restoredNoOp.changed, false)
    assert.equal(
      await eventCount(),
      2,
      "restoring an already listed term adds no decision"
    )
    assert.deepEqual(
      (await publicCaller.search.terms({ query: needle, limit: 50 }))
        .map((term) => term.id)
        .sort(),
      [...termIds].sort()
    )
    assert.equal(
      (await collectionsWithCounts()).find((row) => row.id === collection.id)
        ?.members,
      2
    )
    const restoredTopic = await contributorCaller.tags.create({
      name: moderated.term
    })
    assert.equal(restoredTopic.id, hiddenTopic.id)
    assert.deepEqual(
      restoredTopic.matchedTerms.map((term) => term.id),
      [moderated.id],
      "restoration returns the same term to bridge candidates"
    )
    const history = await termVisibilityHistory(moderated.id)
    assert.deepEqual(
      history.map((event) => event.action),
      ["restore", "hide"]
    )
    assert.ok(history.every((event) => event.actorName === admin.name))
    const retained = await db.query.definitionsTable.findFirst({
      where: eq(definitionsTable.id, definitions[1].definition.id)
    })
    assert.equal(retained?.currentRevisionId, definitions[1].revision.id)
    assert.equal(
      retained?.definitionNumber,
      definitions[1].definition.definitionNumber
    )
    const retainedComment = await db.query.commentsTable.findFirst({
      where: eq(commentsTable.id, definitions[1].comment.id)
    })
    assert.deepEqual(
      retainedComment,
      definitions[1].comment,
      "hide and restore preserve exact comments and revision targets"
    )
    await db.transaction(runInvariants)
    console.log(
      "Term visibility database checks passed: admin access, races, history invariants, discovery counts/feeds, exports and restoration."
    )
  } finally {
    if (userIds.length)
      await db.transaction(async (tx) => {
        if (termIds.length) {
          await tx
            .delete(termVisibilityEventsTable)
            .where(inArray(termVisibilityEventsTable.termId, termIds))
          await tx
            .delete(statementsTable)
            .where(
              or(
                inArray(statementsTable.subjectTermId, termIds),
                inArray(statementsTable.objectTermId, termIds)
              )
            )
          const definitions = await tx
            .select({ id: definitionsTable.id })
            .from(definitionsTable)
            .where(inArray(definitionsTable.termId, termIds))
          for (const definition of definitions)
            await deleteDefinitionRows(tx, definition.id)
          await tx.delete(termsTable).where(inArray(termsTable.id, termIds))
        }
        if (collectionIds.length)
          await tx
            .delete(collectionsTable)
            .where(inArray(collectionsTable.id, collectionIds))
        if (schemeIds.length) {
          await tx
            .delete(conceptsTable)
            .where(inArray(conceptsTable.schemeId, schemeIds))
          await tx
            .delete(conceptSchemesTable)
            .where(inArray(conceptSchemesTable.id, schemeIds))
        }
        if (topicIds.length)
          await tx
            .delete(conceptsTable)
            .where(inArray(conceptsTable.id, topicIds))
        await tx.delete(usersTable).where(inArray(usersTable.id, userIds))
      })
  }
}

// A real Next request work context lets moderation revalidation run unchanged.
workAsyncStorage
  .run(
    { route: "/api/trpc", incrementalCache: {} } as unknown as Parameters<
      typeof workAsyncStorage.run
    >[0],
    main
  )
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
