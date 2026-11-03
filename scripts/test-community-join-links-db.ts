import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external"
import { and, eq, inArray, isNull } from "drizzle-orm"
import {
  db,
  usersTable,
  vocabulariesTable,
  communitiesTable,
  communityMembersTable
} from "../drizzle"
import { communitiesRouter } from "../trpc/routers/communities"
import { communityAccess } from "../lib/community-access"
import { communityBySlug, invitationForToken } from "../lib/community-queries"
import { setCommunityVisibility } from "../lib/community-permissions"
import { reviewFingerprints } from "./community-review-test-support"

let checks = 0
function same(actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected)
  checks++
}
async function rejected(action: Promise<unknown>, code: string) {
  await assert.rejects(
    action,
    (error: { code?: string }) => error.code === code
  )
  checks++
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /_(?:test|scratch|ci|qa)(?:_|$)/)
  assert.ok(!process.env.FUSEKI_DATASET_URL)
  process.env.GRAPH_PROJECTION_ENABLED = "false"
  const before = await reviewFingerprints()
  const slug = `join_links_${randomUUID().replaceAll("-", "")}`
  let id: number | undefined
  let people: number[] = []
  const caller = (userId?: number) =>
    communitiesRouter.createCaller({
      session: userId ? { id: userId } : {}
    } as never)
  try {
    const fixture = await db.transaction(async (tx) => {
      const users = await tx
        .insert(usersTable)
        .values([
          { name: "Link administrator", role: "admin" },
          { name: "Link steward" },
          { name: "Link member" },
          { name: "First invitee" },
          { name: "Second invitee" }
        ])
        .returning({ id: usersTable.id })
      const [admin, steward, member, first, second] = users.map(
        (user) => user.id
      )
      await tx
        .insert(vocabulariesTable)
        .values({ slug, title: "Materials collaboration", createdById: admin })
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug,
          title: "Materials collaboration",
          description: "Private research context",
          vocabularySlug: slug,
          visibility: "members",
          createdById: admin
        })
        .returning({ id: communitiesTable.id })
      await tx.insert(communityMembersTable).values([
        {
          communityId: community.id,
          userId: steward,
          role: "steward",
          addedById: admin
        },
        { communityId: community.id, userId: member, addedById: admin }
      ])
      return {
        admin,
        steward,
        member,
        first,
        second,
        id: community.id,
        users: users.map((user) => user.id)
      }
    })
    id = fixture.id
    people = fixture.users
    const manager = caller(fixture.steward)
    const set = (on: boolean, rotate = false) =>
      manager.setJoinLink({ communityId: fixture.id, on, rotate })
    const membership = (userId: number) =>
      db
        .select({ role: communityMembersTable.role })
        .from(communityMembersTable)
        .where(
          and(
            eq(communityMembersTable.communityId, fixture.id),
            eq(communityMembersTable.userId, userId),
            isNull(communityMembersTable.removedAt)
          )
        )
    const access = (userId?: number) =>
      db.transaction((tx) => communityAccess(tx, fixture.id, userId ?? null))
    const tokenOf = (link: string | null) => {
      assert.ok(link)
      assert.ok(link.startsWith("/invite/"))
      return link.slice("/invite/".length)
    }
    await rejected(
      caller().setJoinLink({ communityId: id, on: true }),
      "UNAUTHORIZED"
    )
    for (const user of [fixture.member, fixture.first])
      await rejected(
        caller(user).setJoinLink({ communityId: id, on: true }),
        "FORBIDDEN"
      )

    // An old public link must remain unable to grant private membership.
    const legacy = "a".repeat(43)
    await db
      .update(communitiesTable)
      .set({ joinToken: legacy })
      .where(eq(communitiesTable.id, id))
    await rejected(caller(fixture.first).accept({ token: legacy }), "FORBIDDEN")
    same(await membership(fixture.first), [])
    const created = await set(true)
    const token = tokenOf(created.link)
    same(token.startsWith("join-v1_"), true)
    same((await set(true)).link, created.link)
    same((await communityBySlug(slug, fixture.steward))?.joinToken, token)
    same((await communityBySlug(slug, fixture.admin))?.joinToken, token)
    for (const viewer of [null, fixture.member, fixture.first]) {
      same((await communityBySlug(slug, viewer))?.joinToken, null)
    }
    same((await access()).canRead, false)
    same((await access(fixture.first)).canRead, false)
    same((await invitationForToken(token))?.community.description, null)
    same(
      (await invitationForToken(token, fixture.first))?.community.description,
      null
    )
    same(await membership(fixture.first), [])
    await rejected(caller().accept({ token }), "UNAUTHORIZED")
    const accepted = await caller(fixture.first).accept({ token })
    same(accepted.slug, slug)
    same(accepted.alreadyIn, false)
    same(await membership(fixture.first), [{ role: "member" }])
    same((await access(fixture.first)).canRead, true)
    same((await caller(fixture.first).accept({ token })).alreadyIn, true)
    same(await membership(fixture.first), [{ role: "member" }])
    same((await caller(fixture.second).accept({ token })).alreadyIn, false)
    same(await membership(fixture.second), [{ role: "member" }])
    await rejected(
      caller(fixture.first).setJoinLink({ communityId: id, on: false }),
      "FORBIDDEN"
    )

    const replacement = tokenOf((await set(true, true)).link)
    same(replacement !== token, true)
    same(await invitationForToken(token), null)
    await rejected(caller(fixture.first).accept({ token }), "NOT_FOUND")
    await set(false)
    same(await invitationForToken(replacement), null)
    await rejected(
      caller(fixture.first).accept({ token: replacement }),
      "NOT_FOUND"
    )
    same(await membership(fixture.first), [{ role: "member" }])

    await set(true)
    await db.transaction((tx) =>
      setCommunityVisibility(tx, {
        communityId: fixture.id,
        actorId: fixture.steward,
        visibility: "public"
      })
    )
    same((await communityBySlug(slug, fixture.steward))?.joinToken, null)
    // Legacy public links still work while the community remains public.
    await db
      .update(communitiesTable)
      .set({ joinToken: legacy })
      .where(eq(communitiesTable.id, id))
    same(
      (await caller(fixture.first).accept({ token: legacy })).alreadyIn,
      true
    )
    same((await set(true)).link, `/invite/${legacy}`)
    await db.transaction((tx) =>
      setCommunityVisibility(tx, {
        communityId: fixture.id,
        actorId: fixture.steward,
        visibility: "members"
      })
    )
    same((await communityBySlug(slug, fixture.steward))?.joinToken, null)
    await rejected(caller(fixture.first).accept({ token: legacy }), "NOT_FOUND")
    const finalToken = tokenOf((await set(true)).link)
    await db
      .update(communitiesTable)
      .set({ retiredAt: new Date().toISOString() })
      .where(eq(communitiesTable.id, id))
    await rejected(set(true), "BAD_REQUEST")
    await rejected(
      caller(fixture.first).accept({ token: finalToken }),
      "BAD_REQUEST"
    )
    await db
      .update(communitiesTable)
      .set({ retiredAt: null })
      .where(eq(communitiesTable.id, id))
    await db
      .update(communityMembersTable)
      .set({ removedAt: new Date().toISOString(), removedById: fixture.admin })
      .where(
        and(
          eq(communityMembersTable.communityId, id),
          eq(communityMembersTable.userId, fixture.steward)
        )
      )
    await rejected(set(true), "FORBIDDEN")
    same((await communityBySlug(slug, fixture.steward))?.joinToken, null)
  } finally {
    await db.transaction(async (tx) => {
      if (people.length)
        await tx
          .update(usersTable)
          .set({ activeCommunityId: null })
          .where(inArray(usersTable.id, people))
      if (id) {
        await tx
          .delete(communityMembersTable)
          .where(eq(communityMembersTable.communityId, id))
        await tx.delete(communitiesTable).where(eq(communitiesTable.id, id))
      }
      await tx.delete(vocabulariesTable).where(eq(vocabulariesTable.slug, slug))
      if (people.length)
        await tx.delete(usersTable).where(inArray(usersTable.id, people))
    })
  }
  same(await reviewFingerprints(), before)
  console.log(
    `Community join links passed (${checks} checks): explicit acceptance, private access, steward controls, copy persistence, rotation, revocation, legacy links and preservation.`
  )
}
workAsyncStorage
  .run(
    { route: "/api/trpc", incrementalCache: {} } as unknown as Parameters<
      typeof workAsyncStorage.run
    >[0],
    main
  )
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$client.end())
