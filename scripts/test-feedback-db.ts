import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq, inArray, like } from "drizzle-orm"
import {
  db,
  usersTable,
  siteFeedbackTable,
  vocabulariesTable,
  communitiesTable,
  communityMembersTable
} from "../drizzle"
import { feedbackRouter } from "../trpc/routers/feedback"
import { adminRouter } from "../trpc/routers/admin"
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
  process.env.GRAPH_PROJECTION_ENABLED = "false"
  const before = await reviewFingerprints()
  const stamp = `feedback_${randomUUID().replaceAll("-", "")}`
  let people: number[] = []
  let communityId: number | undefined
  const context = (id?: number) => ({ session: id ? { id } : {} }) as never
  const feedback = (id?: number) => feedbackRouter.createCaller(context(id))
  const admin = (id?: number) => adminRouter.createCaller(context(id))
  const rows = () =>
    db
      .select()
      .from(siteFeedbackTable)
      .where(like(siteFeedbackTable.message, `${stamp}%`))
  try {
    const fixture = await db.transaction(async (tx) => {
      const users = await tx
        .insert(usersTable)
        .values([
          { name: "Feedback administrator", role: "admin" },
          { name: "Feedback member" },
          { name: "Feedback moderator", role: "moderator" },
          { name: "Feedback steward" }
        ])
        .returning({ id: usersTable.id })
      const [administrator, member, moderator, steward] = users.map(
        (user) => user.id
      )
      await tx.insert(vocabulariesTable).values({
        slug: stamp,
        title: "Feedback checks",
        createdById: administrator
      })
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug: stamp,
          vocabularySlug: stamp,
          title: "Feedback checks",
          visibility: "members",
          createdById: administrator
        })
        .returning({ id: communitiesTable.id })
      await tx.insert(communityMembersTable).values({
        communityId: community.id,
        userId: steward,
        role: "steward",
        addedById: administrator
      })
      return {
        administrator,
        member,
        moderator,
        steward,
        communityId: community.id,
        people: users.map((user) => user.id)
      }
    })
    people = fixture.people
    communityId = fixture.communityId
    const pagePath = `/communities/${stamp}`
    const message = `${stamp} Please make the feedback destination clearer.`
    same(
      await feedback(fixture.member).submit({
        message: `  ${message}  `,
        pagePath,
        userId: fixture.administrator
      } as never),
      { ok: true }
    )
    const [saved] = await rows()
    same(saved.userId, fixture.member)
    same(saved.message, message)
    same(saved.pagePath, pagePath)
    same(saved.status, "open")
    await feedback().submit({
      message: `${stamp} Anonymous comment`,
      pagePath: "/docs"
    })
    const anonymous = (await rows()).find((row) => row.userId === null)!
    same(anonymous.pagePath, "/docs")
    same(
      await feedback().submit({
        message: `${stamp} Bot comment`,
        pagePath: "/",
        website: "example.test"
      }),
      { ok: true }
    )
    same((await rows()).length, 2)
    for (const invalidPath of [
      "//example.test",
      "/api/auth/email",
      "/_next/data",
      "/../admin",
      "/%2fexample.test",
      "/docs?token=private",
      "/docs#private"
    ])
      await rejected(
        feedback().submit({ message, pagePath: invalidPath }),
        "BAD_REQUEST"
      )
    for (const invalid of ["", " ", "x".repeat(2001)])
      await rejected(
        feedback().submit({ message: invalid, pagePath: "/" }),
        "BAD_REQUEST"
      )

    for (const id of [
      undefined,
      fixture.member,
      fixture.moderator,
      fixture.steward
    ]) {
      const code = id ? "FORBIDDEN" : "UNAUTHORIZED"
      await rejected(admin(id).feedbackInbox({ status: "all" }), code)
      await rejected(
        admin(id).setFeedbackStatus({
          feedbackId: saved.id,
          status: "resolved"
        }),
        code
      )
    }
    same((await rows()).find((row) => row.id === saved.id)?.status, "open")
    const inbox = admin(fixture.administrator)
    const first = await inbox.feedbackInbox({ status: "open", limit: 1 })
    same(first.items[0].id, anonymous.id)
    same(first.nextCursor, anonymous.id)
    const second = await inbox.feedbackInbox({
      status: "open",
      limit: 1,
      cursor: first.nextCursor!
    })
    same(second.items[0].id, saved.id)
    same(second.items[0].author?.name, "Feedback member")
    const resolved = await inbox.setFeedbackStatus({
      feedbackId: saved.id,
      status: "resolved"
    })
    same(resolved.status, "resolved")
    same(resolved.resolvedByUserId, fixture.administrator)
    same(Boolean(resolved.resolvedAt), true)
    same(
      (await inbox.feedbackInbox({ status: "open" })).items.some(
        (item) => item.id === saved.id
      ),
      false
    )
    same(
      (
        await admin(fixture.administrator).feedbackInbox({ status: "resolved" })
      ).items.find((item) => item.id === saved.id)?.resolver?.name,
      "Feedback administrator"
    )
    const reopened = await inbox.setFeedbackStatus({
      feedbackId: saved.id,
      status: "open"
    })
    same(reopened.status, "open")
    same(reopened.resolvedAt, null)
    same(reopened.resolvedByUserId, null)
    same(
      (await inbox.feedbackInbox({ status: "all" })).items.filter((item) =>
        [saved.id, anonymous.id].includes(item.id)
      ).length,
      2
    )
    await db
      .update(usersTable)
      .set({ role: "user" })
      .where(eq(usersTable.id, fixture.administrator))
    await rejected(inbox.feedbackInbox({ status: "all" }), "FORBIDDEN")
    await rejected(
      inbox.setFeedbackStatus({ feedbackId: saved.id, status: "resolved" }),
      "FORBIDDEN"
    )
  } finally {
    await db.transaction(async (tx) => {
      await tx
        .delete(siteFeedbackTable)
        .where(like(siteFeedbackTable.message, `${stamp}%`))
      if (communityId) {
        await tx
          .delete(communityMembersTable)
          .where(eq(communityMembersTable.communityId, communityId))
        await tx
          .delete(communitiesTable)
          .where(eq(communitiesTable.id, communityId))
      }
      await tx
        .delete(vocabulariesTable)
        .where(eq(vocabulariesTable.slug, stamp))
      if (people.length)
        await tx.delete(usersTable).where(inArray(usersTable.id, people))
    })
  }
  same(await reviewFingerprints(), before)
  console.log(
    `Feedback workflow passed (${checks} checks): submission, validation, administrator-only inbox/status changes, pagination, resolution, reopening and preservation.`
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$client.end())
