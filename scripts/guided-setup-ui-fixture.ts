import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { and, eq, inArray, isNull, or } from "drizzle-orm"
import {
  aiContributionSuggestionsTable,
  collectionsTable,
  communitiesTable,
  communityCollectionsTable,
  communityMembersTable,
  contributionFilesTable,
  contributionSubmissionsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  statementsTable,
  termDraftsTable,
  termReferenceLookupsTable,
  termRouteAliasesTable,
  termsTable,
  usersTable,
  vocabulariesTable
} from "../drizzle"
import { deleteDefinitionRows } from "../lib/definition-purge"
import { diffToStringSimple } from "../lib/definition-comparison"
import { definitionPath, termPath } from "../lib/public-identifiers"

export type GuidedSetupFixture = {
  token: string
  userId: number
  userName: string
  communityId: number
  communitySlug: string
  communityTitle: string
  vocabularySlug: string
  vocabularyTitle: string
  collectionId: number
  collectionSlug: string
  collectionTitle: string
}

function requireDisposableDatabase() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "Guided setup UI fixtures require a local database"
  )
  assert.match(
    url.pathname,
    /_(?:qa|test|ci|scratch)(?:_|$)/,
    "Guided setup UI fixtures require an explicitly disposable database"
  )
  assert.equal(
    process.env.GRAPH_PROJECTION_ENABLED,
    "false",
    "Disable graph projection before creating or removing UI fixtures"
  )
}

/** Seed only prerequisites: the browser must create the term itself. */
export async function createGuidedSetupFixture(): Promise<GuidedSetupFixture> {
  requireDisposableDatabase()
  const token = randomUUID().replaceAll("-", "")
  const slug = `setup_ui_${token}`
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(usersTable)
      .values({ name: `Setup UI member ${token}`, role: "user" })
      .returning()
    const [vocabulary] = await tx
      .insert(vocabulariesTable)
      .values({
        slug,
        title: `Setup UI vocabulary ${token}`,
        createdById: user.id
      })
      .returning()
    const [community] = await tx
      .insert(communitiesTable)
      .values({
        slug,
        vocabularySlug: slug,
        title: `Setup UI community ${token}`,
        createdById: user.id
      })
      .returning()
    await tx.insert(communityMembersTable).values({
      communityId: community.id,
      userId: user.id,
      role: "member",
      addedById: user.id
    })
    const [collection] = await tx
      .insert(collectionsTable)
      .values({
        slug,
        title: `Setup UI collection ${token}`,
        assertableBy: "contributor",
        createdById: user.id
      })
      .returning()
    await tx.insert(communityCollectionsTable).values({
      communityId: community.id,
      collectionId: collection.id,
      addedById: user.id
    })
    assert.deepEqual(
      await tx
        .select({ id: termsTable.id })
        .from(termsTable)
        .where(eq(termsTable.vocabularySlug, vocabulary.slug)),
      [],
      "No term is seeded by the guided setup fixture"
    )
    return {
      token,
      userId: user.id,
      userName: user.name!,
      communityId: community.id,
      communitySlug: community.slug,
      communityTitle: community.title,
      vocabularySlug: vocabulary.slug,
      vocabularyTitle: vocabulary.title,
      collectionId: collection.id,
      collectionSlug: collection.slug,
      collectionTitle: collection.title
    }
  })
}

/** Verify the browser produced exactly one complete contribution. */
export async function verifyGuidedSetupPublication(
  fixture: GuidedSetupFixture,
  expectedTerm: string,
  expectedDefinition: string
) {
  requireDisposableDatabase()
  const terms = await db
    .select()
    .from(termsTable)
    .where(eq(termsTable.vocabularySlug, fixture.vocabularySlug))
  assert.equal(terms.length, 1, "Exactly one term was published")
  const term = terms[0]
  assert.equal(term.term, expectedTerm.trim().toLowerCase())
  const definitions = await db
    .select()
    .from(definitionsTable)
    .where(eq(definitionsTable.termId, term.id))
  assert.equal(definitions.length, 1, "Exactly one definition was published")
  const definition = definitions[0]
  assert.equal(definition.authorId, fixture.userId)
  assert.equal(definition.definition, expectedDefinition.trim())
  const revisions = await db
    .select()
    .from(definitionRevisionsTable)
    .where(eq(definitionRevisionsTable.definitionId, definition.id))
  assert.equal(revisions.length, 1, "Publication created one initial revision")
  const revision = revisions[0]
  assert.equal(revision.id, definition.currentRevisionId)
  assert.equal(revision.version, 1)
  assert.equal(revision.editorId, fixture.userId)
  assert.equal(revision.source, "initial")
  assert.equal(
    diffToStringSimple(revision.definitionDiff),
    expectedDefinition.trim()
  )
  const membership = await db
    .select()
    .from(statementsTable)
    .where(
      and(
        eq(statementsTable.predicate, "skos:member"),
        eq(statementsTable.subjectCollectionId, fixture.collectionId),
        eq(statementsTable.objectTermId, term.id),
        isNull(statementsTable.retractedAt)
      )
    )
  assert.equal(membership.length, 1, "The chosen collection contains the term")
  assert.equal(membership[0].assertedById, fixture.userId)
  return {
    termId: term.id,
    definitionId: definition.id,
    revisionId: revision.id,
    publicPath: termPath(term.slug, term.vocabularySlug),
    definitionPath: definitionPath(
      term.slug,
      definition.definitionNumber,
      term.vocabularySlug
    )
  }
}

