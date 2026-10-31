// Real membership writes in a local disposable database. Hold the successful
// response and destination separately to distinguish saving from navigation.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { eq, inArray } from "drizzle-orm"
import { expect } from "@playwright/test"
import {
  db,
  usersTable,
  vocabulariesTable,
  communitiesTable,
  communityInvitationsTable,
  communityMembersTable
} from "../drizzle"
import { createOneTimeToken, hashOneTimeToken } from "../lib/auth-tokens"
import {
  launchBrowser,
  localPreviewBase,
  signInAs,
  closeBrowserAfterRoutes
} from "./ui-test-harness"

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

async function main() {
  const base = localPreviewBase()
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /security|_ci|scratch/
  )
  const browser = await launchBrowser()
  const stamp = randomUUID()
  const slug = `invitation_join_${stamp}`
  const title = "Materials collaboration"
  const target = `/communities/${slug}`
  const output = process.env.SAM_UI_TEST_SCREENSHOTS
  const errors: string[] = []
  const timings: {
    width: number
    acceptanceMs: number
    destinationMs: number
  }[] = []
  const userIds: number[] = []
  let communityId: number | undefined
  if (output) await mkdir(output, { recursive: true })
  try {
    const [owner] = await db
      .insert(usersTable)
      .values({
        name: "Materials steward",
        email: `owner-${stamp}@example.test`
      })
      .returning()
    userIds.push(owner.id)
    await db
      .insert(vocabulariesTable)
      .values({ slug, title, createdById: owner.id })
    const [community] = await db
      .insert(communitiesTable)
      .values({
        slug,
        vocabularySlug: slug,
        title,
        visibility: "members",
        createdById: owner.id
      })
      .returning()
    communityId = community.id
    for (const width of [1280, 390]) {
      const [user] = await db
        .insert(usersTable)
        .values({
          name: "Materials contributor",
          email: `member-${width}-${stamp}@example.test`
        })
        .returning()
      userIds.push(user.id)
      const token = createOneTimeToken()
      const [invitation]: { id: number }[] = await db
        .insert(communityInvitationsTable)
        .values({
          communityId,
          invitedById: owner.id,
          email: user.email!,
          tokenHash: hashOneTimeToken(token),
          expiresAt: new Date(Date.now() + 3600000).toISOString()
        })
        .returning({ id: communityInvitationsTable.id })
      const context = await browser.newContext({
        viewport: { width, height: 900 }
      })
      await signInAs(context, base, user.id)
      const page = await context.newPage()
      page.on("pageerror", (error) => errors.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text())
      })
      const deliverResponse = gate()
      const deliverDestination = gate()
      let attempts = 0
      let joined = false
      let destinationRequested = false
      let interrupted = false
      let acceptanceMs = 0
      let destinationMs = 0
      await context.route("**/*", async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.origin !== base) {
          errors.push(`External request: ${url.origin}`)
          return route.abort()
        }
        if (
          request.method() === "POST" &&
          url.pathname === "/api/trpc/communities.accept"
        ) {
          attempts++
          const start = performance.now()
          const response = await route.fetch()
          acceptanceMs = Math.round(performance.now() - start)
          assert.ok(response.ok())
          const body = await response.json()
          assert.equal(body[0].result.data.slug, slug)
          joined = true
          await deliverResponse.promise
          return route.fulfill({ response })
        }
        if (request.method() !== "GET") {
          errors.push(`Unexpected write: ${url.pathname}`)
          return route.abort()
        }
        if (joined && url.pathname === target) {
          if (!interrupted) {
            destinationRequested = true
            await deliverDestination.promise
            interrupted = true
            return route.abort("aborted")
          }
          const start = performance.now()
          const response = await route.fetch()
          destinationMs = Math.round(performance.now() - start)
          return route.fulfill({ response })
        }
        return route.continue()
      })
      try {
        // Visit while still a nonmember to exercise previously cached content.
        await page.goto(base + target)
        await expect(
          page.getByText("Members only", { exact: true }).first()
        ).toBeVisible()
        await page.goto(base + `/invite/${token}`)
        const join = page.getByRole("button", {
          name: `Join ${title}`,
          exact: true
        })
        await expect(join).toBeVisible()
        await join.click()
        await expect(
          page.getByRole("button", { name: "Joining…", exact: true })
        ).toBeDisabled()
        await expect.poll(() => joined, { timeout: 30000 }).toBe(true)
        const membership = await db.query.communityMembersTable.findFirst({
          where: (row, { and, eq }) =>
            and(eq(row.communityId, communityId!), eq(row.userId, user.id))
        })
        assert.equal(membership?.role, "member")
        assert.equal(
          (
            await db.query.communityInvitationsTable.findFirst({
              where: eq(communityInvitationsTable.id, invitation.id)
            })
          )?.redeemedById,
          user.id
        )
        assert.equal(attempts, 1)
        deliverResponse.release()
        await expect
          .poll(() => destinationRequested, { timeout: 30000 })
          .toBe(true)
        // Abort the held navigation, equivalent to the browser Stop control.
        // Playwright waits for document navigation before inspecting the page,
        // so let the route handler cancel it before asserting the saved state.
        deliverDestination.release()
        // The old UI offers Join again here although the invitation is spent.
        await expect(join).toHaveCount(0)
        await expect(
          page.getByRole("status").filter({ hasText: `You joined ${title}.` })
        ).toBeVisible()
        const fallback = page.getByRole("link", {
          name: "Open community",
          exact: true
        })
        await expect(fallback).toHaveAttribute("href", target)
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          true
        )
        if (output)
          await page.screenshot({
            path: `${output}/joined-opening-${width}.png`,
            fullPage: true
          })
        // The ordinary link continues without sending another acceptance.
        await fallback.click()
        await expect(page).toHaveURL(base + target, { timeout: 30000 })
        await expect(
          page.getByRole("heading", { name: title, exact: true }).first()
        ).toBeVisible()
        await expect(
          page.getByText("Request access", { exact: true })
        ).toHaveCount(0)
        await expect(
          page.getByRole("link", { name: "My work", exact: true })
        ).toBeVisible()
        assert.equal(
          attempts,
          1,
          "Opening the community must not accept the invitation again"
        )
        await page.reload()
        await expect(
          page.getByRole("link", { name: "My work", exact: true })
        ).toBeVisible()
        if (output)
          await page.screenshot({
            path: `${output}/joined-community-${width}.png`,
            fullPage: true
          })
        timings.push({ width, acceptanceMs, destinationMs })
      } finally {
        deliverResponse.release()
        deliverDestination.release()
        await page.close()
        await context.unrouteAll({ behavior: "wait" })
        await context.close()
      }
    }
    assert.deepEqual(errors, [])
    if (output)
      await writeFile(
        `${output}/join-timings.json`,
        JSON.stringify(timings, null, 2) + "\n"
      )
    console.log(
      "Invitation join passed at 1280 and 390 pixels: private before joining, one acceptance, saved-member feedback during delayed navigation, manual continuation and retained membership after reload."
    )
    console.log(JSON.stringify(timings))
  } finally {
    await closeBrowserAfterRoutes(browser)
    await db.transaction(async (tx) => {
      if (userIds.length)
        await tx
          .update(usersTable)
          .set({ activeCommunityId: null })
          .where(inArray(usersTable.id, userIds))
      if (communityId) {
        await tx
          .delete(communityInvitationsTable)
          .where(eq(communityInvitationsTable.communityId, communityId))
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
    await db.$client.end()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
