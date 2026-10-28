import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { and, eq, inArray } from "drizzle-orm"
import { expect, type BrowserContext } from "@playwright/test"
import {
  db,
  usersTable,
  vocabulariesTable,
  communitiesTable,
  communityMembersTable,
  communityInvitationsTable,
  communityAccessRequestsTable
} from "../drizzle"
import { createOneTimeToken, hashOneTimeToken } from "../lib/auth-tokens"
import { launchBrowser, localPreviewBase, signInAs } from "./ui-test-harness"
import { localGoogleSignup } from "./google-signup-test-harness"

async function main() {
  const base = localPreviewBase()
  const browser = await launchBrowser()
  const stamp = randomUUID()
  const slug = `google_access_${stamp}`
  const title = "Materials collaboration"
  const secret = `Private working notes ${stamp}`
  const emails = [
    `invited-${stamp}@example.test`,
    `requester-${stamp}@example.test`
  ]
  const token = createOneTimeToken()
  const path = `/communities/${slug}`
  const errors: string[] = []
  let ownerId: number | undefined
  let communityId: number | undefined
  const output = process.env.SAM_UI_TEST_SCREENSHOTS
  if (output) await mkdir(output, { recursive: true })
  const catalog = async (context: BrowserContext, vocabularySlug: string) =>
    context.request.get(`${base}/api/trpc/matcoreWorkflow.catalog`, {
      params: { input: JSON.stringify({ vocabularySlug }) }
    })
  const locked = async (context: BrowserContext) => {
    const response = await context.request.get(base + path)
    assert.equal(response.status(), 200)
    assert.ok((await response.text()).includes(title))
    assert.ok(!(await response.text()).includes(secret))
    assert.equal((await catalog(context, slug)).status(), 404)
  }
  const openContext = async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }
    })
    context.on("page", (page) =>
      page.on("pageerror", (error) => errors.push(error.message))
    )
    await context.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const allowed = [
        "/api/trpc/communities.accept",
        "/api/trpc/communities.requestAccess",
        "/api/trpc/communities.reviewAccessRequest"
      ]
      if (
        url.origin !== base ||
        (request.method() !== "GET" && !allowed.includes(url.pathname))
      ) {
        errors.push(`Unexpected request ${request.method()} ${url.pathname}`)
        return route.abort()
      }
      return route.continue()
    })
    return context
  }
  try {
    const [owner] = await db
      .insert(usersTable)
      .values({
        name: "Community steward",
        email: `owner-${stamp}@example.test`
      })
      .returning()
    ownerId = owner.id
    await db
      .insert(vocabulariesTable)
      .values({ slug, title, createdById: ownerId })
    const [community] = await db
      .insert(communitiesTable)
      .values({
        slug,
        vocabularySlug: slug,
        title,
        description: secret,
        visibility: "members",
        createdById: ownerId
      })
      .returning()
    communityId = community.id
    await db.insert(communityMembersTable).values({
      communityId,
      userId: ownerId,
      addedById: ownerId,
      role: "steward"
    })
    await db.insert(communityInvitationsTable).values({
      communityId,
      invitedById: ownerId,
      email: emails[0],
      tokenHash: hashOneTimeToken(token),
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    })
    const anonymous = await openContext()
    await locked(anonymous)
    const signupPage = await anonymous.newPage()
    await signupPage.goto(`${base}/invite/${token}`)
    await signupPage
      .getByRole("link", { name: "Create an account", exact: true })
      .click()
    await expect(
      signupPage.getByRole("link", {
        name: "Create account with Google",
        exact: true
      })
    ).toHaveAttribute(
      "href",
      `/api/auth/google?returnTo=${encodeURIComponent(`/invite/${token}`)}`
    )
    if (output)
      await signupPage.screenshot({
        path: `${output}/google-signup-options.png`,
        fullPage: true,
        caret: "initial"
      })
    await signupPage.close()
    const matcore = await db.query.communitiesTable.findFirst({
      where: eq(communitiesTable.slug, "matcore_development")
    })
    if (matcore) {
      assert.equal(matcore.visibility, "members")
      assert.equal(
        (await catalog(anonymous, matcore.vocabularySlug)).status(),
        404
      )
    }
    const steward = await openContext()
    await signInAs(steward, base, ownerId)
    for (const [index, email] of emails.entries()) {
      const returnTo = index === 0 ? `/invite/${token}` : path
      const signup = await localGoogleSignup(email, returnTo)
      const account = await db.query.usersTable.findFirst({
        where: eq(usersTable.id, signup.userId)
      })
      assert.ok(account?.googleId && account.emailVerifiedAt)
      assert.equal(account.role, "user")
      assert.equal(account.activeCommunityId, null)
      assert.deepEqual(
        await db
          .select({ id: communityMembersTable.id })
          .from(communityMembersTable)
          .where(eq(communityMembersTable.userId, signup.userId)),
        []
      )
      const context = await openContext()
      await signInAs(context, base, signup.userId)
      await locked(context)
      if (matcore)
        assert.equal(
          (await catalog(context, matcore.vocabularySlug)).status(),
          404
        )
      const page = await context.newPage()
      await page.goto(base + signup.destination)
      await page
        .getByRole("button", { name: "Skip for now", exact: true })
        .click()
      await expect(page).toHaveURL(base + returnTo)
      await locked(context)
      if (index === 0) {
        await page
          .getByRole("button", { name: `Join ${title}`, exact: true })
          .click()
        await expect(page).toHaveURL(base + path, { timeout: 30000 })
        const [invitation] = await db
          .select({ redeemedById: communityInvitationsTable.redeemedById })
          .from(communityInvitationsTable)
          .where(eq(communityInvitationsTable.communityId, communityId))
        assert.equal(invitation?.redeemedById, signup.userId)
      } else {
        await expect(
          page.getByRole("button", { name: "Request access", exact: true })
        ).toBeVisible()
        if (output)
          await page.screenshot({
            path: `${output}/google-account-private-community.png`,
            fullPage: true,
            caret: "initial"
          })
        await page
          .getByRole("button", { name: "Request access", exact: true })
          .click()
        await expect(page.getByRole("status")).toContainText("awaiting review")
        await page.reload()
        await expect(page.getByRole("status")).toContainText("awaiting review")
        await locked(context)
        const request = await db.query.communityAccessRequestsTable.findFirst({
          where: and(
            eq(communityAccessRequestsTable.communityId, communityId),
            eq(communityAccessRequestsTable.requesterId, signup.userId)
          )
        })
        assert.ok(request)
        const selfApproval = await context.request.post(
          `${base}/api/trpc/communities.reviewAccessRequest`,
          { data: { id: request.id, approve: true } }
        )
        assert.equal(selfApproval.status(), 403)
        await locked(context)
        const stewardPage = await steward.newPage()
        await stewardPage.goto(base + path + "?view=people")
        await stewardPage
          .getByRole("region", { name: "Access requests" })
          .getByRole("button", { name: "Approve", exact: true })
          .click()
        await expect(
          stewardPage.getByText("No requests are awaiting review.")
        ).toBeVisible()
        await page.reload()
      }
      assert.equal((await catalog(context, slug)).status(), 200)
      const [membership] = await db
        .select({ role: communityMembersTable.role })
        .from(communityMembersTable)
        .where(
          and(
            eq(communityMembersTable.communityId, communityId),
            eq(communityMembersTable.userId, signup.userId)
          )
        )
      assert.equal(membership?.role, "member")
      if (matcore)
        assert.equal(
          (await catalog(context, matcore.vocabularySlug)).status(),
          404,
          "Joining another community cannot grant MatCore access"
        )
    }
    assert.deepEqual(errors, [])
    console.log(
      `PASS open Google callback signup, no automatic membership, private name/content separation, invitation acceptance, pending access request, rejected self-approval, steward approval and ordinary member role. ${matcore ? "Existing local MatCore catalog remained inaccessible to both new accounts." : "No existing MatCore catalog was present; generic private-community checks passed."}`
    )
  } finally {
    await browser.close()
    await db.transaction(async (tx) => {
      const newcomers = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.email, emails))
      const ids = [
        ...newcomers.map((user) => user.id),
        ...(ownerId ? [ownerId] : [])
      ]
      if (ids.length)
        await tx
          .update(usersTable)
          .set({ activeCommunityId: null })
          .where(inArray(usersTable.id, ids))
      if (communityId) {
        await tx
          .delete(communityAccessRequestsTable)
          .where(eq(communityAccessRequestsTable.communityId, communityId))
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
      if (ids.length)
        await tx.delete(usersTable).where(inArray(usersTable.id, ids))
    })
    await db.$client.end()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
