import "server-only"

import { createHash } from "node:crypto"
import { TRPCError } from "@trpc/server"
import {
  collectionsTable,
  communitiesTable,
  communityCollectionsTable,
  communityMembersTable,
  db,
  statementsTable,
  termRouteAliasesTable,
  termsTable,
  usersTable,
  vocabulariesTable,
  vocabularyRootRoutesTable
} from "@yamz/db"
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { mayAssertIn, mayCreateCollection } from "./kos"
import { mayRunCommunity } from "./communities"
import { DEFAULT_VOCABULARY_SLUG } from "./public-identifiers"
import {
  CONTRIBUTION_LIMITS,
  definitionSubmissionFingerprint,
  lockContributionSubmissions,
  reserveContributionSubmission
} from "./contribution-guard"
import { createDefinitionWithInitialRevision } from "./definition-revisions"
import { reserveCollectionMembership } from "./collection-membership-lock"
import {
  IMPORT_MAX_ROWS,
  parseImportText,
  planImportRows,
  type ImportFormat,
  type ImportRow
} from "./setup-import"
import { uniqueSlug } from "./slug"
import { publishNewTerm } from "./new-term-publication"

export type SetupTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]
type Executor = typeof db | SetupTransaction
export type SetupImportInput = {
  vocabularySlug: string
  text: string
  format: ImportFormat
  collectionId?: number
}

/** Standalone vocabularies are public contribution spaces; a community's
 * namespace requires membership, as selecting that community already does.
 * Lock community before vocabulary, matching retirement's update order. */
export async function requireSetupVocabularyForContribution(
  executor: Executor,
  vocabularySlug: string,
  userId: number,
  lock = false
) {
  const [user] = await executor
    .select({ id: usersTable.id, role: usersTable.role, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
  if (!user?.name?.trim())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Complete your profile before contributing."
    })
  const communityQuery = executor
    .select({
      id: communitiesTable.id,
      retiredAt: communitiesTable.retiredAt
    })
    .from(communitiesTable)
    .where(eq(communitiesTable.vocabularySlug, vocabularySlug))
  const [community] = await (lock
    ? communityQuery.for("share")
    : communityQuery)
  const vocabularyQuery = executor
    .select({
      slug: vocabulariesTable.slug,
      title: vocabulariesTable.title,
      retiredAt: vocabulariesTable.retiredAt
    })
    .from(vocabulariesTable)
    .where(eq(vocabulariesTable.slug, vocabularySlug))
  const [vocabulary] = await (lock
    ? vocabularyQuery.for("share")
    : vocabularyQuery)
  if (!vocabulary)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This vocabulary doesn't exist."
    })
  if (vocabulary.retiredAt || community?.retiredAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This vocabulary has been retired."
    })
  if (community && user.role !== "admin") {
    const membershipQuery = executor
      .select({ id: communityMembersTable.id })
      .from(communityMembersTable)
      .where(
        and(
          eq(communityMembersTable.communityId, community.id),
          eq(communityMembersTable.userId, userId),
          isNull(communityMembersTable.removedAt)
        )
      )
    const [membership] = await (lock
      ? membershipQuery.for("share")
      : membershipQuery)
    if (!membership)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Join this community before contributing to its vocabulary."
      })
  }
  return vocabulary
}

export async function requireImportCollection(
  executor: Executor,
  collectionId: number | undefined,
  userId: number,
  lock = false
) {
  if (collectionId === undefined) return null
  if (lock) await reserveCollectionMembership(executor, collectionId)
  const query = executor
    .select()
    .from(collectionsTable)
    .where(eq(collectionsTable.id, collectionId))
  const [collection] = await (lock ? query.for("update") : query)
  if (!collection || collection.retiredAt)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an active collection."
    })
  const [user] = await executor
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
  if (!mayAssertIn(collection, user ?? null))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This collection is curated."
    })
  return collection
}

