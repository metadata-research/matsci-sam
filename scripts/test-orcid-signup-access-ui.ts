// Local browser regression with a simulated ORCID response. Account creation,
// encrypted token storage, profile controls and invitation acceptance are real.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { and, eq, inArray, sql } from "drizzle-orm"
import { expect, type Browser, type BrowserContext } from "@playwright/test"
import {
  db,
  usersTable,
  oauthAccountsTable,
  vocabulariesTable,
  communitiesTable,
  communityMembersTable,
  communityInvitationsTable,
  termsTable,
  definitionsTable,
  definitionRevisionsTable
} from "../drizzle"
import { createOneTimeToken, hashOneTimeToken } from "../lib/auth-tokens"
import { authPathWithReturnTo, profileCompletionPath } from "../lib/auth-return"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import { deleteDefinitionRows } from "../lib/definition-purge"
import {
  launchBrowser,
  signInAs,
  closeBrowserAfterRoutes
} from "./ui-test-harness"
import {
  localOrcidAuthentication,
  requireOrcidSignupTestEnvironment,
  syntheticOrcidId
} from "./orcid-signup-test-harness"

async function fingerprints() {
  const tables = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name`
  )
  const result: Record<string, unknown> = {}
  for (const { table_name } of tables.rows)
    result[table_name] = (
      await db.execute(
        sql`select count(*)::int as count, md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) as hash from ${sql.identifier(table_name)} t`
      )
    ).rows[0]
  return result
}

async function main() {
  const base = requireOrcidSignupTestEnvironment()
  const stamp = randomUUID()
  const slug = `orcid_access_${stamp}`
  const title = "ORCID materials collaboration"
  const secret = `Private working notes ${stamp}`
  const name = `ORCID signup fixture ${stamp}`
  const orcidId = syntheticOrcidId()
  const token = createOneTimeToken()
  const invitationPath = `/invite/${token}`
  const communityPath = `/communities/${slug}`
  const errors: string[] = []
  const blocked: string[] = []
  const output = process.env.SAM_UI_TEST_SCREENSHOTS
  let browser: Browser | undefined
  let before: Awaited<ReturnType<typeof fingerprints>> | undefined
  let fixture:
    | { ownerId: number; communityId: number; invitationId: number }
    | undefined
  let contribution:
    | { termId: number; definitionId: number; revisionId: number }
    | undefined
  let accountId: number | undefined

  const accountRows = () =>
    db.select().from(usersTable).where(eq(usersTable.orcidId, orcidId))
  const membershipRows = (userId: number) =>
    db
      .select()
      .from(communityMembersTable)
      .where(eq(communityMembersTable.userId, userId))
  const catalog = (context: BrowserContext) =>
    context.request.get(`${base}/api/trpc/matcoreWorkflow.catalog`, {
      params: { input: JSON.stringify({ vocabularySlug: slug }) }
    })
  const locked = async (context: BrowserContext) => {
    const response = await context.request.get(base + communityPath)
    assert.equal(response.status(), 200)
    const content = await response.text()
    assert.ok(content.includes(title))
    assert.ok(!content.includes(secret), "Private content must remain hidden")
    assert.equal((await catalog(context)).status(), 404)
  }
  const openContext = async (width: number) => {
    assert.ok(browser)
    const context = await browser.newContext({
      viewport: { width, height: 900 }
    })
    context.on("page", (page) =>
      page.on("pageerror", (error) => errors.push(error.message))
    )
    await context.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      // Do not even reach a local endpoint that could contact an OAuth or mail
      // provider. The synthetic callback below runs directly, outside HTTP.
      const allowed =
        url.origin === base &&
        !url.pathname.startsWith("/api/auth/") &&
        (request.method() === "GET" ||
          (request.method() === "POST" &&
            url.pathname === "/api/trpc/communities.accept"))
      if (!allowed) {
        blocked.push(`${request.method()} ${url.pathname}`)
        return route.abort()
      }
      return route.continue()
    })
    return context
  }

  try {
    before = await fingerprints()
    assert.deepEqual(
      await accountRows(),
      [],
      "The synthetic subject must be unused"
    )
    assert.deepEqual(
      await db
        .select({ id: oauthAccountsTable.id })
        .from(oauthAccountsTable)
        .where(
          and(
            eq(oauthAccountsTable.provider, "orcid"),
            eq(oauthAccountsTable.subject, orcidId)
          )
        ),
      []
    )
    if (output) await mkdir(output, { recursive: true })
    fixture = await db.transaction(async (tx) => {
      const [owner] = await tx
        .insert(usersTable)
        .values({
          name: `ORCID fixture owner ${stamp}`,
          email: `orcid-owner-${stamp}@example.test`
        })
        .returning()
      await tx
        .insert(vocabulariesTable)
        .values({ slug, title, createdById: owner.id })
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug,
          vocabularySlug: slug,
          title,
          description: secret,
          visibility: "members",
          createdById: owner.id
        })
        .returning()
      await tx.insert(communityMembersTable).values({
        communityId: community.id,
        userId: owner.id,
        addedById: owner.id,
        role: "steward"
      })
      const [invitation] = await tx
        .insert(communityInvitationsTable)
        .values({
          communityId: community.id,
          invitedById: owner.id,
          email: `orcid-invited-${stamp}@example.test`,
          tokenHash: hashOneTimeToken(token),
          expiresAt: new Date(Date.now() + 3600000).toISOString()
        })
        .returning()
      return {
        ownerId: owner.id,
        communityId: community.id,
        invitationId: invitation.id
      }
    })
    browser = await launchBrowser()

    for (const width of [1280, 390]) {
      const anonymous = await openContext(width)
      await locked(anonymous)
      const page = await anonymous.newPage()
      await page.goto(base + invitationPath)
      await page
        .getByRole("link", { name: "Create an account", exact: true })
        .click()
      await expect(page).toHaveURL(
        base + authPathWithReturnTo("/register", invitationPath)
      )
      await expect(
        page.getByRole("link", {
          name: "Create account with ORCID",
          exact: true
        })
      ).toHaveAttribute(
        "href",
        authPathWithReturnTo("/api/auth/orcid?intent=signup", invitationPath)
      )
      await expect(
        page.getByRole("link", {
          name: "Create account with Google",
          exact: true
        })
      ).toHaveAttribute(
        "href",
        authPathWithReturnTo("/api/auth/google", invitationPath)
      )
      const emailForm = page.locator('form[action="/api/auth/email/start"]')
      await expect(emailForm.locator('input[name="intent"]')).toHaveValue(
        "create"
      )
      await expect(emailForm.locator('input[name="returnTo"]')).toHaveValue(
        invitationPath
      )
      await expect(
        emailForm.getByRole("button", {
          name: "Create account with email",
          exact: true
        })
      ).toBeVisible()
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
      if (output)
        await page.screenshot({
          path: `${output}/orcid-signup-options-${width}.png`,
          fullPage: true
        })
      await anonymous.close()
    }

    const signup = await localOrcidAuthentication({
      orcidId,
      intent: "signup",
      returnTo: invitationPath,
      name
    })
    accountId = signup.userId
    assert.equal(signup.destination, profileCompletionPath(invitationPath))
    const [account] = await accountRows()
    assert.equal(account.id, accountId)
    assert.equal(account.email, null)
    assert.equal(account.emailVerifiedAt, null)
    assert.equal(account.googleId, null)
    assert.equal(account.firstName, null)
    assert.equal(account.lastName, null)
    assert.equal(account.isAi, false)
    assert.equal(account.role, "user")
    assert.equal(account.isProfilePublic, false)
    assert.equal(account.activeCommunityId, null)
    assert.deepEqual(await membershipRows(accountId), [])
    const connections = await db
      .select()
      .from(oauthAccountsTable)
      .where(eq(oauthAccountsTable.userId, accountId))
    assert.equal(connections.length, 1)
    assert.equal(connections[0].subject, orcidId)
    assert.match(connections[0].accessTokenEncrypted!, /^v1\./)
    assert.match(connections[0].refreshTokenEncrypted!, /^v1\./)

    const context = await openContext(390)
    await signInAs(context, base, accountId)
    await locked(context)
    const page = await context.newPage()
    await page.goto(base + signup.destination)
    await expect(
      page.getByRole("button", { name: "Disconnect", exact: true })
    ).toBeDisabled()
    await expect(
      page.getByText(
        "ORCID is your only sign-in method and cannot be disconnected.",
        { exact: true }
      )
    ).toBeVisible()
    if (output)
      await page.screenshot({
        path: `${output}/orcid-optional-profile.png`,
        fullPage: true
      })
    await page
      .getByRole("button", { name: "Skip for now", exact: true })
      .click()
    await expect(page).toHaveURL(base + invitationPath)
    await locked(context)
    assert.deepEqual(await membershipRows(accountId), [])
    assert.equal(
      (
        await db.query.communityInvitationsTable.findFirst({
          where: eq(communityInvitationsTable.id, fixture.invitationId)
        })
      )?.redeemedAt,
      null
    )
    await page
      .getByRole("button", { name: `Join ${title}`, exact: true })
      .click()
    await expect(page).toHaveURL(base + communityPath, { timeout: 45000 })
    const memberships = await membershipRows(accountId)
    assert.equal(memberships.length, 1)
    assert.equal(memberships[0].communityId, fixture.communityId)
    assert.equal(memberships[0].role, "member")
    assert.equal(
      (
        await db.query.communityInvitationsTable.findFirst({
          where: eq(communityInvitationsTable.id, fixture.invitationId)
        })
      )?.redeemedById,
      accountId
    )
    assert.equal((await catalog(context)).status(), 200)
    assert.ok(
      (await (await context.request.get(base + communityPath)).text()).includes(
        secret
      )
    )
    if (output)
      await page.screenshot({
        path: `${output}/orcid-joined-community.png`,
        fullPage: true
      })

    // Seed a contribution through the real revision helper so repeated sign-in
    // can verify existing authorship. This does not claim browser publication.
    contribution = await db.transaction(async (tx) => {
      const [term] = await tx
        .insert(termsTable)
        .values({
          term: `orcid identity fixture ${stamp}`,
          slug,
          vocabularySlug: slug
        })
        .returning()
      const created = await createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: accountId!,
        definition: `An identity-preservation fixture ${stamp}.`,
        example: "",
        changeNote: "Local ORCID signup regression fixture",
        source: "initial"
      })
      return {
        termId: term.id,
        definitionId: created.definition.id,
        revisionId: created.revision.id
      }
    })
    const originalDefinition = await db.query.definitionsTable.findFirst({
      where: eq(definitionsTable.id, contribution.definitionId)
    })
    const originalRevision = await db.query.definitionRevisionsTable.findFirst({
      where: eq(definitionRevisionsTable.id, contribution.revisionId)
    })
    await context.close()
    for (const intent of ["login", "signup"] as const) {
      const repeated = await localOrcidAuthentication({
        orcidId,
        intent,
        returnTo: communityPath,
        name: "Changed provider name"
      })
      assert.equal(repeated.userId, accountId)
      assert.equal(repeated.destination, communityPath)
      assert.equal((await accountRows()).length, 1)
      assert.equal((await accountRows())[0].name, name)
      assert.deepEqual(
        await db.query.definitionsTable.findFirst({
          where: eq(definitionsTable.id, contribution.definitionId)
        }),
        originalDefinition
      )
      assert.deepEqual(
        await db.query.definitionRevisionsTable.findFirst({
          where: eq(definitionRevisionsTable.id, contribution.revisionId)
        }),
        originalRevision
      )
      assert.equal(originalDefinition?.authorId, accountId)
      assert.equal(originalRevision?.editorId, accountId)
      const returning = await openContext(1280)
      await signInAs(returning, base, repeated.userId)
      const returningPage = await returning.newPage()
      await returningPage.goto(base + repeated.destination)
      assert.equal((await catalog(returning)).status(), 200)
      await returningPage.goto(base + "/profile")
      await expect(
        returningPage.getByRole("link", {
          name: `orcid identity fixture ${stamp}`
        })
      ).toBeVisible()
      await returning.close()
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(blocked, [])
  } finally {
    try {
      if (browser) await closeBrowserAfterRoutes(browser)
      if (fixture)
        await db.transaction(async (tx) => {
          const [owner] = await tx
            .select()
            .from(usersTable)
            .where(eq(usersTable.id, fixture!.ownerId))
          assert.equal(owner?.name, `ORCID fixture owner ${stamp}`)
          const newcomers = await tx
            .select()
            .from(usersTable)
            .where(eq(usersTable.orcidId, orcidId))
          assert.ok(newcomers.length <= 1)
          for (const newcomer of newcomers) {
            assert.equal(newcomer.name, name)
            if (accountId) assert.equal(newcomer.id, accountId)
          }
          if (contribution) {
            const [definition] = await tx
              .select()
              .from(definitionsTable)
              .where(eq(definitionsTable.id, contribution.definitionId))
            assert.equal(definition?.authorId, accountId)
            await deleteDefinitionRows(tx, contribution.definitionId)
            await tx
              .delete(termsTable)
              .where(
                and(
                  eq(termsTable.id, contribution.termId),
                  eq(termsTable.vocabularySlug, slug)
                )
              )
          }
          const ids = [fixture!.ownerId, ...newcomers.map((user) => user.id)]
          await tx
            .update(usersTable)
            .set({ activeCommunityId: null })
            .where(inArray(usersTable.id, ids))
          await tx
            .delete(communityInvitationsTable)
            .where(eq(communityInvitationsTable.id, fixture!.invitationId))
          await tx
            .delete(communityMembersTable)
            .where(
              and(
                eq(communityMembersTable.communityId, fixture!.communityId),
                inArray(communityMembersTable.userId, ids)
              )
            )
          await tx
            .delete(communitiesTable)
            .where(
              and(
                eq(communitiesTable.id, fixture!.communityId),
                eq(communitiesTable.slug, slug)
              )
            )
          await tx
            .delete(vocabulariesTable)
            .where(eq(vocabulariesTable.slug, slug))
          await tx.delete(usersTable).where(inArray(usersTable.id, ids))
        })
      if (before)
        assert.deepEqual(
          await fingerprints(),
          before,
          "Every retained public table must match after exact fixture cleanup"
        )
    } finally {
      await db.$client.end()
    }
  }
  console.log(
    "PASS local ORCID callback signup, encrypted account storage, optional profile skip, private access before explicit join, member role, sole-method disconnect protection, repeat login/signup and preserved fixture authorship. ORCID responses and cookie transport were simulated; no provider or email was contacted. Every retained public table matched after fixture cleanup."
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
