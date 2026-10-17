import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external"
import { deleteDefinitionRows } from "../lib/definition-purge"
import {
  collectionsTable,
  communitiesTable,
  communityMembersTable,
  contributionSubmissionsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  statementsTable,
  termsTable,
  usersTable,
  vocabulariesTable
} from "../drizzle"
import {
  commitSetupImport,
  createSetupTerm,
  createSetupVocabulary,
  previewSetupImport,
  requireSetupVocabularyForContribution,
  setupOptions,
  type SetupImportInput
} from "../lib/setup-service"

class Rollback extends Error {}
const rejected = async (operation: Promise<unknown>, code: string) =>
  assert.rejects(operation, (error: { code?: string }) => error.code === code)

async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(
    url.pathname,
    /_(?:test|scratch|ci|qa)(?:_|$)/,
    "Use an explicitly disposable database"
  )
  const stamp = randomUUID().replaceAll("-", "")
  try {
    await db.transaction(async (tx) => {
      const actors = await tx
        .insert(usersTable)
        .values([
          { name: `Setup admin ${stamp}`, role: "admin" },
          { name: `Setup member ${stamp}`, role: "user" },
          { name: `Setup outsider ${stamp}`, role: "user" },
          { name: "", role: "user" }
        ])
        .returning({ id: usersTable.id })
      const [admin, member, outsider, nameless] = actors
      const vocabulary = await createSetupVocabulary(
        tx,
        { title: `Setup ${stamp}` },
        admin.id
      )
      const second = await createSetupVocabulary(
        tx,
        { title: `Setup ${stamp}` },
        admin.id
      )
      assert.notEqual(
        vocabulary.slug,
        second.slug,
        "Vocabulary title collisions receive distinct stable slugs"
      )
      await rejected(
        createSetupVocabulary(tx, { title: `Denied ${stamp}` }, outsider.id),
        "FORBIDDEN"
      )
      const [communityVocabulary] = await tx
        .insert(vocabulariesTable)
        .values({
          slug: `community_${stamp}`,
          title: "Community terms",
          createdById: admin.id
        })
        .returning()
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug: communityVocabulary.slug,
          vocabularySlug: communityVocabulary.slug,
          title: "Community",
          createdById: admin.id
        })
        .returning()
      const [membership] = await tx
        .insert(communityMembersTable)
        .values({
          communityId: community.id,
          userId: member.id,
          addedById: admin.id,
          role: "steward"
        })
        .returning()
      const [collection] = await tx
        .insert(collectionsTable)
        .values({
          slug: `collection_${stamp}`,
          title: "Curated collection",
          createdById: admin.id,
          assertableBy: "curator"
        })
        .returning()
      await requireSetupVocabularyForContribution(
        tx,
        vocabulary.slug,
        outsider.id
      )
      await requireSetupVocabularyForContribution(
        tx,
        communityVocabulary.slug,
        member.id
      )
      await rejected(
        requireSetupVocabularyForContribution(
          tx,
          communityVocabulary.slug,
          outsider.id
        ),
        "FORBIDDEN"
      )
      await rejected(
        requireSetupVocabularyForContribution(tx, vocabulary.slug, nameless.id),
        "PRECONDITION_FAILED"
      )
      const options = await setupOptions(member.id, tx)
      assert.equal(
        options.communities.find((item) => item.id === community.id)
          ?.canManageWorklist,
        true
      )
      assert.equal(
        options.vocabularies.find((item) => item.slug === vocabulary.slug)
          ?.canContribute,
        true
      )
      assert.equal(
        options.collections.some((item) => item.id === collection.id),
        false
      )
      const input: SetupImportInput = {
        vocabularySlug: vocabulary.slug,
        collectionId: collection.id,
        format: "csv",
        text: "term,definition\nCrystal,A structure with periodic order.\nIron,A chemical element.\nCRYSTAL,A structure with periodic order."
      }
      await rejected(previewSetupImport(tx, input, outsider.id), "FORBIDDEN")
      const preview = await previewSetupImport(tx, input, admin.id)
      assert.equal(preview.canImport, true)
      assert.equal(preview.newCount, 2)
      assert.equal(preview.duplicateCount, 1)
      await rejected(
        commitSetupImport(
          tx,
          { ...input, text: input.text.replace("Iron", "Copper") },
          preview.previewToken,
          admin.id
        ),
        "CONFLICT"
      )
      const imported = await commitSetupImport(
        tx,
        input,
        preview.previewToken,
        admin.id
      )
      assert.equal(imported.created, 2)
      assert.equal(imported.collectionAdded, 2)
      const definitions = await tx
        .select({
          authorId: definitionsTable.authorId,
          revisionId: definitionsTable.currentRevisionId,
          definition: definitionsTable.definition,
          editorId: definitionRevisionsTable.editorId,
          version: definitionRevisionsTable.version,
          source: definitionRevisionsTable.source,
          changeNote: definitionRevisionsTable.changeNote
        })
        .from(definitionsTable)
        .innerJoin(
          definitionRevisionsTable,
          eq(definitionRevisionsTable.id, definitionsTable.currentRevisionId)
        )
        .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
        .where(eq(termsTable.vocabularySlug, vocabulary.slug))
      assert.equal(definitions.length, 2)
      for (const definition of definitions) {
        assert.equal(definition.authorId, admin.id)
        assert.equal(definition.editorId, admin.id)
        assert.equal(definition.version, 1)
        assert.equal(definition.source, "initial")
        assert.match(definition.changeNote ?? "", /imported/)
        assert.ok(definition.revisionId)
      }
      const assertions = await tx
        .select()
        .from(statementsTable)
        .where(eq(statementsTable.subjectCollectionId, collection.id))
      assert.equal(assertions.length, 2)
      assert.ok(assertions.every((row) => row.assertedById === admin.id))
      await rejected(
        commitSetupImport(tx, input, preview.previewToken, admin.id),
        "CONFLICT"
      )
      const reuseInput = {
        ...input,
        text: "term,definition\nIRON,A different definition that must not overwrite.\nCrystal,"
      }
      const reusePreview = await previewSetupImport(tx, reuseInput, admin.id)
      assert.equal(reusePreview.newCount, 0)
      assert.equal(reusePreview.reuseCount, 2)
      const reused = await commitSetupImport(
        tx,
        reuseInput,
        reusePreview.previewToken,
        admin.id
      )
      assert.equal(reused.reused, 2)
      assert.equal(reused.collectionAdded, 0)
      assert.equal(
        (
          await tx
            .select()
            .from(definitionsTable)
            .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
            .where(eq(termsTable.vocabularySlug, vocabulary.slug))
        ).length,
        2
      )
      const [iron] = await tx
        .select({ definition: definitionsTable.definition })
        .from(definitionsTable)
        .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
        .where(
          and(
            eq(termsTable.vocabularySlug, vocabulary.slug),
            eq(termsTable.term, "iron")
          )
        )
      assert.equal(iron.definition, "A chemical element.")
      const [receipts] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(contributionSubmissionsTable)
        .where(eq(contributionSubmissionsTable.userId, admin.id))
      assert.equal(
        receipts.count,
        2,
        "Reusing definitions creates no publication or quota receipt"
      )
      const excessive = await previewSetupImport(
        tx,
        {
          ...input,
          text: `term,definition\n${Array.from({ length: 6 }, (_, i) => `New ${i},Definition ${i}`).join("\n")}`
        },
        admin.id
      )
      assert.equal(excessive.canImport, false)
      // The limit applies to the whole transaction. A batch that exceeds the
      // remaining allowance cannot leave its first few rows behind.
      const quotaInput = {
        ...input,
        text: "term,definition\nQuota A,First.\nQuota B,Second.\nQuota C,Third.\nQuota D,Fourth."
      }
      const quotaPreview = await previewSetupImport(tx, quotaInput, admin.id)
      await rejected(
        tx.transaction((sp) =>
          commitSetupImport(sp, quotaInput, quotaPreview.previewToken, admin.id)
        ),
        "TOO_MANY_REQUESTS"
      )
      assert.equal(
        (
          await tx
            .select()
            .from(termsTable)
            .where(
              and(
                eq(termsTable.vocabularySlug, vocabulary.slug),
                sql`${termsTable.term} like 'quota%'`
              )
            )
        ).length,
        0
      )
      assert.equal(
        (
          await tx
            .select()
            .from(contributionSubmissionsTable)
            .where(eq(contributionSubmissionsTable.userId, admin.id))
        ).length,
        2
      )
      // A preview does not retain authority after a membership or collection
      // has changed. Rechecks run in the transaction that publishes the batch.
      const communityInput: SetupImportInput = {
        vocabularySlug: communityVocabulary.slug,
        text: "term,definition\nMember term,Definition.",
        format: "csv"
      }
      const memberPreview = await previewSetupImport(
        tx,
        communityInput,
        member.id
      )
      await tx
        .update(communityMembersTable)
        .set({ removedAt: sql`now()`, removedById: admin.id })
        .where(eq(communityMembersTable.id, membership.id))
      await rejected(
        commitSetupImport(
          tx,
          communityInput,
          memberPreview.previewToken,
          member.id
        ),
        "FORBIDDEN"
      )
      const retirePreview = await previewSetupImport(tx, input, admin.id)
      await tx
        .update(collectionsTable)
        .set({ retiredAt: sql`now()` })
        .where(eq(collectionsTable.id, collection.id))
      await rejected(
        commitSetupImport(tx, input, retirePreview.previewToken, admin.id),
        "BAD_REQUEST"
      )
      await tx
        .update(collectionsTable)
        .set({ retiredAt: null })
        .where(eq(collectionsTable.id, collection.id))
      await tx
        .update(vocabulariesTable)
        .set({ retiredAt: sql`now()` })
        .where(eq(vocabulariesTable.slug, vocabulary.slug))
      await rejected(previewSetupImport(tx, input, admin.id), "BAD_REQUEST")
      await tx
        .update(vocabulariesTable)
        .set({ retiredAt: null })
        .where(eq(vocabulariesTable.slug, vocabulary.slug))
      const term = await createSetupTerm(
        tx,
        {
          vocabularySlug: second.slug,
          term: "Activity",
          definition: "A scientific activity."
        },
        outsider.id
      )
      assert.equal(
        term.slug,
        "activity_2",
        "Reserved term child routes remain reserved"
      )
      await rejected(
        createSetupTerm(
          tx,
          {
            vocabularySlug: second.slug,
            term: "Activity",
            definition: "Duplicate."
          },
          outsider.id
        ),
        "CONFLICT"
      )
      await tx.execute(sql.raw("SET CONSTRAINTS ALL IMMEDIATE"))
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  await testExplicitContributionRoutes(stamp)
  console.log(
    "Setup database permissions, import atomicity, retry, quota, and provenance tests passed"
  )
}