export async function setupOptions(
  userId: number | null,
  executor: Executor = db
) {
  const [user] = userId
    ? await executor
        .select({
          id: usersTable.id,
          name: usersTable.name,
          role: usersTable.role,
          activeCommunityId: usersTable.activeCommunityId
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
    : []
  const [communities, vocabularies, collections, worklists] = await Promise.all(
    [
      executor
        .select({
          id: communitiesTable.id,
          slug: communitiesTable.slug,
          title: communitiesTable.title,
          vocabularySlug: communitiesTable.vocabularySlug,
          memberRole: communityMembersTable.role
        })
        .from(communitiesTable)
        .leftJoin(
          communityMembersTable,
          and(
            eq(communityMembersTable.communityId, communitiesTable.id),
            eq(communityMembersTable.userId, userId ?? -1),
            isNull(communityMembersTable.removedAt)
          )
        )
        .where(isNull(communitiesTable.retiredAt))
        .orderBy(asc(communitiesTable.title)),
      executor
        .select({
          slug: vocabulariesTable.slug,
          title: vocabulariesTable.title,
          communityId: communitiesTable.id,
          communityRetiredAt: communitiesTable.retiredAt
        })
        .from(vocabulariesTable)
        .leftJoin(
          communitiesTable,
          eq(communitiesTable.vocabularySlug, vocabulariesTable.slug)
        )
        .where(isNull(vocabulariesTable.retiredAt))
        .orderBy(asc(vocabulariesTable.title)),
      executor
        .select({
          id: collectionsTable.id,
          slug: collectionsTable.slug,
          title: collectionsTable.title,
          assertableBy: collectionsTable.assertableBy
        })
        .from(collectionsTable)
        .where(isNull(collectionsTable.retiredAt))
        .orderBy(asc(collectionsTable.title)),
      executor
        .select({
          communityId: communityCollectionsTable.communityId,
          collectionId: communityCollectionsTable.collectionId
        })
        .from(communityCollectionsTable)
        .where(isNull(communityCollectionsTable.removedAt))
    ]
  )
  const canContribute = Boolean(user?.name?.trim())
  const communityChoices = communities.map(({ memberRole, ...community }) => ({
    ...community,
    canContribute:
      canContribute && (user?.role === "admin" || memberRole !== null),
    canManageWorklist: mayRunCommunity(
      user ?? null,
      memberRole ? { role: memberRole } : null
    )
  }))
  const activeCommunity = communities.find(
    (community) =>
      community.id === user?.activeCommunityId && community.memberRole
  )
  return {
    userId: user?.id ?? null,
    signedIn: Boolean(user),
    profileComplete: canContribute,
    canCreateCommunity: user?.role === "admin",
    canCreateVocabulary: user?.role === "admin",
    canCreateCollection: mayCreateCollection(user ?? null),
    defaultVocabularySlug:
      activeCommunity?.vocabularySlug ?? DEFAULT_VOCABULARY_SLUG,
    communities: communityChoices,
    vocabularies: vocabularies
      .filter((vocabulary) => !vocabulary.communityRetiredAt)
      .map((vocabulary) => ({
        slug: vocabulary.slug,
        title: vocabulary.title,
        communityId: vocabulary.communityId,
        canContribute:
          canContribute &&
          (vocabulary.communityId === null ||
            Boolean(
              communityChoices.find(
                (community) => community.id === vocabulary.communityId
              )?.canContribute
            ))
      })),
    collections: collections
      .filter((collection) => mayAssertIn(collection, user ?? null))
      .map((collection) => ({
        id: collection.id,
        slug: collection.slug,
        title: collection.title,
        communityIds: worklists
          .filter((worklist) => worklist.collectionId === collection.id)
          .map((worklist) => worklist.communityId)
      })),
    importLimits: {
      maxRows: IMPORT_MAX_ROWS,
      newDefinitionsPerWindow: CONTRIBUTION_LIMITS.definition.count,
      windowMinutes: CONTRIBUTION_LIMITS.definition.seconds / 60
    }
  }
}

async function importPreview(
  executor: Executor,
  input: SetupImportInput,
  userId: number,
  lock = false
) {
  const parsed = parseImportText(input.text, input.format)
  const labels = [
    ...new Set(parsed.rows.map((row) => row.term.trim().toLowerCase()))
  ]
  const existingQuery = executor
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      hiddenAt: termsTable.hiddenAt
    })
    .from(termsTable)
    .where(
      and(
        eq(termsTable.vocabularySlug, input.vocabularySlug),
        inArray(
          sql`lower(btrim(${termsTable.term}))`,
          labels.length ? labels : [""]
        )
      )
    )
  const existing = labels.length
    ? await (lock ? existingQuery.for("share") : existingQuery)
    : []
  const rows = planImportRows(parsed.rows, existing)
  const newCount = rows.filter((row) => row.action === "create").length
  const errors = [...parsed.errors]
  if (newCount > CONTRIBUTION_LIMITS.definition.count)
    errors.push(
      "Import at most five new definitions at a time. The account limit is five definitions in ten minutes."
    )
  const previewToken = createHash("sha256")
    .update(JSON.stringify({ input, userId, rows, errors }))
    .digest("hex")
  return {
    rows,
    errors,
    canImport:
      rows.length > 0 &&
      !errors.length &&
      rows.every((row) => row.action !== "error"),
    newCount,
    reuseCount: rows.filter((row) => row.action === "reuse").length,
    duplicateCount: rows.filter((row) => row.action === "duplicate").length,
    previewToken
  }
}

