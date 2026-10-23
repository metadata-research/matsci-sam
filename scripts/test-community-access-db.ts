import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { and, eq, isNull, sql } from "drizzle-orm"
import {
  db,
  usersTable,
  vocabulariesTable,
  communitiesTable,
  communityMembersTable,
  communityAccessRequestsTable,
  termsTable,
  collectionsTable,
  statementsTable,
  studiesTable,
  surveyStepsTable,
  surveyStepCompletionsTable,
  surveyStepPositionsTable,
  commentsTable,
  matcoreSourceReleasesTable,
  vocabularyMatcoreSourcesTable
} from "../drizzle"
import {
  communityAccess,
  requireTermContent,
  requireVocabularyContent,
  requireCollectionContent,
  collectionContentVisible,
  readableTermId,
  vocabularyContentVisible,
  type CommunityTransaction
} from "../lib/community-access"
import {
  listCommunityAccessRequests,
  requestCommunityAccess,
  reviewCommunityAccessRequest,
  setCommunityVisibility,
  communityCollectionScope
} from "../lib/community-permissions"
import { requireStudyContentScope } from "../lib/study-content-scope"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import {
  stepsOfStudy,
  stepWithStudy,
  instructionPromptOfStudy,
  walkthroughOf,
  reviewRecordsOf,
  positionsOf,
  recordResponse,
  studyProgress
} from "../lib/survey-queries"

