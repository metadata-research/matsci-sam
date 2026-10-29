import "dotenv/config"
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { expect, type Browser, type BrowserContext } from "@playwright/test"
import { and, eq, inArray } from "drizzle-orm"
import {
  db,
  communityMembersTable as members,
  usersTable as users,
  vocabularyWorkspaceSettingsTable as settings,
  communityReviewRoundsTable as rounds,
  communityReviewItemsTable as items,
  communityReviewResponsesTable as responses,
  communityReviewEventsTable as events,
  communityReviewInvitationsTable as invitations,
  communityReviewAdmissionsTable as admissions,
  matcoreFieldsTable as fields,
  matcoreSpecDraftsTable as drafts,
  matcoreSpecRevisionsTable as revisions,
  matcoreWorkflowEventsTable as fieldEvents
} from "../drizzle"
import {
  createGuidedSetupFixture,
  removeGuidedSetupFixture,
  type GuidedSetupFixture
} from "./guided-setup-ui-fixture"
import {
  installSyntheticUiSource,
  removeSyntheticUiSource
} from "./fixtures/matcore-source-db-fixture"
import {
  localPreviewBase,
  launchBrowser,
  signInAs,
  closeBrowserAfterRoutes
} from "./ui-test-harness"
import { reviewFingerprints } from "./community-review-test-support"
import { communityReviewHref } from "../lib/community-review-types"