export async function previewSetupImport(
  executor: Executor,
  input: SetupImportInput,
  userId: number
) {
  await requireSetupVocabularyForContribution(
    executor,
    input.vocabularySlug,
    userId
  )
  await requireImportCollection(executor, input.collectionId, userId)
  return importPreview(executor, input, userId)
}

export async function reservedTermSlugs(
  tx: SetupTransaction,
  vocabularySlug: string
) {
  const [terms, aliases, roots] = await Promise.all([
    tx
      .select({ slug: termsTable.slug })
      .from(termsTable)
      .where(eq(termsTable.vocabularySlug, vocabularySlug)),
    tx
      .select({ slug: termRouteAliasesTable.termSlug })
      .from(termRouteAliasesTable)
      .where(eq(termRouteAliasesTable.vocabularySlug, vocabularySlug)),
    vocabularySlug === DEFAULT_VOCABULARY_SLUG
      ? tx
          .select({ slug: vocabularyRootRoutesTable.slug })
          .from(vocabularyRootRoutesTable)
      : Promise.resolve([])
  ])
  return new Set([
    ...terms.map((row) => row.slug),
    ...aliases.map((row) => row.slug),
    ...roots.map((row) => row.slug),
    ...(vocabularySlug === DEFAULT_VOCABULARY_SLUG
      ? []
      : ["activity", "definitions", "provenance", "rank"])
  ])
}

async function publishImportedTerm(
  tx: SetupTransaction,
  row: ImportRow,
  vocabularySlug: string,
  userId: number,
  reserved: Set<string>,
  imported: boolean
) {
  const term = row.term.trim().toLowerCase()
  await reserveContributionSubmission(tx, {
    userId,
    kind: "definition",
    fingerprint: await definitionSubmissionFingerprint(tx, {
      vocabularySlug,
      term,
      definition: row.definition
    })
  })
  const slug = uniqueSlug(term, reserved)
  reserved.add(slug)
  const [created] = await tx
    .insert(termsTable)
    .values({ vocabularySlug, term, slug })
    .returning({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      vocabularySlug: termsTable.vocabularySlug
    })
  await createDefinitionWithInitialRevision(tx, {
    termId: created.id,
    authorId: userId,
    definition: row.definition,
    example: "",
    source: "initial",
    changeNote: imported
      ? "Initial contribution imported from CSV/TSV"
      : "Initial contribution"
  })
  return created
}