class Rollback extends Error {}
let checks = 0
function same(actual: unknown, expected: unknown, message: string) {
  assert.deepEqual(actual, expected, message)
  checks++
}
async function rejected(action: Promise<unknown>, code?: string) {
  await assert.rejects(action, (error: { code?: string }) =>
    code ? error.code === code : true
  )
  checks++
}
async function preservation(tx: CommunityTransaction) {
  return (
    await tx.execute(sql`SELECT
    (SELECT md5(coalesce(string_agg(to_jsonb(d)::text,'' ORDER BY d.id),'empty')) FROM "matcoreSpecDrafts" d) drafts,
    (SELECT md5(coalesce(string_agg(to_jsonb(e)::text,'' ORDER BY e.id),'empty')) FROM "matcoreWorkflowEvents" e) events,
    (SELECT md5(coalesce(string_agg(to_jsonb(r)::text,'' ORDER BY r.id),'empty')) FROM "matcoreSpecRevisions" r) revisions,
    (SELECT md5(coalesce(string_agg(to_jsonb(r)::text,'' ORDER BY r.id),'empty')) FROM "matcoreSourceReleases" r) sources,
    (SELECT md5(coalesce(string_agg(to_jsonb(r)::text,'' ORDER BY r.id),'empty')) FROM "matcoreSourceOccurrences" r) occurrences`)
  ).rows[0]
}
async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /_(?:test|scratch|ci|qa)(?:_|$)/)
  assert.ok(
    !process.env.FUSEKI_DATASET_URL,
    "No graph provider calls in this rollback-only suite"
  )
  process.env.GRAPH_PROJECTION_ENABLED = "false"
  try {
    await db.transaction(async (tx) => {
      const before = await preservation(tx)
      const collectionsBefore = (
        await tx.execute(
          sql`SELECT md5(coalesce(string_agg((to_jsonb(c)-'visibilityCommunityId')::text,'' ORDER BY c.id),'empty')) fingerprint FROM "collections" c`
        )
      ).rows[0]
      const present = (
        await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='communities' AND column_name='visibility') present`)
      ).rows[0]
      if (!present.present) {
        await tx.execute(
          sql.raw(
            await readFile(
              new URL(
                "../drizzle/migrations/0072_community_content_access.sql",
                import.meta.url
              ),
              "utf8"
            )
          )
        )
      }
      const collectionScopePresent = (
        await tx.execute(
          sql`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='collections' AND column_name='visibilityCommunityId') present`
        )
      ).rows[0]
      if (!collectionScopePresent.present)
        await tx.execute(
          sql.raw(
            await readFile(
              new URL(
                "../drizzle/migrations/0073_community_collection_scope.sql",
                import.meta.url
              ),
              "utf8"
            )
          )
        )
      same(
        (
          await tx.execute(
            sql`SELECT md5(coalesce(string_agg((to_jsonb(c)-'visibilityCommunityId')::text,'' ORDER BY c.id),'empty')) fingerprint FROM "collections" c`
          )
        ).rows[0],
        collectionsBefore,
        "Scoped collection migration preserves all original collection fields"
      )
      same(
        await preservation(tx),
        before,
        "Migration preserves every existing source, draft, revision and event exactly"
      )
      const unsafe =
        await tx.execute(sql`SELECT count(*)::int n FROM "matcoreFields" f JOIN communities c ON c."vocabularySlug"=f."vocabularySlug"
        WHERE f."sourceFieldId" IS NOT NULL AND c.visibility<>'members'`)
      same(
        unsafe.rows[0].n,
        0,
        "Preserved source fields have members-only community visibility"
      )
      const suffix = randomUUID().replaceAll("-", "")
      const people = await tx
        .insert(usersTable)
        .values([
          { name: "Permission admin", role: "admin" as const },
          { name: "Permission steward" },
          { name: "Permission member" },
          { name: "Permission outsider" },
          { name: "Permission revoked" }
        ])
        .returning({ id: usersTable.id })
      const [admin, steward, member, outsider, revoked] = people.map(
        (x) => x.id
      )
      const privateSlug = `access_private_${suffix}`,
        publicSlug = `access_public_${suffix}`,
        standaloneSlug = `access_standalone_${suffix}`
      await tx.insert(vocabulariesTable).values(
        [privateSlug, publicSlug, standaloneSlug].map((slug) => ({
          slug,
          title: slug,
          createdById: admin
        }))
      )
      const [privateCommunity, publicCommunity] = await tx
        .insert(communitiesTable)
        .values([
          {
            slug: privateSlug,
            vocabularySlug: privateSlug,
            title: "Private test workspace",
            createdById: admin,
            visibility: "members" as const
          },
          {
            slug: publicSlug,
            vocabularySlug: publicSlug,
            title: "Public test workspace",
            createdById: admin
          }
        ])
        .returning()
      await tx.insert(communityMembersTable).values([
        {
          communityId: privateCommunity.id,
          userId: steward,
          role: "steward",
          addedById: admin
        },
        { communityId: privateCommunity.id, userId: member, addedById: admin },
        {
          communityId: privateCommunity.id,
          userId: revoked,
          addedById: admin,
          removedById: admin,
          removedAt: sql`clock_timestamp()`
        }
      ])
      const [privateTerm, publicTerm] = await tx
        .insert(termsTable)
        .values([
          {
            vocabularySlug: privateSlug,
            term: "Private field",
            slug: "private_field"
          },
          {
            vocabularySlug: publicSlug,
            term: "Public field",
            slug: "public_field"
          }
        ])
        .returning()
      const [collection] = await tx
        .insert(collectionsTable)
        .values({
          slug: `access_collection_${suffix}`,
          title: "Permission test collection",
          createdById: admin
        })
        .returning()
      const [privateCollection] = await tx
        .insert(collectionsTable)
        .values({
          slug: `access_private_collection_${suffix}`,
          title: "Private worklist title",
          description: "Private worklist description",
          visibilityCommunityId: await communityCollectionScope(
            tx,
            privateCommunity.id,
            steward
          ),
          createdById: steward
        })
        .returning()
      same(
        await communityCollectionScope(tx, publicCommunity.id, admin),
        null,
        "Creating in a public workspace retains independent collection visibility"
      )
      await rejected(
        communityCollectionScope(tx, privateCommunity.id, member),
        "FORBIDDEN"
      )
      for (const viewer of [null, outsider, revoked])
        await rejected(
          requireCollectionContent(tx, privateCollection.id, viewer),
          "NOT_FOUND"
        )
      for (const viewer of [member, steward, admin])
        same(
          (
            await requireCollectionContent(tx, privateCollection.id, viewer, {
              lock: true
            })
          ).id,
          privateCollection.id,
          "Authorized member reads a scoped worklist under lock"
        )
      same(
        (await requireCollectionContent(tx, collection.id))
          .visibilityCommunityId,
        null,
        "An existing public collection remains public even in a private survey"
      )
      same(
        (
          await tx
            .select({ allowed: collectionContentVisible(collectionsTable.id) })
            .from(collectionsTable)
            .where(eq(collectionsTable.id, privateCollection.id))
        )[0]?.allowed,
        false,
        "Collection SELECT predicate retains correlated outer identity"
      )
      same(
        (
          await tx
            .select({ id: collectionsTable.id })
            .from(collectionsTable)
            .where(
              and(
                eq(collectionsTable.id, privateCollection.id),
                collectionContentVisible(collectionsTable.id, member)
              )
            )
        ).length,
        1,
        "Member list includes their private collection"
      )
      await rejected(
        tx.transaction(async (nested) => {
          await nested
            .update(collectionsTable)
            .set({ visibilityCommunityId: null })
            .where(eq(collectionsTable.id, privateCollection.id))
        })
      )
      await rejected(
        tx.transaction(async (nested) => {
          await nested
            .update(collectionsTable)
            .set({ visibilityCommunityId: privateCommunity.id })
            .where(eq(collectionsTable.id, collection.id))
        })
      )
      await rejected(
        requireStudyContentScope(tx, publicCommunity.id, privateCollection.id),
        "BAD_REQUEST"
      )
      await rejected(
        tx.transaction(async (nested) => {
          await nested
            .insert(studiesTable)
            .values({
              slug: `access_invalid_study_${suffix}`,
              title: "Invalid external collection",
              communityId: publicCommunity.id,
              collectionId: privateCollection.id,
              createdById: admin
            })
        })
      )
      const [publicStudy, privateStudy] = await tx
        .insert(studiesTable)
        .values([
          {
            slug: `access_public_study_${suffix}`,
            title: "Public survey",
            communityId: publicCommunity.id,
            collectionId: collection.id,
            createdById: admin
          },
          {
            slug: `access_private_study_${suffix}`,
            title: "Private survey",
            communityId: privateCommunity.id,
            collectionId: collection.id,
            createdById: admin
          }
        ])
        .returning()
      const publicSteps = await tx
        .insert(surveyStepsTable)
        .values([
          {
            studyId: publicStudy.id,
            position: 1,
            kind: "instructions" as const,
            prompt: "Public survey instructions"
          },
          {
            studyId: publicStudy.id,
            position: 2,
            kind: "define" as const,
            termId: privateTerm.id
          },
          {
            studyId: publicStudy.id,
            position: 3,
            kind: "review" as const,
            termId: privateTerm.id
          },
          {
            studyId: publicStudy.id,
            position: 4,
            kind: "define" as const,
            termId: publicTerm.id
          }
        ])
        .returning()
      const privateSteps = await tx
        .insert(surveyStepsTable)
        .values([
          {
            studyId: privateStudy.id,
            position: 1,
            kind: "instructions" as const,
            prompt: "Private survey instructions"
          },
          {
            studyId: privateStudy.id,
            position: 2,
            kind: "question" as const,
            prompt: "Private question",
            responseKind: "text" as const
          }
        ])
        .returning()
      await rejected(
        tx.transaction(async (nested) => {
          await nested
            .insert(surveyStepsTable)
            .values({
              studyId: privateStudy.id,
              position: 3,
              kind: "define",
              termId: publicTerm.id
            })
        })
      )
      await rejected(
        tx.transaction(async (nested) => {
          await nested
            .insert(statementsTable)
            .values({
              subjectCollectionId: collection.id,
              predicate: "skos:member",
              objectTermId: publicTerm.id,
              assertedById: admin
            })
        })
      )
      await tx
        .insert(statementsTable)
        .values({
          subjectCollectionId: collection.id,
          predicate: "skos:member",
          objectTermId: privateTerm.id,
          assertedById: admin
        })
      await tx
        .insert(surveyStepsTable)
        .values({
          studyId: privateStudy.id,
          position: 3,
          kind: "define",
          termId: privateTerm.id
        })
      await requireStudyContentScope(
        tx,
        privateCommunity.id,
        collection.id,
        privateStudy.id
      )
      checks++
      await rejected(
        tx.transaction(async (nested) => {
          await nested
            .update(termsTable)
            .set({ vocabularySlug: publicSlug })
            .where(eq(termsTable.id, privateTerm.id))
        })
      )
      await rejected(
        setCommunityVisibility(tx, {
          communityId: publicCommunity.id,
          actorId: admin,
          visibility: "members"
        }),
        "BAD_REQUEST"
      )
      await rejected(
        tx.transaction(async (nested) => {
          await nested
            .update(communitiesTable)
            .set({ visibility: "members" })
            .where(eq(communitiesTable.id, publicCommunity.id))
        })
      )
      same(
        (await communityAccess(tx, publicCommunity.id)).visibility,
        "public",
        "A legacy public survey stays public when it contains external terms"
      )
      same(
        (await stepsOfStudy(tx, publicStudy.id)).map((x) => x.id),
        [publicSteps[0].id, publicSteps[3].id],
        "Public survey cannot expose term names or prompts from another private community"
      )
      same(
        (await stepsOfStudy(tx, publicStudy.id, member)).length,
        4,
        "Authorized private-term member sees all public survey steps"
      )
      same(
        await stepWithStudy(tx, publicSteps[1].id, outsider),
        null,
        "Direct step lookup cannot bypass term privacy"
      )
      same(
        (await stepsOfStudy(tx, privateStudy.id)).length,
        0,
        "Private survey instructions and question prompts are hidden"
      )
      same(
        await instructionPromptOfStudy(tx, privateStudy.id),
        null,
        "Direct instructions lookup cannot bypass community privacy"
      )
      same(
        await instructionPromptOfStudy(tx, privateStudy.id, member),
        "Private survey instructions",
        "Authorized member retains private survey instructions"
      )
      same(
        (await walkthroughOf(tx, publicStudy.id, outsider)).steps.length,
        2,
        "Walkthrough read filters cross-community private terms"
      )
      same(
        await studyProgress(tx, privateStudy.id, outsider),
        null,
        "Private survey progress is unavailable to an outsider"
      )
      await rejected(
        recordResponse(tx, {
          stepId: privateSteps[1].id,
          userId: outsider,
          authorKind: "human",
          valueText: "Unauthorized answer"
        }),
        "NOT_FOUND"
      )
      const definition = await createDefinitionWithInitialRevision(tx, {
        termId: privateTerm.id,
        authorId: admin,
        definition: "Private survey reference text",
        example: "",
        changeNote: "Permission fixture",
        source: "initial"
      })
      for (const participant of [member, outsider]) {
        await tx
          .insert(surveyStepCompletionsTable)
          .values({ stepId: publicSteps[1].id, userId: participant })
        await tx.insert(surveyStepPositionsTable).values({
          stepId: publicSteps[1].id,
          userId: participant,
          kind: "accepted",
          definitionId: definition.definition.id,
          revisionId: definition.revision.id
        })
        await tx.insert(commentsTable).values({
          definitionId: definition.definition.id,
          revisionId: definition.revision.id,
          userId: participant,
          authorKind: "human",
          surveyStepId: publicSteps[2].id,
          message: "Private review wording"
        })
      }
      same(
        (await positionsOf(tx, [publicSteps[1].id], outsider)).size,
        0,
        "Previously saved private position does not bypass current term access"
      )
      same(
        (await positionsOf(tx, [publicSteps[1].id], member)).size,
        1,
        "Authorized member retains their exact position"
      )
      same(
        (await reviewRecordsOf(tx, [publicSteps[2].id], outsider)).get(
          publicSteps[2].id
        )?.comments.length,
        0,
        "Historical private review text remains protected after access loss"
      )
      same(
        (await reviewRecordsOf(tx, [publicSteps[2].id], member)).get(
          publicSteps[2].id
        )?.comments[0].message,
        "Private review wording",
        "Authorized member retains their review text"
      )
      for (const viewer of [null, outsider, revoked, -1]) {
        same(
          (await communityAccess(tx, privateCommunity.id, viewer)).canRead,
          false,
          "Anonymous, nonmember and revoked visitors cannot read"
        )
        await rejected(
          requireVocabularyContent(tx, privateSlug, viewer),
          "NOT_FOUND"
        )
        await rejected(
          requireTermContent(tx, privateTerm.id, viewer),
          "NOT_FOUND"
        )
      }
      for (const viewer of [admin, steward, member]) {
        same(
          (await communityAccess(tx, privateCommunity.id, viewer)).canRead,
          true,
          "Active member or current administrator can read"
        )
        same(
          (
            await requireVocabularyContent(tx, privateSlug, viewer, {
              lock: true
            })
          ).slug,
          privateSlug,
          "Locked vocabulary authorization succeeds"
        )
        same(
          (await requireTermContent(tx, privateTerm.id, viewer, { lock: true }))
            .id,
          privateTerm.id,
          "Locked term authorization succeeds"
        )
      }
      same(
        (await requireVocabularyContent(tx, standaloneSlug)).slug,
        standaloneSlug,
        "Standalone ordinary vocabulary remains public"
      )
      same(
        (await requireTermContent(tx, publicTerm.id)).id,
        publicTerm.id,
        "Public term remains anonymously readable"
      )
      await rejected(
        requireVocabularyContent(tx, `absent_${suffix}`, admin),
        "NOT_FOUND"
      )
      await rejected(requireTermContent(tx, -1, admin), "NOT_FOUND")
      const filtered = await tx
        .select({ id: termsTable.id })
        .from(termsTable)
        .where(
          and(eq(termsTable.id, privateTerm.id), readableTermId(termsTable.id))
        )
      same(filtered.length, 0, "Anonymous ID predicate filters private terms")
      const filteredVocab = await tx
        .select({ slug: vocabulariesTable.slug })
        .from(vocabulariesTable)
        .where(
          and(
            eq(vocabulariesTable.slug, privateSlug),
            vocabularyContentVisible(vocabulariesTable.slug, member)
          )
        )
      same(
        filteredVocab.length,
        1,
        "Member SQL predicate includes their vocabulary"
      )
      await tx
        .update(usersTable)
        .set({ role: "user" })
        .where(eq(usersTable.id, admin))
      await rejected(requireTermContent(tx, privateTerm.id, admin), "NOT_FOUND")
      await tx
        .update(usersTable)
        .set({ role: "admin" })
        .where(eq(usersTable.id, admin))
      const anonymous = await communityAccess(tx, privateCommunity.id)
      same(
        Object.hasOwn(anonymous, "description"),
        false,
        "Access projection contains no private description"
      )
      same(
        anonymous.title,
        "Private test workspace",
        "Community name remains discoverable"
      )
      same(anonymous.canManage, false, "Anonymous visitor cannot manage")
      same(
        (await communityAccess(tx, privateCommunity.id, steward)).canManage,
        true,
        "Steward can manage access"
      )
      const request = await requestCommunityAccess(tx, {
        communityId: privateCommunity.id,
        requesterId: outsider
      })
      same(
        (
          await requestCommunityAccess(tx, {
            communityId: privateCommunity.id,
            requesterId: outsider
          })
        ).id,
        request.id,
        "Repeated requests reuse one pending episode"
      )
      same(
        (await communityAccess(tx, privateCommunity.id, outsider))
          .requestStatus,
        "pending",
        "Requester sees their pending status"
      )
      const [otherCommunity] = await tx
        .insert(communitiesTable)
        .values({
          slug: standaloneSlug,
          vocabularySlug: standaloneSlug,
          title: "Unrelated private community",
          createdById: admin,
          visibility: "members"
        })
        .returning()
      same(
        (await communityAccess(tx, otherCommunity.id, member)).canRead,
        false,
        "Membership in one private community never grants another"
      )
      same(
        (await communityAccess(tx, otherCommunity.id, steward)).canManage,
        false,
        "Stewardship remains scoped to the correct community"
      )
      same(
        (await communityAccess(tx, otherCommunity.id, outsider)).requestStatus,
        null,
        "A pending request in another community is not reused"
      )
      const [projection] = await tx
        .select({
          visible: vocabularyContentVisible(
            communitiesTable.vocabularySlug,
            member
          )
        })
        .from(communitiesTable)
        .where(eq(communitiesTable.id, otherCommunity.id))
      same(
        projection.visible,
        false,
        "Correlated permission SQL stays scoped inside a SELECT projection"
      )
      await tx
        .delete(communitiesTable)
        .where(eq(communitiesTable.id, otherCommunity.id))
      same(
        (await communityAccess(tx, privateCommunity.id, revoked)).requestStatus,
        null,
        "Another visitor does not see someone else's request"
      )
      await rejected(
        listCommunityAccessRequests(tx, {
          communityId: privateCommunity.id,
          actorId: outsider
        }),
        "FORBIDDEN"
      )
      same(
        (
          await listCommunityAccessRequests(tx, {
            communityId: privateCommunity.id,
            actorId: steward
          })
        ).length,
        1,
        "Steward sees pending request queue"
      )
      await rejected(
        reviewCommunityAccessRequest(tx, {
          id: request.id!,
          actorId: member,
          approve: true
        }),
        "FORBIDDEN"
      )
      const approved = await reviewCommunityAccessRequest(tx, {
        id: request.id!,
        actorId: steward,
        approve: true
      })
      same(approved.status, "approved", "Steward approves request")
      same(
        (await communityAccess(tx, privateCommunity.id, outsider)).canRead,
        true,
        "Approval grants read through membership"
      )
      same(
        (
          await reviewCommunityAccessRequest(tx, {
            id: request.id!,
            actorId: admin,
            approve: true
          })
        ).membershipId,
        approved.membershipId,
        "Approval retry is idempotent"
      )
      await rejected(
        reviewCommunityAccessRequest(tx, {
          id: request.id!,
          actorId: admin,
          approve: false
        }),
        "CONFLICT"
      )
      await rejected(
        tx.transaction(async (nested) => {
          await nested
            .update(communityAccessRequestsTable)
            .set({
              status: "pending",
              decidedAt: null,
              decidedById: null,
              membershipId: null
            })
            .where(eq(communityAccessRequestsTable.id, request.id!))
        })
      )
      await tx
        .update(communityMembersTable)
        .set({ removedAt: sql`clock_timestamp()`, removedById: admin })
        .where(eq(communityMembersTable.id, approved.membershipId!))
      same(
        (await communityAccess(tx, privateCommunity.id, outsider)).canRead,
        false,
        "Revocation takes effect immediately despite approved request"
      )
      const again = await requestCommunityAccess(tx, {
        communityId: privateCommunity.id,
        requesterId: outsider
      })
      same(
        again.id !== request.id,
        true,
        "Re-request creates a new historical episode"
      )
      const reapproved = await reviewCommunityAccessRequest(tx, {
        id: again.id!,
        actorId: admin,
        approve: true
      })
      same(
        reapproved.membershipId !== approved.membershipId,
        true,
        "Reapproval creates a new membership and preserves the removed episode"
      )
      const declined = await requestCommunityAccess(tx, {
        communityId: privateCommunity.id,
        requesterId: revoked
      })
      await reviewCommunityAccessRequest(tx, {
        id: declined.id!,
        actorId: admin,
        approve: false
      })
      same(
        (await communityAccess(tx, privateCommunity.id, revoked)).canRead,
        false,
        "Declining does not grant membership"
      )
      same(
        (await communityAccess(tx, privateCommunity.id, revoked)).canRequest,
        true,
        "Declined requester may submit a new request"
      )
      await rejected(
        setCommunityVisibility(tx, {
          communityId: privateCommunity.id,
          actorId: member,
          visibility: "public"
        }),
        "FORBIDDEN"
      )
      same(
        (
          await setCommunityVisibility(tx, {
            communityId: privateCommunity.id,
            actorId: steward,
            visibility: "public"
          })
        ).changed,
        true,
        "Steward can publish a generic community"
      )
      same(
        (await communityAccess(tx, privateCommunity.id)).canRead,
        true,
        "Newly public community is readable"
      )
      process.env.GRAPH_PROJECTION_ENABLED = "true"
      await rejected(
        setCommunityVisibility(tx, {
          communityId: privateCommunity.id,
          actorId: admin,
          visibility: "members"
        }),
        "PRECONDITION_FAILED"
      )
      same(
        (await communityAccess(tx, privateCommunity.id)).canRead,
        true,
        "A failed public graph withdrawal leaves visibility unchanged"
      )
      process.env.GRAPH_PROJECTION_ENABLED = "false"
      await setCommunityVisibility(tx, {
        communityId: privateCommunity.id,
        actorId: admin,
        visibility: "members"
      })
      same(
        (await communityAccess(tx, privateCommunity.id)).canRead,
        false,
        "Restricting generic community removes anonymous access"
      )
      const releaseId = `permission-source:${suffix}`
      await tx.insert(matcoreSourceReleasesTable).values({
        id: releaseId,
        version: "test",
        source: {} as never,
        profiles: [],
        manifestHash: "a".repeat(64)
      })
      await rejected(
        tx.transaction(async (nested) => {
          await nested.insert(vocabularyMatcoreSourcesTable).values({
            vocabularySlug: publicSlug,
            releaseId,
            grantedById: admin
          })
        })
      )
      await rejected(
        tx.transaction(async (nested) => {
          await nested.insert(vocabularyMatcoreSourcesTable).values({
            vocabularySlug: standaloneSlug,
            releaseId,
            grantedById: admin
          })
        })
      )
      await rejected(
        tx.transaction(async (nested) => {
          await nested.insert(vocabularyMatcoreSourcesTable).values({
            vocabularySlug: privateSlug,
            releaseId,
            grantedById: steward
          })
        })
      )
      await tx
        .insert(vocabularyMatcoreSourcesTable)
        .values({ vocabularySlug: privateSlug, releaseId, grantedById: admin })
      await rejected(
        tx.transaction(async (nested) => {
          await nested
            .delete(communitiesTable)
            .where(eq(communitiesTable.id, privateCommunity.id))
        })
      )
      await rejected(
        tx.transaction(async (nested) => {
          await nested
            .update(communitiesTable)
            .set({ slug: standaloneSlug, vocabularySlug: standaloneSlug })
            .where(eq(communitiesTable.id, privateCommunity.id))
        })
      )
      await rejected(
        setCommunityVisibility(tx, {
          communityId: privateCommunity.id,
          actorId: admin,
          visibility: "public"
        }),
        "BAD_REQUEST"
      )
      await rejected(
        tx.transaction(async (nested) => {
          await nested
            .update(communitiesTable)
            .set({ visibility: "public" })
            .where(eq(communitiesTable.id, privateCommunity.id))
        })
      )
      same(
        (await communityAccess(tx, privateCommunity.id)).canRead,
        false,
        "Protected-source community remains private"
      )
      await tx
        .update(communityMembersTable)
        .set({ removedAt: sql`clock_timestamp()`, removedById: admin })
        .where(
          and(
            eq(communityMembersTable.communityId, privateCommunity.id),
            eq(communityMembersTable.userId, steward),
            isNull(communityMembersTable.removedAt)
          )
        )
      await rejected(
        listCommunityAccessRequests(tx, {
          communityId: privateCommunity.id,
          actorId: steward
        }),
        "FORBIDDEN"
      )
      await tx
        .delete(vocabularyMatcoreSourcesTable)
        .where(eq(vocabularyMatcoreSourcesTable.releaseId, releaseId))
      await tx
        .delete(matcoreSourceReleasesTable)
        .where(eq(matcoreSourceReleasesTable.id, releaseId))
      same(
        await preservation(tx),
        before,
        "Permission actions preserve existing drafts, source snapshots, revisions and provenance"
      )
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  console.log(
    `Community access database tests passed (${checks} checks; migration and fixtures rolled back).`
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await (db.$client as { end: () => Promise<void> }).end()
  })
