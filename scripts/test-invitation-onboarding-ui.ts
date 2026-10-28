// Local-only UI regression. Email delivery is intercepted; verification and
// invitation acceptance use the real handlers and disposable database records.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { eq, inArray } from "drizzle-orm"
import { expect } from "@playwright/test"
import {
  db,
  usersTable,
  vocabulariesTable,
  communitiesTable,
  communityInvitationsTable,
  communityMembersTable,
  emailAuthTokensTable
} from "../drizzle"
import { createOneTimeToken, hashOneTimeToken } from "../lib/auth-tokens"
import {
  hashEmailAuthToken,
  createEmailAuthLinkFragment
} from "../lib/email-auth-token"
import { authPathWithReturnTo, profileCompletionPath } from "../lib/auth-return"
import { launchBrowser, localPreviewBase } from "./ui-test-harness"

async function main() {
  const base = localPreviewBase()
  const browser = await launchBrowser()
  const stamp = randomUUID()
  const slug = `materials_invitation_${stamp}`
  const title = "Materials collaboration"
  const address = `invitation-${stamp}@example.test`
  const invitationToken = createOneTimeToken()
  const emailToken = createOneTimeToken()
  const destination = `/invite/${invitationToken}`
  const output = process.env.SAM_UI_TEST_SCREENSHOTS
  const errors: string[] = []
  const unexpected: string[] = []
  let ownerId: number | undefined
  let communityId: number | undefined
  let invitationId: number | undefined
  if (output) await mkdir(output, { recursive: true })
  try {
    const owner = await db
      .insert(usersTable)
      .values({
        name: "Invitation fixture owner",
        email: `owner-${stamp}@example.test`
      })
      .returning()
    ownerId = owner[0].id
    await db
      .insert(vocabulariesTable)
      .values({ slug, title, createdById: ownerId })
    const community = await db
      .insert(communitiesTable)
      .values({
        slug,
        vocabularySlug: slug,
        title,
        createdById: ownerId,
        visibility: "members"
      })
      .returning()
    communityId = community[0].id
    const invitation = await db
      .insert(communityInvitationsTable)
      .values({
        communityId,
        invitedById: ownerId,
        email: address,
        tokenHash: hashOneTimeToken(invitationToken),
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      })
      .returning()
    invitationId = invitation[0].id
    const savedInvitation = () =>
      db.query.communityInvitationsTable.findFirst({
        where: eq(communityInvitationsTable.id, invitationId!)
      })

    for (const viewport of [
      { width: 1280, height: 1000 },
      { width: 390, height: 844 }
    ]) {
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()
      page.on("pageerror", (error) => errors.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text())
      })
      let submitted: URLSearchParams | undefined
      await context.route("**/*", async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.origin !== base) {
          unexpected.push(`external request: ${url.origin}`)
          return route.abort()
        }
        if (
          request.method() === "POST" &&
          url.pathname === "/api/auth/email/start"
        ) {
          submitted = new URLSearchParams(request.postData()!)
          const redirect = authPathWithReturnTo(
            "/register/check-email?intent=create",
            destination
          )
          return route.fulfill({
            status: 303,
            headers: { location: redirect },
            body: ""
          })
        }
        const permittedWrite =
          viewport.width === 390 &&
          (url.pathname === "/api/auth/email/verify" ||
            url.pathname === "/api/trpc/communities.accept")
        if (request.method() !== "GET" && !permittedWrite) {
          unexpected.push(`unexpected ${request.method()} ${url.pathname}`)
          return route.abort()
        }
        return route.continue()
      })
      await page.goto(base + destination)
      await expect(page).toHaveTitle(/Invitation/)
      await expect(
        page.getByText(`Join ${title}`, { exact: true })
      ).toBeVisible()
      await expect(
        page.getByRole("link", { name: "Create an account", exact: true })
      ).toBeVisible()
      await expect(
        page.getByRole("link", { name: "Sign in", exact: true })
      ).toBeVisible()
      if (output)
        await page.screenshot({
          path: `${output}/invitation-${viewport.width}.png`,
          fullPage: true,
          caret: "initial"
        })
      await page
        .getByRole("link", { name: "Create an account", exact: true })
        .click()
      await expect(page).toHaveURL(
        base + authPathWithReturnTo("/register", destination)
      )
      await expect(
        page
          .locator('[data-slot="card-title"]')
          .filter({ hasText: /^Create an account(?: with email)?$/ })
      ).toBeVisible()
      await page.getByLabel("Email address", { exact: true }).fill(address)
      if (output)
        await page.screenshot({
          path: `${output}/signup-${viewport.width}.png`,
          fullPage: true,
          caret: "initial"
        })
      await page
        .getByRole("button", { name: "Create account with email", exact: true })
        .click()
      await expect(
        page.getByText("Check your email to create your account", {
          exact: true
        })
      ).toBeVisible()
      assert.equal(submitted?.get("intent"), "create")
      assert.equal(submitted?.get("returnTo"), destination)
      assert.equal(submitted?.get("email"), address)

      await page.goto(
        base + authPathWithReturnTo("/login?google=not-authorized", destination)
      )
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Google sign-in is restricted" })
      ).toBeVisible()
      await expect(
        page.getByRole("link", {
          name: "Create an account with email",
          exact: true
        })
      ).toHaveCount(1)
      if (output)
        await page.screenshot({
          path: `${output}/google-recovery-${viewport.width}.png`,
          fullPage: true,
          caret: "initial"
        })
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        ),
        true
      )
      await page
        .getByRole("link", {
          name: "Create an account with email",
          exact: true
        })
        .click()
      await expect(page).toHaveURL(
        base + authPathWithReturnTo("/register", destination)
      )
      await page.getByRole("link", { name: "Sign in", exact: true }).click()
      await expect(page).toHaveURL(
        base + authPathWithReturnTo("/login", destination)
      )
      assert.equal((await savedInvitation())?.redeemedAt, null)

      if (viewport.width === 390) {
        // Supply the token that mail would contain. The start-route unit test
        // verifies issuance and deferred delivery; this run sends no email.
        await db.insert(emailAuthTokensTable).values({
          email: address,
          tokenHash: hashEmailAuthToken(emailToken, destination),
          allowAccountCreation: true,
          expiresAt: new Date(Date.now() + 600000).toISOString()
        })
        await page.goto(
          `${base}/register/verify#${createEmailAuthLinkFragment(emailToken, destination)}`
        )
        await expect(page).toHaveURL(
          base + profileCompletionPath(destination),
          { timeout: 45000 }
        )
        await page
          .getByRole("button", { name: "Skip for now", exact: true })
          .click()
        await expect(page).toHaveURL(base + destination)
        await expect(
          page.getByRole("button", { name: `Join ${title}`, exact: true })
        ).toBeVisible()
        assert.equal(
          (await savedInvitation())?.redeemedAt,
          null,
          "Signup and profile skip must not accept an invitation"
        )
        const newcomer = await db.query.usersTable.findFirst({
          where: eq(usersTable.email, address)
        })
        assert.ok(newcomer?.emailVerifiedAt)
        assert.equal(newcomer.name, "")
        await page
          .getByRole("button", { name: `Join ${title}`, exact: true })
          .click()
        await expect(page).toHaveURL(base + `/communities/${slug}`, {
          timeout: 45000
        })
        assert.equal((await savedInvitation())?.redeemedById, newcomer.id)
        const [member] = await db
          .select({
            userId: communityMembersTable.userId,
            role: communityMembersTable.role
          })
          .from(communityMembersTable)
          .where(eq(communityMembersTable.communityId, communityId))
        assert.equal(member?.userId, newcomer.id)
        assert.equal(member?.role, "member")
      }
      await context.close()
    }
    assert.deepEqual(unexpected, [])
    assert.deepEqual(errors, [])
    console.log(
      "Local invitation UI passed at 1280 and 390 pixels: signup form, Google recovery, return links, email verification, profile skip, explicit acceptance and member role. Email delivery and Google provider responses were simulated."
    )
  } catch (error) {
    console.error({ browserErrors: errors, unexpectedRequests: unexpected })
    throw error
  } finally {
    await browser.close()
    await db.transaction(async (tx) => {
      await tx
        .delete(emailAuthTokensTable)
        .where(eq(emailAuthTokensTable.email, address))
      const newcomer = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, address))
      const ids = [
        ...newcomer.map((user) => user.id),
        ...(ownerId ? [ownerId] : [])
      ]
      if (ids.length)
        await tx
          .update(usersTable)
          .set({ activeCommunityId: null })
          .where(inArray(usersTable.id, ids))
      if (invitationId)
        await tx
          .delete(communityInvitationsTable)
          .where(eq(communityInvitationsTable.id, invitationId))
      if (communityId) {
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