export async function addImportedCollectionMember(
  tx: SetupTransaction,
  collectionId: number,
  termId: number,
  userId: number
) {
  const [active] = await tx
    .select({ id: statementsTable.id })
    .from(statementsTable)
    .where(
      and(
        eq(statementsTable.predicate, "skos:member"),
        eq(statementsTable.subjectCollectionId, collectionId),
        eq(statementsTable.objectTermId, termId),
        isNull(statementsTable.retractedAt)
      )
    )
  if (active) return false
  await tx.insert(statementsTable).values({
    predicate: "skos:member",
    subjectCollectionId: collectionId,
    objectTermId: termId,
    assertedById: userId,
    note: "Added through setup"
  })
  return true
}

export async function commitSetupImport(
  tx: SetupTransaction,
  input: SetupImportInput,
  previewToken: string,
  userId: number
) {
  await lockContributionSubmissions(tx, userId)
  await requireSetupVocabularyForContribution(
    tx,
    input.vocabularySlug,
    userId,
    true
  )
  const collection = await requireImportCollection(
    tx,
    input.collectionId,
    userId,
    true
  )
  // Serializes setup imports; unique indexes also guard competing ordinary
  // publication paths. A conflict rolls the whole batch back for a new preview.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('matsci-sam:setup-import'), hashtext(${input.vocabularySlug}))`
  )
  const preview = await importPreview(tx, input, userId, true)
  if (preview.previewToken !== previewToken)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The vocabulary or import changed. Preview the terms again before importing."
    })
  if (!preview.canImport)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Correct the import errors before publishing."
    })
  const reserved = await reservedTermSlugs(tx, input.vocabularySlug)
  const terms: {
    id: number
    term: string
    slug: string
    vocabularySlug: string
  }[] = []
  let collectionAdded = 0
  for (const row of preview.rows) {
    if (row.action === "duplicate") continue
    const term =
      row.action === "create"
        ? await publishImportedTerm(
            tx,
            row,
            input.vocabularySlug,
            userId,
            reserved,
            true
          )
        : {
            id: row.termId!,
            term: row.term,
            slug: row.termSlug!,
            vocabularySlug: input.vocabularySlug
          }
    terms.push(term)
    if (
      collection &&
      (await addImportedCollectionMember(tx, collection.id, term.id, userId))
    )
      collectionAdded++
  }
  return {
    created: preview.newCount,
    reused: preview.reuseCount,
    collectionAdded,
    terms,
    vocabularySlug: input.vocabularySlug,
    collectionSlug: collection?.slug ?? null
  }
}

export async function createSetupTerm(
  tx: SetupTransaction,
  input: {
    vocabularySlug: string
    term: string
    definition: string
    collectionId?: number
  },
  userId: number
) {
  return (await publishNewTerm(tx, input, userId)).term
}

export async function createSetupVocabulary(
  tx: SetupTransaction,
  input: { title: string; description?: string },
  userId: number
) {
  const [user] = await tx
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
  if (user?.role !== "admin")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a curator can create a vocabulary."
    })
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('matsci-sam:setup-vocabulary'))`
  )
  const [roots, vocabularies] = await Promise.all([
    tx
      .select({ slug: vocabularyRootRoutesTable.slug })
      .from(vocabularyRootRoutesTable),
    tx.select({ slug: vocabulariesTable.slug }).from(vocabulariesTable)
  ])
  const slug = uniqueSlug(
    input.title,
    new Set([...roots, ...vocabularies].map((row) => row.slug)),
    "vocabulary"
  )
  const [vocabulary] = await tx
    .insert(vocabulariesTable)
    .values({
      slug,
      title: input.title,
      description: input.description || null,
      createdById: userId
    })
    .returning({ slug: vocabulariesTable.slug, title: vocabulariesTable.title })
  return vocabulary
}