/** Remove only this uniquely identified fixture, including failed-run drafts. */
export async function removeGuidedSetupFixture(fixture: GuidedSetupFixture) {
  requireDisposableDatabase()
  assert.match(fixture.token, /^[a-f0-9]{32}$/)
  assert.equal(fixture.vocabularySlug, `setup_ui_${fixture.token}`)
  await db.transaction(async (tx) => {
    const user = await tx.query.usersTable.findFirst({
      where: eq(usersTable.id, fixture.userId)
    })
    assert.ok(user, "The fixture account must still exist")
    assert.equal(user.name, `Setup UI member ${fixture.token}`)
    assert.equal(user.name, fixture.userName)
    const vocabulary = await tx.query.vocabulariesTable.findFirst({
      where: eq(vocabulariesTable.slug, fixture.vocabularySlug)
    })
    const community = await tx.query.communitiesTable.findFirst({
      where: eq(communitiesTable.id, fixture.communityId)
    })
    const collection = await tx.query.collectionsTable.findFirst({
      where: eq(collectionsTable.id, fixture.collectionId)
    })
    assert.ok(
      vocabulary && community && collection,
      "Fixture prerequisites must still exist"
    )
    assert.equal(vocabulary?.createdById, fixture.userId)
    assert.equal(community?.slug, fixture.vocabularySlug)
    assert.equal(community.createdById, fixture.userId)
    assert.equal(collection?.slug, fixture.vocabularySlug)
    assert.equal(collection.createdById, fixture.userId)

    const ownedDefinitions = await tx
      .select()
      .from(definitionsTable)
      .where(eq(definitionsTable.authorId, fixture.userId))
    const terms = await tx
      .select()
      .from(termsTable)
      .where(
        or(
          eq(termsTable.vocabularySlug, fixture.vocabularySlug),
          ownedDefinitions.length
            ? inArray(
                termsTable.id,
                ownedDefinitions.map((row) => row.termId)
              )
            : undefined
        )
      )
    // A wrong-destination regression is still cleaned up, but only when the
    // term carries this test's UUID and has no other contributor's definition.
    for (const term of terms)
      assert.ok(
        term.vocabularySlug === fixture.vocabularySlug ||
          term.term.includes(fixture.token),
        "Refusing to remove a term outside the fixture's identity"
      )
    const termIds = terms.map((term) => term.id)
    if (termIds.length) {
      const definitions = await tx
        .select()
        .from(definitionsTable)
        .where(inArray(definitionsTable.termId, termIds))
      assert.ok(definitions.every((row) => row.authorId === fixture.userId))
    }

    await tx
      .delete(termDraftsTable)
      .where(eq(termDraftsTable.ownerId, fixture.userId))
    for (const definition of ownedDefinitions)
      await deleteDefinitionRows(tx, definition.id)
    await tx
      .delete(contributionFilesTable)
      .where(eq(contributionFilesTable.uploadedById, fixture.userId))
    await tx
      .delete(aiContributionSuggestionsTable)
      .where(eq(aiContributionSuggestionsTable.requestedById, fixture.userId))
    await tx
      .delete(termReferenceLookupsTable)
      .where(eq(termReferenceLookupsTable.requestedById, fixture.userId))
    await tx
      .delete(statementsTable)
      .where(
        and(
          eq(statementsTable.assertedById, fixture.userId),
          or(
            eq(statementsTable.subjectCollectionId, fixture.collectionId),
            termIds.length
              ? inArray(statementsTable.subjectTermId, termIds)
              : undefined,
            termIds.length
              ? inArray(statementsTable.objectTermId, termIds)
              : undefined
          )
        )
      )
    if (termIds.length) {
      await tx
        .delete(termRouteAliasesTable)
        .where(
          and(
            inArray(termRouteAliasesTable.termId, termIds),
            eq(termRouteAliasesTable.createdById, fixture.userId)
          )
        )
      await tx.delete(termsTable).where(inArray(termsTable.id, termIds))
    }
    await tx
      .delete(contributionSubmissionsTable)
      .where(eq(contributionSubmissionsTable.userId, fixture.userId))
    await tx
      .update(usersTable)
      .set({ activeCommunityId: null })
      .where(eq(usersTable.id, fixture.userId))
    await tx
      .delete(communityCollectionsTable)
      .where(
        and(
          eq(communityCollectionsTable.communityId, fixture.communityId),
          eq(communityCollectionsTable.collectionId, fixture.collectionId),
          eq(communityCollectionsTable.addedById, fixture.userId)
        )
      )
    await tx
      .delete(communityMembersTable)
      .where(
        and(
          eq(communityMembersTable.communityId, fixture.communityId),
          eq(communityMembersTable.userId, fixture.userId)
        )
      )
    await tx
      .delete(collectionsTable)
      .where(eq(collectionsTable.id, fixture.collectionId))
    await tx
      .delete(communitiesTable)
      .where(eq(communitiesTable.id, fixture.communityId))
    await tx
      .delete(vocabulariesTable)
      .where(eq(vocabulariesTable.slug, fixture.vocabularySlug))
    await tx.delete(usersTable).where(eq(usersTable.id, fixture.userId))
  })
}