async function testExplicitContributionRoutes(stamp: string) {
  process.env.GRAPH_PROJECTION_ENABLED = "false"
  process.env.SYSTEM_PROMPT_KEY ??= "materials-reference"
  const [{ definitionsRouter }, { setupRouter }, { termsRouter }] =
    await Promise.all([
      import("../trpc/routers/definitions"),
      import("../trpc/routers/setup"),
      import("../trpc/routers/terms")
    ])
  const fixture = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(usersTable)
      .values({ name: `Setup router ${stamp}` })
      .returning({ id: usersTable.id })
    const vocabularies = await tx
      .insert(vocabulariesTable)
      .values([
        {
          slug: `standalone_${stamp}`,
          title: "Standalone router fixture",
          createdById: user.id
        },
        {
          slug: `active_${stamp}`,
          title: "Active router fixture",
          createdById: user.id
        },
        {
          slug: `foreign_${stamp}`,
          title: "Foreign router fixture",
          createdById: user.id
        }
      ])
      .returning({ slug: vocabulariesTable.slug })
    const communities = await tx
      .insert(communitiesTable)
      .values(
        vocabularies.slice(1).map((vocabulary) => ({
          slug: vocabulary.slug,
          vocabularySlug: vocabulary.slug,
          title: vocabulary.slug,
          createdById: user.id
        }))
      )
      .returning({ id: communitiesTable.id })
    const [membership] = await tx
      .insert(communityMembersTable)
      .values({
        communityId: communities[0].id,
        userId: user.id,
        addedById: user.id,
        role: "member"
      })
      .returning({ id: communityMembersTable.id })
    await tx
      .update(usersTable)
      .set({ activeCommunityId: communities[0].id })
      .where(eq(usersTable.id, user.id))
    return { user, vocabularies, communities, membership }
  })
  const [standalone, active, foreign] = fixture.vocabularies
  const context = { session: { id: fixture.user.id } } as never
  const definitions = definitionsRouter.createCaller(context)
  const setup = setupRouter.createCaller(context)
  try {
    const options = await setup.options()
    assert.equal(options.defaultVocabularySlug, active.slug)
    await rejected(
      setup.createVocabulary({ title: "Unauthorized vocabulary" }),
      "FORBIDDEN"
    )
    const selection = await termsRouter
      .createCaller(context)
      .list({ vocabularySlug: standalone.slug })
    assert.equal(selection.targetVocabulary.slug, standalone.slug)
    const created = await definitions.create({
      vocabularySlug: standalone.slug,
      expectedVocabularySlug: standalone.slug,
      term: `Explicit ${stamp}`,
      definition: "An explicit vocabulary contribution."
    })
    assert.equal(
      created.term.vocabularySlug,
      standalone.slug,
      "Explicit target is independent of the active community"
    )
    const inherited = await definitions.create({
      expectedVocabularySlug: active.slug,
      term: `Inherited ${stamp}`,
      definition: "An active-community contribution."
    })
    assert.equal(
      inherited.term.vocabularySlug,
      active.slug,
      "Legacy active community behavior remains available"
    )
    const raceInput: SetupImportInput = {
      vocabularySlug: standalone.slug,
      text: `term,definition\nConcurrent ${stamp},A concurrently submitted import.`,
      format: "csv"
    }
    const racePreview = await setup.previewImport(raceInput)
    const races = await Promise.allSettled([
      setup.importTerms({
        ...raceInput,
        previewToken: racePreview.previewToken
      }),
      setup.importTerms({
        ...raceInput,
        previewToken: racePreview.previewToken
      })
    ])
    assert.equal(
      races.filter((result) => result.status === "fulfilled").length,
      1
    )
    const failedRace = races.find((result) => result.status === "rejected")
    assert.ok(failedRace && failedRace.status === "rejected")
    assert.equal(
      failedRace.reason.code,
      "CONFLICT",
      "Concurrent imports publish exactly once"
    )
    await rejected(
      definitions.create({
        vocabularySlug: standalone.slug,
        expectedVocabularySlug: active.slug,
        term: `Stale ${stamp}`,
        definition: "A stale selection."
      }),
      "CONFLICT"
    )
    await rejected(
      definitions.create({
        vocabularySlug: foreign.slug,
        term: `Foreign ${stamp}`,
        definition: "An unauthorized contribution."
      }),
      "FORBIDDEN"
    )
    assert.ok(created.definition.currentRevisionId)
    await rejected(
      definitions.create({
        vocabularySlug: standalone.slug,
        term: created.term.term,
        definition: "An invalid derived override.",
        derivedFromRevisionId: created.definition.currentRevisionId
      }),
      "BAD_REQUEST"
    )
    await db
      .update(vocabulariesTable)
      .set({ retiredAt: sql`now()` })
      .where(eq(vocabulariesTable.slug, standalone.slug))
    await rejected(
      definitions.create({
        vocabularySlug: standalone.slug,
        term: `Retired ${stamp}`,
        definition: "A retired contribution."
      }),
      "BAD_REQUEST"
    )
    await db
      .update(communityMembersTable)
      .set({ removedAt: sql`now()`, removedById: fixture.user.id })
      .where(eq(communityMembersTable.id, fixture.membership.id))
    await rejected(
      definitions.create({
        vocabularySlug: active.slug,
        term: `Removed ${stamp}`,
        definition: "A removed-member contribution."
      }),
      "FORBIDDEN"
    )
    await rejected(
      setupRouter.createCaller({ session: {} } as never).previewImport({
        vocabularySlug: standalone.slug,
        text: "term,definition\nAnonymous,Definition.",
        format: "csv"
      }),
      "UNAUTHORIZED"
    )
  } finally {
    await db.transaction(async (tx) => {
      const vocabularySlugs = fixture.vocabularies.map(
        (vocabulary) => vocabulary.slug
      )
      const definitions = await tx
        .select({ id: definitionsTable.id })
        .from(definitionsTable)
        .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
        .where(inArray(termsTable.vocabularySlug, vocabularySlugs))
      for (const definition of definitions)
        await deleteDefinitionRows(tx, definition.id)
      await tx
        .delete(termsTable)
        .where(inArray(termsTable.vocabularySlug, vocabularySlugs))
      await tx
        .delete(contributionSubmissionsTable)
        .where(eq(contributionSubmissionsTable.userId, fixture.user.id))
      await tx
        .update(usersTable)
        .set({ activeCommunityId: null })
        .where(eq(usersTable.id, fixture.user.id))
      await tx
        .delete(communityMembersTable)
        .where(eq(communityMembersTable.id, fixture.membership.id))
      await tx.delete(communitiesTable).where(
        inArray(
          communitiesTable.id,
          fixture.communities.map((community) => community.id)
        )
      )
      await tx
        .delete(vocabulariesTable)
        .where(inArray(vocabulariesTable.slug, vocabularySlugs))
      await tx.delete(usersTable).where(eq(usersTable.id, fixture.user.id))
    })
  }
}

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
