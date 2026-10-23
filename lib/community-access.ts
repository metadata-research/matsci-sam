import { TRPCError } from "@trpc/server"
import {
  Column,
  getTableName,
  is,
  eq,
  sql,
  type SQL,
  type SQLWrapper
} from "drizzle-orm"
import {
  db,
  communitiesTable,
  collectionsTable,
  communityMembersTable,
  usersTable,
  termsTable,
  vocabulariesTable
} from "@yamz/db"

export type CommunityTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]
export type CommunityReader = typeof db | CommunityTransaction
export type CommunityVisibility = "public" | "members"

const validViewer = (viewerId: number | null) =>
  viewerId !== null && Number.isSafeInteger(viewerId) && viewerId > 0

// Drizzle removes column qualification inside a single-table SELECT
// projection, including nested SQL. Keep correlated outer identifiers explicit
// so a subquery cannot resolve them to its own similarly named columns.
const qualified = (column: SQLWrapper) =>
  is(column, Column)
    ? sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`
    : column

// The public default is deliberate: unscoped callers cannot accidentally read
// a private vocabulary. Database roles and active membership are checked on
// every query, rather than trusting a role cached in a session.
export function vocabularyContentVisible(
  column: SQLWrapper,
  viewerId: number | null = null
): SQL {
  const memberAccess = validViewer(viewerId)
    ? sql`EXISTS (SELECT 1 FROM "users" access_u WHERE access_u.id=${viewerId} AND access_u.role='admin')
      OR EXISTS (SELECT 1 FROM "communityMembers" access_m
        WHERE access_m."communityId"=access_c.id AND access_m."userId"=${viewerId}
          AND access_m."removedAt" IS NULL)`
    : sql`false`
  return sql`EXISTS (
    SELECT 1 FROM "vocabularies" access_v
    LEFT JOIN "communities" access_c ON access_c."vocabularySlug"=access_v.slug
    WHERE access_v.slug=${qualified(column)}
      AND (access_c.id IS NULL OR access_c.visibility='public' OR (${memberAccess}))
  )`
}

// This adds the community boundary only. Existing hidden-term rules remain an
// independent decision at each listing/detail call site.
export function readableTermId(
  column: SQLWrapper,
  viewerId: number | null = null
): SQL {
  return sql`${qualified(column)} IN (SELECT access_t.id FROM "terms" access_t
    WHERE ${vocabularyContentVisible(sql`access_t."vocabularySlug"`, viewerId)})`
}

// Collection links do not transfer ownership or visibility. Only the explicit
// creation-time scope makes a worklist part of a community's private content.
export function collectionContentVisible(
  column: SQLWrapper,
  viewerId: number | null = null
): SQL {
  return sql`EXISTS (SELECT 1 FROM "collections" access_collection
    WHERE access_collection.id=${qualified(column)} AND (
      access_collection."visibilityCommunityId" IS NULL OR EXISTS (
        SELECT 1 FROM "communities" access_collection_community
        WHERE access_collection_community.id=access_collection."visibilityCommunityId"
          AND ${vocabularyContentVisible(sql`access_collection_community."vocabularySlug"`, viewerId)}
      )
    ))`
}

const unavailable = () =>
  new TRPCError({ code: "NOT_FOUND", message: "This content is unavailable." })

export async function requireVocabularyContent(
  reader: CommunityReader,
  slug: string,
  viewerId: number | null = null,
  options: { lock?: boolean } = {}
) {
  // Mutations pass their open transaction. Shared row locks serialize their
  // permission check with visibility, membership and administrator-role edits.
  if (options.lock) {
    const [community] = await reader
      .select({ id: communitiesTable.id })
      .from(communitiesTable)
      .where(eq(communitiesTable.vocabularySlug, slug))
      .for("share")
    await reader
      .select({ slug: vocabulariesTable.slug })
      .from(vocabulariesTable)
      .where(eq(vocabulariesTable.slug, slug))
      .for("share")
    if (validViewer(viewerId)) {
      if (community)
        await reader
          .select({ id: communityMembersTable.id })
          .from(communityMembersTable)
          .where(
            sql`${communityMembersTable.communityId}=${community.id} AND ${communityMembersTable.userId}=${viewerId} AND ${communityMembersTable.removedAt} IS NULL`
          )
          .for("share")
      await reader
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, viewerId!))
        .for("share")
    }
  }
  const [row] = await reader
    .select({ slug: vocabulariesTable.slug })
    .from(vocabulariesTable)
    .where(
      sql`${vocabulariesTable.slug}=${slug} AND ${vocabularyContentVisible(vocabulariesTable.slug, viewerId)}`
    )
    .limit(1)
  if (!row) throw unavailable()
  return row
}

export async function requireTermContent(
  reader: CommunityReader,
  id: number,
  viewerId: number | null = null,
  options: { lock?: boolean } = {}
) {
  if (options.lock) {
    const [term] = await reader
      .select({ id: termsTable.id, vocabularySlug: termsTable.vocabularySlug })
      .from(termsTable)
      .where(eq(termsTable.id, id))
      .for("share")
    if (!term) throw unavailable()
    await requireVocabularyContent(
      reader,
      term.vocabularySlug,
      viewerId,
      options
    )
    return term
  }
  const [row] = await reader
    .select({ id: termsTable.id, vocabularySlug: termsTable.vocabularySlug })
    .from(termsTable)
    .where(
      sql`${termsTable.id}=${id} AND ${vocabularyContentVisible(termsTable.vocabularySlug, viewerId)}`
    )
    .limit(1)
  if (!row) throw unavailable()
  return row
}

export async function requireCollectionContent(
  reader: CommunityReader,
  id: number,
  viewerId: number | null = null,
  options: { lock?: boolean } = {}
) {
  if (options.lock) {
    // Scope is immutable. Discover it without a lock, then keep the established
    // community-before-content order used by visibility and contribution edits.
    const [scope] = await reader
      .select({ vocabularySlug: communitiesTable.vocabularySlug })
      .from(collectionsTable)
      .innerJoin(
        communitiesTable,
        eq(communitiesTable.id, collectionsTable.visibilityCommunityId)
      )
      .where(eq(collectionsTable.id, id))
    if (scope)
      await requireVocabularyContent(
        reader,
        scope.vocabularySlug,
        viewerId,
        options
      )
    await reader
      .select({ id: collectionsTable.id })
      .from(collectionsTable)
      .where(eq(collectionsTable.id, id))
      .for("share")
  }
  const [row] = await reader
    .select({
      id: collectionsTable.id,
      visibilityCommunityId: collectionsTable.visibilityCommunityId
    })
    .from(collectionsTable)
    .where(
      sql`${collectionsTable.id}=${id} AND ${collectionContentVisible(collectionsTable.id, viewerId)}`
    )
    .limit(1)
  if (!row) throw unavailable()
  return row
}

// The title and route are discoverable even when the workspace body is private.
// Do not add descriptions, roster or contribution counts to this projection.
export async function communityAccess(
  reader: CommunityReader,
  communityId: number,
  viewerId: number | null = null
) {
  const manager = validViewer(viewerId)
    ? sql<boolean>`EXISTS (SELECT 1 FROM "users" permission_u WHERE permission_u.id=${viewerId} AND permission_u.role='admin')
      OR EXISTS (SELECT 1 FROM "communityMembers" permission_m
        WHERE permission_m."communityId"=${qualified(communitiesTable.id)} AND permission_m."userId"=${viewerId}
          AND permission_m."removedAt" IS NULL AND permission_m.role='steward')`
    : sql<boolean>`false`
  const requestStatus = validViewer(viewerId)
    ? sql<
        "pending" | "approved" | "declined" | null
      >`(SELECT permission_r.status FROM "communityAccessRequests" permission_r
        WHERE permission_r."communityId"=${qualified(communitiesTable.id)} AND permission_r."requesterId"=${viewerId}
        ORDER BY permission_r.id DESC LIMIT 1)`
    : sql<null>`NULL`
  const [row] = await reader
    .select({
      id: communitiesTable.id,
      slug: communitiesTable.slug,
      title: communitiesTable.title,
      visibility: communitiesTable.visibility,
      retiredAt: communitiesTable.retiredAt,
      canRead: sql<boolean>`${vocabularyContentVisible(communitiesTable.vocabularySlug, viewerId)}`,
      canManage: sql<boolean>`${communitiesTable.retiredAt} IS NULL AND (${manager})`,
      requestStatus
    })
    .from(communitiesTable)
    .where(eq(communitiesTable.id, communityId))
    .limit(1)
  if (!row) throw unavailable()
  return {
    ...row,
    canRequest:
      validViewer(viewerId) &&
      row.visibility === "members" &&
      !row.canRead &&
      !row.retiredAt &&
      row.requestStatus !== "pending"
  }
}