async function main() {
  const base = localPreviewBase(),
    output = resolve(
      process.env.SAM_UI_TEST_OUTPUT_DIR ??
        "../.matsci-stage/community-review-local-20261029/ui"
    )
  await mkdir(output, { recursive: true })
  const before = await reviewFingerprints(),
    fixtures: GuidedSetupFixture[] = [],
    passed: string[] = [],
    blocked: string[] = [],
    errors: string[] = []
  let browser: Browser | undefined,
    source: { created: boolean; releaseId: string } | undefined,
    roundId = "",
    token = "",
    failure: unknown
  const pass = (name: string) => {
    passed.push(name)
    console.log("PASS " + name)
  }
  try {
    const member = await createGuidedSetupFixture()
    fixtures.push(member)
    const organizer = await createGuidedSetupFixture()
    fixtures.push(organizer)
    const newcomer = await createGuidedSetupFixture()
    fixtures.push(newcomer)
    source = await installSyntheticUiSource(member, "review-ui-" + randomUUID())
    await db.insert(settings).values({
      vocabularySlug: member.vocabularySlug,
      metadataEnabled: true,
      matcoreEnabled: true,
      updatedById: member.userId
    })
    await db.insert(members).values({
      communityId: member.communityId,
      userId: organizer.userId,
      role: "steward",
      addedById: member.userId
    })
    async function guard(context: BrowserContext) {
      await context.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url())
        if (
          url.origin !== new URL(base).origin ||
          /\/(aiAssist|termReferences|ontologyContext)\./.test(url.pathname)
        ) {
          blocked.push(url.pathname)
          return route.abort()
        }
        if (request.method() === "GET") return route.continue()
        const paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? [],
          input = request.postDataJSON()?.[0]
        let allowed = false
        if (paths.length === 1 && input) {
          const path = paths[0]
          if (path === "communityReviews.create")
            allowed = input.communityId === member.communityId
          if (
            ["communityReviews.invite", "communityReviews.close"].includes(path)
          )
            allowed = (input.roundId ?? input.id) === roundId
          if (path === "communityReviews.acceptInvitation")
            allowed = Boolean(token) && input.token === token
          if (path === "communityReviews.revokeInvitation")
            allowed =
              (
                await db
                  .select()
                  .from(invitations)
                  .where(
                    and(
                      eq(invitations.id, input.id),
                      eq(invitations.roundId, roundId)
                    )
                  )
              ).length === 1
          if (
            ["communityReviews.save", "communityReviews.suggest"].includes(path)
          )
            allowed =
              (
                await db
                  .select()
                  .from(items)
                  .where(
                    and(eq(items.id, input.itemId), eq(items.roundId, roundId))
                  )
              ).length === 1
          if (path === "matcoreWorkflow.updateDraft")
            allowed =
              (
                await db
                  .select()
                  .from(drafts)
                  .innerJoin(fields, eq(fields.id, drafts.fieldId))
                  .where(
                    and(
                      eq(drafts.id, input.id),
                      eq(fields.vocabularySlug, member.vocabularySlug)
                    )
                  )
              ).length === 1
        }
        if (allowed) return route.continue()
        blocked.push(url.pathname)
        return route.abort()
      })
    }
    browser = await launchBrowser()
    const staff = await browser.newContext({
      viewport: { width: 1440, height: 1000 }
    })
    await signInAs(staff, base, organizer.userId)
    await guard(staff)
    const page = await staff.newPage()
    page.on("pageerror", (error) => errors.push(error.message))
    page.setDefaultTimeout(20000)
    const communityPath = "/communities/" + member.communitySlug
    await page.goto(base + communityPath, { timeout: 120000 })
    await expect(
      page
        .getByRole("navigation", { name: "Community workspace" })
        .getByRole("link")
        .first()
    ).toHaveText("Quick start")
    await expect(
      page.getByRole("link", { name: "Review and respond", exact: true })
    ).toBeVisible()
    await page.getByLabel("Area", { exact: true }).selectOption("pf")
    await expect(page).toHaveURL(/profile=pf/)
    await page.getByRole("link", { name: "Manage reviews" }).click()
    await page
      .getByLabel("Review name", { exact: true })
      .fill("Phase Field feedback")
    await expect(page.getByLabel("Area", { exact: true })).toHaveValue("pf")
    await page.locator("summary").filter({ hasText: "Choose items (" }).click()
    await page
      .getByLabel("Find a field or proposal", { exact: true })
      .fill("no matching field")
    await expect(
      page.getByText("No matching items.", { exact: true })
    ).toBeVisible()
    await page
      .getByLabel("Find a field or proposal", { exact: true })
      .fill("pf")
    await expect(
      page.getByText("No matching items.", { exact: true })
    ).toHaveCount(0)
    await page.getByLabel("Find a field or proposal", { exact: true }).fill("")
    await page
      .getByRole("button", { name: "Create review", exact: true })
      .click()
    await expect(
      page.getByRole("link", { name: "Open review", exact: true })
    ).toBeVisible()
    const stored = await db
      .select()
      .from(rounds)
      .where(eq(rounds.communityId, member.communityId))
    assert.equal(stored.length, 1)
    roundId = stored[0].id
    const [item] = await db
      .select()
      .from(items)
      .where(eq(items.roundId, roundId))
    const href = communityReviewHref(
      member.communitySlug,
      roundId,
      "pf",
      item.id
    )
    pass("Quick start is first and the area reaches review settings")
    await page.screenshot({
      path: resolve(output, "organizer-desktop.png"),
      fullPage: true
    })
    const participant = await browser.newContext({
      viewport: { width: 1280, height: 900 }
    })
    await signInAs(participant, base, member.userId)
    await guard(participant)
    const a = await participant.newPage()
    a.on("pageerror", (error) => errors.push(error.message))
    a.setDefaultTimeout(20000)
    const row = async () =>
      (
        await db
          .select()
          .from(responses)
          .where(
            and(
              eq(responses.itemId, item.id),
              eq(responses.userId, member.userId)
            )
          )
      )[0]
    await a.goto(base + communityPath + "?view=work&profile=pf", {
      timeout: 120000
    })
    const requested = a.getByRole("region", {
      name: "Requested feedback",
      exact: true
    })
    await expect(
      requested.getByText("Phase Field feedback", { exact: true })
    ).toBeVisible()
    await expect(requested).toContainText("0 of")
    await expect(
      a.getByRole("link", { name: "Manage reviews", exact: true })
    ).toHaveCount(0)
    await requested
      .getByRole("link", { name: "Start review", exact: true })
      .click()
    await expect(a).toHaveURL(new RegExp("round=" + roundId))
    pass(
      "Steward review appears in an ordinary member's My work and opens the first unanswered item"
    )
    await a.goto(base + href, { timeout: 120000 })
    await expect(a.getByLabel("Comment (optional)")).toBeHidden()
    const ruleSummary = a.locator('dl[aria-label="Field rules"]')
    await expect(ruleSummary).toContainText("Not recorded separately")
    await expect(ruleSummary).not.toContainText("Not specified")
    const guidance = a.locator("summary").filter({
      hasText: "Value guidance and field rules"
    })
    await guidance.focus()
    await a.keyboard.press("Enter")
    const specification = a.locator('dl[aria-label="Field specification"]')
    await expect(specification).toBeVisible()
    await expect(specification).toContainText(
      item.snapshot.payload!.specification.guidance
    )
    await guidance.click()
    for (const width of [390, 320]) {
      await a.setViewportSize({ width, height: 844 })
      const ruleBounds = await ruleSummary.boundingBox()
      const cardBounds = await a.getByRole("article").boundingBox()
      const responseBounds = await a
        .getByRole("group", { name: item.preset.question, exact: true })
        .boundingBox()
      assert.ok(
        ruleBounds && ruleBounds.height < 160,
        "Core rules stay in two compact rows"
      )
      assert.ok(
        cardBounds && responseBounds && responseBounds.y - cardBounds.y < 500,
        "Response choices follow the field without a long rules list"
      )
      assert.ok(
        await a.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1
        )
      )
      for (const radio of await a.getByRole("radio").all()) {
        const target = await radio.locator("..").boundingBox()
        assert.ok(
          target && target.height >= 44,
          "Response targets remain easy to tap"
        )
      }
      await a.screenshot({
        path: resolve(output, `compact-review-${width}.png`),
        fullPage: true
      })
    }
    await a.setViewportSize({ width: 1280, height: 900 })
    pass(
      "Compact mobile rules retain source guidance, keyboard access and touch targets"
    )
    await a.locator("summary").filter({ hasText: "Comment (optional)" }).click()
    await a.getByRole("radio", { name: "Needs revision", exact: true }).check()
    await a
      .getByLabel("Comment (optional)")
      .fill("Please include the spatial units.")
    await a
      .getByRole("button", { name: "Save response", exact: true })
      .dblclick()
    await expect(a.getByRole("status")).toContainText("Response saved")
    assert.equal((await row()).version, 1)
    await a.reload()
    await expect(
      a.getByRole("radio", { name: "Needs revision", exact: true })
    ).toBeChecked()
    await expect(a.getByLabel("Comment (optional)")).toHaveValue(
      "Please include the spatial units."
    )
    await expect(a.getByLabel("Comment (optional)")).toBeVisible()
    await a.locator("summary").filter({ hasText: "Comment (optional)" }).click()
    await expect(a.getByLabel("Comment (optional)")).toBeHidden()
    await a.reload()
    await expect(a.getByLabel("Comment (optional)")).toBeVisible()
    await expect(a.getByLabel("Comment (optional)")).toHaveValue(
      "Please include the spatial units."
    )
    pass("Rapid save clicks produce one response and reload preserves it")
    await a
      .getByRole("navigation", { name: "Community workspace" })
      .getByRole("link", { name: "My work", exact: true })
      .click()
    await expect(
      a.getByRole("region", { name: "Requested feedback", exact: true })
    ).toContainText("1 of")
    await a.reload()
    await expect(
      a.getByRole("region", { name: "Requested feedback", exact: true })
    ).toContainText("1 of")
    await a.goto(base + href)
    pass("My work shows saved personal progress after navigation and reload")
    const b = await participant.newPage()
    b.setDefaultTimeout(20000)
    await b.goto(base + href)
    await expect(b.getByLabel("Comment (optional)")).toHaveValue(
      "Please include the spatial units."
    )
    await a
      .getByLabel("Comment (optional)")
      .fill("Please include units and boundary conditions.")
    await a.getByRole("button", { name: "Save response", exact: true }).click()
    await expect(a.getByRole("status")).toContainText("Response saved")
    await b
      .getByLabel("Comment (optional)")
      .fill("My conflicting response stays here.")
    await b.getByRole("button", { name: "Save response", exact: true }).click()
    await expect(b.locator("article").getByRole("alert")).toContainText(
      "another tab"
    )
    await expect(b.getByLabel("Comment (optional)")).toHaveValue(
      "My conflicting response stays here."
    )
    assert.equal((await row()).version, 2)
    await b
      .getByRole("button", { name: "Reload saved response", exact: true })
      .click()
    await expect(b.getByLabel("Comment (optional)")).toHaveValue(
      "Please include units and boundary conditions."
    )
    pass(
      "Two-tab conflict preserves unsaved input and reloads the saved response"
    )
    await b.close()
    let failOnce = true
    await a.route("**/api/trpc/communityReviews.save*", async (route) => {
      if (failOnce) {
        failOnce = false
        await route.abort("failed")
      } else await route.fallback()
    })
    await a
      .getByLabel("Comment (optional)")
      .fill("Recovered after an interrupted connection.")
    await a.getByRole("button", { name: "Save response", exact: true }).click()
    await expect(a.locator("article").getByRole("alert")).toBeVisible()
    a.once("dialog", (dialog) => void dialog.accept())
    await a.reload()
    await expect(a.getByLabel("Comment (optional)")).toHaveValue(
      "Recovered after an interrupted connection."
    )
    await a.getByRole("button", { name: "Save response", exact: true }).click()
    await expect(a.getByRole("status")).toContainText("Response saved")
    assert.equal((await row()).version, 3)
    pass("Interrupted save survives reload and retry")
    await a.unroute("**/api/trpc/communityReviews.save*")
    let loseAck = true
    await a.route("**/api/trpc/communityReviews.save*", async (route) => {
      if (loseAck) {
        loseAck = false
        await route.fetch()
        await route.abort("failed")
      } else await route.fallback()
    })
    await a
      .getByLabel("Comment (optional)")
      .fill("Saved even if the acknowledgement is lost.")
    await a.getByRole("button", { name: "Save response", exact: true }).click()
    await expect(a.locator("article").getByRole("alert")).toBeVisible()
    assert.equal((await row()).version, 4)
    await a.getByRole("button", { name: "Save response", exact: true }).click()
    await expect(a.getByRole("status")).toContainText("Response saved")
    assert.equal((await row()).version, 4)
    pass(
      "Lost acknowledgement retries without a duplicate vote or history entry"
    )
    await a.unroute("**/api/trpc/communityReviews.save*")
    await a
      .getByLabel("Comment (optional)")
      .fill("Saved when returning to Quick start.")
    await a
      .getByRole("navigation", { name: "Community workspace" })
      .getByRole("link", { name: "Quick start", exact: true })
      .click()
    await expect(
      a.getByRole("link", { name: "Review and respond", exact: true })
    ).toBeVisible()
    assert.equal((await row()).version, 5)
    assert.equal((await row()).comment, "Saved when returning to Quick start.")
    pass("Navigation saves the current response before leaving")
    await a.goto(base + href)
    await a
      .getByRole("button", { name: "Suggest a change", exact: true })
      .click()
    await expect(
      a.getByRole("link", { name: "Back to review", exact: true })
    ).toBeVisible({ timeout: 120000 })
    await a.getByRole("tab", { name: "Definition", exact: true }).click()
    await a
      .getByRole("textbox", { name: "Definition", exact: true })
      .fill("A spatial domain used to solve phase-field equations.")
    await a.getByRole("link", { name: "Back to review", exact: true }).click()
    await expect(
      a.getByRole("radio", { name: "Needs revision", exact: true })
    ).toBeChecked()
    const draftRows = await db
      .select()
      .from(drafts)
      .where(eq(drafts.ownerId, member.userId))
    assert.ok(
      draftRows.some(
        (row) =>
          row.payload.definition ===
          "A spatial domain used to solve phase-field equations."
      )
    )
    pass("Suggest a change creates a private draft and returns after saving")
    await a.setViewportSize({ width: 390, height: 844 })
    await a.reload()
    await expect(
      a.getByRole("button", { name: "Save response", exact: true })
    ).toBeVisible()
    assert.ok(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    )
    await a.screenshot({
      path: resolve(output, "review-mobile.png"),
      fullPage: true
    })
    await a.getByRole("button", { name: "My responses", exact: true }).click()
    await expect(a.getByLabel("Comment (optional)")).toHaveValue(
      "Saved when returning to Quick start."
    )
    await a
      .getByRole("button", { name: "Not yet reviewed", exact: true })
      .click()
    await expect(a.getByText("Review complete", { exact: true })).toBeVisible()
    pass("Mobile review fits the screen; reviewed and pending filters agree")
    await page
      .getByRole("button", {
        name: "Create conference invitation",
        exact: true
      })
      .click()
    const invitation = await page
      .getByLabel("Invitation link", { exact: true })
      .inputValue()
    token = invitation.split("/").at(-1)!
    const anonymous = await browser.newContext()
    await guard(anonymous)
    const guest = await anonymous.newPage()
    guest.setDefaultTimeout(20000)
    await guest.goto(base + href)
    await expect(
      guest.getByRole("heading", { name: member.communityTitle, exact: true })
    ).toBeVisible()
    await expect(guest.getByRole("radio")).toHaveCount(0)
    await guest.goto(invitation, { timeout: 120000 })
    await expect(
      guest.getByRole("button", { name: "Join community and open review" })
    ).toHaveCount(0)
    const signup = await guest
      .getByRole("link", { name: "Create an account", exact: true })
      .getAttribute("href")
    assert.equal(
      new URL(signup!, base).searchParams.get("returnTo"),
      "/review-invite/" + token
    )
    await guest
      .getByRole("link", { name: "Create an account", exact: true })
      .click()
    await expect(guest.locator('input[name="returnTo"]')).toHaveValue(
      "/review-invite/" + token,
      { timeout: 120000 }
    )
    pass(
      "Anonymous attendees see no private fields and signup retains the invitation"
    )
    await signInAs(anonymous, base, newcomer.userId)
    await guest.goto(base + href)
    await expect(guest.getByRole("radio")).toHaveCount(0)
    await guest.goto(invitation)
    await guest
      .getByRole("button", {
        name: "Join community and open review",
        exact: true
      })
      .click()
    await expect(guest).toHaveURL(
      new RegExp("view=review&round=" + roundId + "&profile=pf")
    )
    await expect(
      guest.getByRole("radio", { name: "Suitable as written", exact: true })
    ).toBeVisible()
    pass(
      "Signing in does not grant access; explicit join opens the private Phase Field review"
    )
    await page
      .getByLabel("Manage a review", { exact: true })
      .selectOption(roundId)
    await page.getByRole("button", { name: "Revoke link", exact: true }).click()
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible()
    await guest.goto(invitation)
    await expect(
      guest.getByRole("heading", { name: "Invitation unavailable" })
    ).toBeVisible()
    pass("Revoked conference link stops further admissions")
    await page.getByText("Participant responses", { exact: false }).click()
    await expect(
      page.getByRole("cell", { name: member.userName, exact: true })
    ).toBeVisible()
    await page
      .getByRole("button", { name: "Close review", exact: true })
      .click()
    await expect(
      page.getByRole("button", { name: "Close review", exact: true })
    ).toHaveCount(0)
    await a.goto(base + href)
    await expect(
      a.getByText(
        "This review is closed. Your saved responses remain available.",
        { exact: true }
      )
    ).toBeVisible()
    pass("Organizer sees attributed responses and can close the round")
    await page.goto(base + "/communities/" + organizer.communitySlug)
    await expect(
      page.getByRole("link", { name: "Continue my work", exact: true })
    ).toBeVisible()
    await expect(
      page.getByText("Phase Field feedback", { exact: true })
    ).toHaveCount(0)
    pass("Regular community uses the same Quick start without MatCore content")
    assert.deepEqual(blocked, [])
    assert.deepEqual(errors, [])
  } catch (error) {
    if (browser) {
      for (const [index, context] of browser.contexts().entries()) {
        const page = context.pages()[0]
        if (page) {
          await page
            .screenshot({
              path: resolve(output, `failure-${index}.png`),
              fullPage: true
            })
            .catch(() => {})
          await writeFile(
            resolve(output, `failure-${index}.txt`),
            await page
              .locator("body")
              .innerText()
              .catch(() => "")
          )
        }
      }
    }
    failure = error
  } finally {
    if (browser) await closeBrowserAfterRoutes(browser)
    if (fixtures[0]) {
      const fixture = fixtures[0]
      await db.transaction(async (tx) => {
        const ownedRounds = await tx
            .select()
            .from(rounds)
            .where(eq(rounds.communityId, fixture.communityId)),
          ids = ownedRounds.map((row) => row.id)
        if (ids.length) {
          const ownedItems = await tx
              .select()
              .from(items)
              .where(inArray(items.roundId, ids)),
            itemIds = ownedItems.map((row) => row.id)
          const links = await tx
            .select()
            .from(invitations)
            .where(inArray(invitations.roundId, ids))
          if (links.length)
            await tx.delete(admissions).where(
              inArray(
                admissions.invitationId,
                links.map((row) => row.id)
              )
            )
          await tx.delete(invitations).where(inArray(invitations.roundId, ids))
          if (itemIds.length) {
            await tx.delete(events).where(inArray(events.itemId, itemIds))
            await tx.delete(responses).where(inArray(responses.itemId, itemIds))
          }
          await tx.delete(items).where(inArray(items.roundId, ids))
          await tx.delete(rounds).where(inArray(rounds.id, ids))
        }
        const ownFields = await tx
            .select()
            .from(fields)
            .where(eq(fields.vocabularySlug, fixture.vocabularySlug)),
          fieldIds = ownFields.map((row) => row.id)
        if (fieldIds.length) {
          await tx
            .delete(fieldEvents)
            .where(inArray(fieldEvents.fieldId, fieldIds))
          await tx.delete(drafts).where(inArray(drafts.fieldId, fieldIds))
          await tx.delete(revisions).where(inArray(revisions.fieldId, fieldIds))
          await tx.delete(fields).where(inArray(fields.id, fieldIds))
        }
        await tx
          .delete(settings)
          .where(eq(settings.vocabularySlug, fixture.vocabularySlug))
        await tx
          .update(users)
          .set({ activeCommunityId: null })
          .where(
            inArray(
              users.id,
              fixtures.map((row) => row.userId)
            )
          )
        for (const other of fixtures.slice(1))
          await tx
            .delete(members)
            .where(
              and(
                eq(members.communityId, fixture.communityId),
                eq(members.userId, other.userId)
              )
            )
      })
      if (source)
        await removeSyntheticUiSource(fixture, source.created, source.releaseId)
    }
    for (const fixture of fixtures.reverse())
      await removeGuidedSetupFixture(fixture)
    assert.deepEqual(
      await reviewFingerprints(),
      before,
      "All original table fingerprints remain unchanged"
    )
    pass("Test fixtures removed; all pre-existing records match")
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          passed,
          blocked,
          errors,
          failure:
            failure instanceof Error ? failure.message : (failure ?? null)
        },
        null,
        2
      )
    )
  }
  if (failure) throw failure
  console.log(`Community review UI tests passed (${passed.length} checks)`)
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
