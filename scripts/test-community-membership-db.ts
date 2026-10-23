import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import {
  db,
  usersTable,
  vocabulariesTable,
  communitiesTable,
  communityMembersTable
} from "../drizzle"
import {
  setCommunityMember,
  setCommunityMemberRole,
  requireCommunityInvitationManager,
  requireOpenCommunityJoin
} from "../lib/community-membership"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
let checks = 0
const same = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected)
  checks++
}
async function forbidden(operation: Promise<unknown>) {
  await assert.rejects(
    operation,
    (error: { code?: string }) => error.code === "FORBIDDEN"
  )
  checks++
}
async function main() {
  const database = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname))
  assert.match(database.pathname, /_(?:test|scratch|ci|qa)(?:_|$)/)
  const slug = `membership_${randomUUID().replaceAll("-", "")}`
  let communityId: number | undefined
  let userIds: number[] = []
  try {
    const fixture = await db.transaction(async (tx) => {
      const users = await tx
        .insert(usersTable)
        .values([
          { name: "Roster test admin", role: "admin" },
          { name: "Roster test steward" },
          { name: "Roster test member" },
          { name: "Roster test newcomer" }
        ])
        .returning({ id: usersTable.id })
      const [admin, steward, member, newcomer] = users.map((row) => row.id)
      await tx
        .insert(vocabulariesTable)
        .values({ slug, title: slug, createdById: admin })
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug,
          title: slug,
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
      return { admin, steward, member, newcomer, communityId: community.id }
    })
    communityId = fixture.communityId
    userIds = [fixture.admin, fixture.steward, fixture.member, fixture.newcomer]
    const change = (actorId: number, targetId: number, on: boolean) =>
      db.transaction((tx) =>
        setCommunityMember(tx, {
          communityId: fixture.communityId,
          actorId,
          targetId,
          on
        })
      )
    const role = (
      actorId: number,
      targetId: number,
      role: "member" | "steward"
    ) =>
      db.transaction((tx) =>
        setCommunityMemberRole(tx, {
          communityId: fixture.communityId,
          actorId,
          targetId,
          role
        })
      )
    const live = async (userId: number) =>
      db
        .select({ role: communityMembersTable.role })
        .from(communityMembersTable)
        .where(
          and(
            eq(communityMembersTable.communityId, fixture.communityId),
            eq(communityMembersTable.userId, userId),
            isNull(communityMembersTable.removedAt)
          )
        )
    const openToken = randomUUID()
    await db
      .update(communitiesTable)
      .set({ joinToken: openToken })
      .where(eq(communitiesTable.id, fixture.communityId))
    await forbidden(
      db.transaction((tx) =>
        requireOpenCommunityJoin(tx, fixture.communityId, openToken)
      )
    )
    same(await live(fixture.newcomer), [])
    await db
      .update(communitiesTable)
      .set({ visibility: "public" })
      .where(eq(communitiesTable.id, fixture.communityId))
    await db.transaction((tx) =>
      requireOpenCommunityJoin(tx, fixture.communityId, openToken)
    )
    checks++
    await db
      .update(communitiesTable)
      .set({ visibility: "members" })
      .where(eq(communitiesTable.id, fixture.communityId))
    same(
      (
        await db.transaction((tx) =>
          requireCommunityInvitationManager(
            tx,
            fixture.communityId,
            fixture.steward
          )
        )
      ).visibility,
      "members"
    )
    await forbidden(change(fixture.member, fixture.newcomer, true))
    await change(fixture.steward, fixture.newcomer, true)
    same(await live(fixture.newcomer), [{ role: "member" }])
    await forbidden(role(fixture.steward, fixture.newcomer, "steward"))
    await role(fixture.admin, fixture.newcomer, "steward")
    await forbidden(change(fixture.steward, fixture.newcomer, false))
    await db
      .update(usersTable)
      .set({ activeCommunityId: fixture.communityId })
      .where(eq(usersTable.id, fixture.newcomer))
    await change(fixture.newcomer, fixture.newcomer, false)
    same(await live(fixture.newcomer), [])
    same(
      (
        await db
          .select({ active: usersTable.activeCommunityId })
          .from(usersTable)
          .where(eq(usersTable.id, fixture.newcomer))
      )[0].active,
      null
    )

    // A queued add cannot retain authority read before another transaction
    // removes the steward. Wait for an observed database lock, not a timer.
    const held = deferred(),
      release = deferred()
    const removal = db.transaction(async (tx) => {
      await tx
        .select({ id: communitiesTable.id })
        .from(communitiesTable)
        .where(eq(communitiesTable.id, fixture.communityId))
        .for("update")
      held.resolve()
      await release.promise
      await setCommunityMember(tx, {
        communityId: fixture.communityId,
        actorId: fixture.admin,
        targetId: fixture.steward,
        on: false
      })
    })
    await held.promise
    let pendingPid: number | undefined
    const queued = db
      .transaction(async (tx) => {
        pendingPid = Number(
          (await tx.execute(sql`SELECT pg_backend_pid() pid`)).rows[0].pid
        )
        return setCommunityMember(tx, {
          communityId: fixture.communityId,
          actorId: fixture.steward,
          targetId: fixture.newcomer,
          on: true
        })
      })
      .then(
        () => ({ code: "unexpected-success" }),
        (error: { code?: string }) => error
      )
    try {
      let blocked = false
      for (let attempt = 0; attempt < 250 && !blocked; attempt++) {
        if (pendingPid)
          blocked = Boolean(
            (
              await db.execute(
                sql`SELECT cardinality(pg_blocking_pids(${pendingPid})) > 0 blocked`
              )
            ).rows[0].blocked
          )
        if (!blocked) await delay(20)
      }
      same(blocked, true)
    } finally {
      release.resolve()
      await removal
    }
    same((await queued).code, "FORBIDDEN")
    same(await live(fixture.newcomer), [])
    same(await live(fixture.steward), [])
    await forbidden(
      db.transaction((tx) =>
        requireCommunityInvitationManager(
          tx,
          fixture.communityId,
          fixture.steward
        )
      )
    )

    await db
      .update(usersTable)
      .set({ role: "user" })
      .where(eq(usersTable.id, fixture.admin))
    await forbidden(role(fixture.admin, fixture.member, "steward"))
    same(await live(fixture.member), [{ role: "member" }])
    console.log(
      `Community membership live authorization and queued-revocation regression passed (${checks} checks).`
    )
  } finally {
    await db.transaction(async (tx) => {
      if (userIds.length)
        await tx
          .update(usersTable)
          .set({ activeCommunityId: null })
          .where(inArray(usersTable.id, userIds))
      if (communityId) {
        await tx
          .delete(communityMembersTable)
          .where(eq(communityMembersTable.communityId, communityId))
        await tx
          .delete(communitiesTable)
          .where(eq(communitiesTable.id, communityId))
      }
      await tx.delete(vocabulariesTable).where(eq(vocabulariesTable.slug, slug))
      if (userIds.length)
        await tx.delete(usersTable).where(inArray(usersTable.id, userIds))
    })
  }
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$client.end())
