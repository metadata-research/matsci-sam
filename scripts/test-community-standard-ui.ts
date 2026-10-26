// Automated regression of the local standards workflow. Manual visual QA uses IAB.
import "dotenv/config"
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { expect, type Browser, type BrowserContext } from "@playwright/test"
import { and, eq, inArray, sql } from "drizzle-orm"
import {
  db,
  communityMembersTable,
  vocabularyWorkspaceSettingsTable,
  matcoreFieldsTable as fields,
  matcoreSpecDraftsTable as drafts,
  matcoreSpecRevisionsTable as revisions,
  matcoreWorkflowEventsTable as events,
  communityStandardReleasesTable as releases
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
import { getCommunityStandard } from "../lib/community-standard"
import {
  localPreviewBase,
  launchBrowser,
  signInAs,
  rememberView,
  closeBrowserAfterRoutes
} from "./ui-test-harness"

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
  const base = localPreviewBase(),
    output = resolve(
      process.env.SAM_UI_TEST_OUTPUT_DIR ?? `/tmp/standard-ui-${randomUUID()}`
    )
  await mkdir(output, { recursive: true })
  const before = await fingerprints(),
    fixtures: GuidedSetupFixture[] = [],
    passed: string[] = [],
    errors: string[] = [],
    blocked: string[] = []
  let browser: Browser | undefined,
    installed = false,
    sourceCreated = false,
    secondSource: { created: boolean; releaseId: string } | undefined,
    failure: unknown
  const pass = (name: string) => {
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  try {
    const member = await createGuidedSetupFixture()
    fixtures.push(member)
    const steward = await createGuidedSetupFixture()
    fixtures.push(steward)
    sourceCreated = (await installSyntheticUiSource(member)).created
    installed = true
    await db.insert(vocabularyWorkspaceSettingsTable).values({
      vocabularySlug: member.vocabularySlug,
      metadataEnabled: true,
      matcoreEnabled: true,
      updatedById: member.userId
    })
    await db.insert(communityMembersTable).values({
      communityId: member.communityId,
      userId: steward.userId,
      role: "steward",
      addedById: member.userId
    })
    const initial = await getCommunityStandard(
      db,
      { vocabularySlug: member.vocabularySlug },
      member.userId
    )
    const source =
      initial.referenceEntries.find(
        (row) =>
          row.profileKey === "minimal" &&
          row.payload.specification.path === "specimen"
      ) ?? initial.referenceEntries.find((row) => row.profileKey === "minimal")!
    const guard = async (context: BrowserContext) => {
      await context.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url()),
          paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? []
        if (
          url.origin !== new URL(base).origin ||
          paths.some((path) =>
            /^(aiAssist\.|termReferences\.|ontologyContext\.)/.test(path)
          )
        ) {
          blocked.push(url.pathname)
          return route.abort()
        }
        if (request.method() === "GET") return route.continue()
        const path = paths[0],
          input = request.postDataJSON()?.[0] as
            | Record<string, unknown>
            | undefined
        let allowed = false
        if (paths.length === 1 && input) {
          if (
            [
              "matcoreWorkflow.startSourceChange",
              "matcoreWorkflow.createDraft",
              "matcoreWorkflow.createStandardRelease"
            ].includes(path)
          )
            allowed = input.vocabularySlug === member.vocabularySlug
          else if (
            ["matcoreWorkflow.updateDraft", "matcoreWorkflow.submit"].includes(
              path
            )
          ) {
            const [row] = await db
              .select({ id: drafts.id })
              .from(drafts)
              .innerJoin(fields, eq(drafts.fieldId, fields.id))
              .where(
                and(
                  eq(drafts.id, String(input.id)),
                  eq(fields.vocabularySlug, member.vocabularySlug),
                  inArray(
                    drafts.ownerId,
                    fixtures.map((row) => row.userId)
                  )
                )
              )
            allowed = Boolean(row)
          } else if (
            [
              "matcoreWorkflow.review",
              "matcoreWorkflow.comment",
              "matcoreWorkflow.revise"
            ].includes(path)
          ) {
            const [row] = await db
              .select({ id: revisions.id })
              .from(revisions)
              .innerJoin(fields, eq(revisions.fieldId, fields.id))
              .where(
                and(
                  eq(revisions.id, String(input.revisionId)),
                  eq(fields.vocabularySlug, member.vocabularySlug)
                )
              )
            allowed = Boolean(row)
          }
        }
        if (!allowed) {
          blocked.push(`${request.method()} ${url.pathname}`)
          return route.abort()
        }
        return route.continue()
      })
    }
    browser = await launchBrowser()
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 }
    })
    await guard(context)
    await signInAs(context, base, member.userId)
    await rememberView(context, base, "advanced")
    const page = await context.newPage()
    page.on("pageerror", (error) => errors.push(error.message))
    page.setDefaultTimeout(20000)
    const home = `${base}/communities/${member.communitySlug}`
    await page.goto(home)
    await expect(
      page
        .getByRole("navigation", { name: "Community workspace" })
        .getByRole("link", { name: "Standard", exact: true })
    ).toHaveAttribute("aria-current", "page")
    await expect(
      page.getByRole("link", { name: "Working version", exact: true })
    ).toHaveAttribute("aria-current", "page")
    await expect(
      page.getByRole("navigation", { name: "Field hierarchy" })
    ).toBeVisible()
    await expect(
      page
        .getByRole("navigation", { name: "Community workspace" })
        .getByRole("link")
        .first()
    ).toHaveText("Standard")
    await expect(
      page
        .getByRole("navigation", { name: "Standard version" })
        .getByRole("link")
        .first()
    ).toHaveText("Working version")
    await expect(
      page
        .getByRole("navigation", { name: "Catalog view" })
        .getByRole("link")
        .first()
    ).toHaveText("Hierarchy")
    pass(
      "Metadata community opens the working standard in hierarchy; the default views are leftmost"
    )
    await page
      .getByRole("navigation", { name: "Community workspace" })
      .getByRole("button", { name: "More", exact: true })
      .click()
    await expect(
      page.getByRole("menuitem", { name: "Vocabulary terms", exact: true })
    ).toHaveAttribute("href", `/vocabulary/${member.vocabularySlug}`)
    await page.keyboard.press("Escape")
    // Navigation regression shared with the original versioned-catalog suite.
    await page.getByLabel("Profile", { exact: true }).selectOption("dft")
    await expect(page.getByText("Includes fields from")).toBeVisible()
    await page
      .getByRole("navigation", { name: "Catalog view" })
      .getByRole("link", { name: "List", exact: true })
      .click()
    const fieldList = page.getByRole("complementary", {
      name: "Fields",
      exact: true
    })
    await expect(fieldList.getByRole("link")).toHaveCount(44)
    await page
      .getByRole("navigation", { name: "Catalog view" })
      .getByRole("link", { name: "Hierarchy", exact: true })
      .click()
    await expect(
      page
        .getByRole("navigation", { name: "Catalog view" })
        .getByRole("link", { name: "Hierarchy", exact: true })
    ).toHaveAttribute("aria-current", "page")
    await page.getByLabel("Profile", { exact: true }).selectOption("minimal")
    const outline = page.getByRole("navigation", { name: "Field hierarchy" })
    const parent = outline.getByRole("link", { name: "specimen", exact: true })
    const child = outline.getByRole("link", { name: "label", exact: true })
    await expect(parent).toBeVisible()
    await expect(child).toBeHidden()
    const expand = outline.getByRole("button", {
      name: "Expand specimen",
      exact: true
    })
    await expand.focus()
    await page.keyboard.press("Enter")
    await expect(child).toBeVisible()
    await outline
      .getByRole("button", { name: "Collapse specimen", exact: true })
      .focus()
    await page.keyboard.press("Space")
    await expect(child).toBeHidden()
    await page
      .getByLabel("Find a field", { exact: true })
      .fill("specimen.label")
    await page
      .getByRole("search", { name: "Community fields" })
      .getByRole("button", { name: "Search", exact: true })
      .click()
    await expect(parent).toBeVisible()
    await expect(child).toBeVisible()
    await child.click()
    await expect(
      page.getByRole("article", { name: "label", exact: true })
    ).toBeVisible()
    await page
      .getByRole("link", { name: "Back to fields", exact: true })
      .click()
    await expect(child).toBeFocused()
    await expect(page.getByLabel("Find a field")).toHaveValue("specimen.label")
    await page.getByRole("button", { name: "Clear", exact: true }).click()
    await expect(child).toBeHidden()
    const storagePage = await context.newPage()
    await storagePage.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", {
        get() {
          throw new DOMException("Blocked", "SecurityError")
        }
      })
    })
    await storagePage.goto(page.url())
    await storagePage
      .getByRole("button", { name: "Expand specimen", exact: true })
      .click()
    await storagePage
      .getByRole("navigation", { name: "Field hierarchy" })
      .getByRole("link", { name: "label", exact: true })
      .click()
    await expect(
      storagePage.getByRole("article", { name: "label", exact: true })
    ).toBeVisible()
    await storagePage.close()
    assert.equal(
      (await db.select().from(drafts).where(eq(drafts.ownerId, member.userId)))
        .length,
      0
    )
    pass(
      "List includes every field; hierarchy supports parent links, keyboard disclosure, inherited profiles, search and blocked storage without creating drafts"
    )
    const detail = new URL(home)
    detail.search = new URLSearchParams({
      view: "vocabulary",
      layout: "hierarchy",
      release: initial.reference!.id,
      source: source.id,
      standard: "working"
    }).toString()
    await page.goto(detail.href)
    await expect(
      page.getByRole("article", { name: source.payload.label, exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: source.payload.label, exact: true })
    ).toBeVisible()
    await page.screenshot({
      path: resolve(output, "working-desktop.png"),
      fullPage: false
    })
    pass("Working field uses a short name with separate profile and path")
    await page
      .getByRole("button", { name: "Propose a change", exact: true })
      .dblclick()
    await page.waitForURL(/\/metadata\/workspace\//)
    const draftURL = page.url()
    await expect(
      page.getByRole("tab", { name: "Field specification", exact: true })
    ).toHaveAttribute("data-state", "active")
    await expect(page.getByRole("tablist").getByRole("tab").first()).toHaveText(
      "Field specification"
    )
    await expect(
      page.getByRole("link", { name: "Back to working version", exact: true })
    ).toBeVisible()
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(
      page.getByRole("textbox", { name: "Field name", exact: true })
    ).toHaveValue(source.payload.label)
    await page
      .getByRole("textbox", { name: "Definition", exact: true })
      .fill(
        "A practitioner definition for the specimen used in this simulation."
      )
    await page
      .getByRole("textbox", { name: "Reason for this proposal", exact: true })
      .fill("Clarify how practitioners identify the specimen.")
    await page.getByRole("button", { name: "Save draft", exact: true }).click()
    await expect
      .poll(
        async () =>
          (
            await db
              .select()
              .from(drafts)
              .where(eq(drafts.ownerId, member.userId))
          )[0]?.payload.definition
      )
      .toBe(
        "A practitioner definition for the specimen used in this simulation."
      )
    await page.reload()
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(
      page.getByRole("textbox", { name: "Definition", exact: true })
    ).toHaveValue(
      "A practitioner definition for the specimen used in this simulation."
    )
    pass(
      "Propose creates one private draft; definition and rationale survive saving and reload"
    )
    const colleagueContext = await browser.newContext()
    await guard(colleagueContext)
    await signInAs(colleagueContext, base, steward.userId)
    const colleague = await colleagueContext.newPage()
    await colleague.goto(detail.href)
    await expect(
      colleague.getByRole("link", { name: "Continue my draft", exact: true })
    ).toHaveCount(0)
    await colleague
      .getByRole("button", { name: "Propose a change", exact: true })
      .click()
    await colleague.waitForURL(/\/metadata\/workspace\//)
    await colleague
      .getByRole("tab", { name: "Definition", exact: true })
      .click()
    await expect(
      colleague.getByRole("textbox", { name: "Definition", exact: true })
    ).toHaveValue(source.payload.definition)
    const colleagueDraftURL = colleague.url()
    assert.notEqual(colleagueDraftURL, draftURL)
    await colleague.goto(draftURL)
    await expect(
      colleague.getByRole("textbox", { name: "Definition", exact: true })
    ).toHaveCount(0)
    await colleagueContext.close()
    pass(
      "Repeated proposal clicks create one draft; a second member has a separate draft and cannot read the first member's edits"
    )
    await page
      .getByRole("button", { name: "Review proposal", exact: true })
      .click()
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Submit for review", exact: true })
      .click()
    await page.waitForURL(/\/metadata\/fields\//)
    const proposalURL = page.url()
    await expect(page.getByRole("tablist").getByRole("tab")).toHaveText([
      "Changes",
      "Discussion",
      "Field specification",
      "Sources & history"
    ])
    await expect(
      page.getByRole("tab", { name: "Changes", exact: true })
    ).toHaveAttribute("data-state", "active")
    await expect(
      page.getByRole("region", {
        name: "Changes from the reference",
        exact: true
      })
    ).toContainText("A practitioner definition")
    await expect(
      page
        .getByRole("region", {
          name: "Changes from the reference",
          exact: true
        })
        .getByText("Label", { exact: true })
    ).toHaveCount(0)
    await page.screenshot({
      path: resolve(output, "proposal-changes-desktop.png"),
      fullPage: false
    })
    await page.getByRole("tab", { name: "Discussion", exact: true }).click()
    await expect(
      page.getByText("Awaiting review", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Review proposal", exact: true })
    ).toHaveCount(0)
    await expect(
      page.getByRole("link", { name: "View dictionary entry" })
    ).toHaveCount(0)
    await page
      .getByRole("textbox", { name: "Add a comment" })
      .fill(
        "The reference needs a clearer distinction between specimen and simulation cell."
      )
    await page.getByRole("button", { name: "Post comment" }).click()
    await expect(
      page
        .getByRole("region", { name: "Discussion" })
        .getByRole("listitem")
        .getByText(
          "The reference needs a clearer distinction between specimen and simulation cell.",
          { exact: true }
        )
    ).toBeVisible()
    await page.reload()
    await page.getByRole("tab", { name: "Discussion", exact: true }).click()
    await expect(
      page.getByRole("region", { name: "Discussion" })
    ).toContainText("The reference needs a clearer distinction")
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
      .toBe(true)
    await page.screenshot({
      path: resolve(output, "proposal-discussion-390px.png"),
      fullPage: false
    })
    await page.getByRole("tab", { name: "Changes", exact: true }).click()
    await expect(
      page.getByRole("region", {
        name: "Changes from the reference",
        exact: true
      })
    ).toContainText("A practitioner definition")
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
      .toBe(true)
    await page.screenshot({
      path: resolve(output, "proposal-changes-390px.png"),
      fullPage: false
    })
    await page.setViewportSize({ width: 1440, height: 1100 })
    pass(
      "Submission creates a proposal without a dictionary artifact; attributed discussion survives reload"
    )
    await page.goto(`${home}?view=proposals`)
    await expect(
      page.getByRole("combobox", { name: "Reference version", exact: true })
    ).toHaveValue(initial.reference!.id)
    await expect(
      page
        .getByRole("region", { name: "Community proposals" })
        .getByRole("link", { name: new RegExp(source.payload.label) })
    ).toBeVisible()
    const pending = await getCommunityStandard(
      db,
      { vocabularySlug: member.vocabularySlug },
      member.userId
    )
    assert.equal(pending.fingerprint, initial.fingerprint)
    pass(
      "Shared queue exposes awaiting review proposals without changing the working standard"
    )
    const reviewContext = await browser.newContext({
      viewport: { width: 1440, height: 1100 }
    })
    await guard(reviewContext)
    await signInAs(reviewContext, base, steward.userId)
    const reviewer = await reviewContext.newPage()
    reviewer.on("pageerror", (error) => errors.push(error.message))
    await reviewer.goto(proposalURL)
    await reviewer.getByRole("tab", { name: "Discussion", exact: true }).click()
    await reviewer
      .getByRole("button", { name: "Review proposal", exact: true })
      .click()
    await reviewer
      .getByRole("dialog")
      .getByLabel("Decision", { exact: true })
      .selectOption("accepted")
    await reviewer
      .getByRole("dialog")
      .getByLabel("Reason", { exact: true })
      .fill("The practitioner definition and scope are agreed.")
    await reviewer
      .getByRole("dialog")
      .getByRole("button", { name: "Record review", exact: true })
      .click()
    await expect(
      reviewer.getByText("Accepted by community", { exact: true })
    ).toBeVisible()
    pass(
      "A community steward accepts the exact proposal revision without site-admin privileges"
    )
    await reviewer.goto(
      detail.href.replace("standard=reference", "standard=working")
    )
    await expect(
      reviewer.getByRole("article", { name: source.payload.label, exact: true })
    ).toContainText("A practitioner definition for the specimen")
    await reviewer
      .getByRole("button", { name: "Create community release", exact: true })
      .click()
    await reviewer
      .getByRole("dialog")
      .getByLabel("Release name", { exact: true })
      .fill("Practitioner 1.0")
    await reviewer
      .getByRole("dialog")
      .getByLabel("Release notes", { exact: true })
      .fill("Clarified specimen scope.")
    await reviewer
      .getByRole("dialog")
      .getByRole("button", { name: "Create release", exact: true })
      .click()
    await expect(
      reviewer.getByRole("combobox", { name: "Community release", exact: true })
    ).toHaveText(/Practitioner 1.0/)
    await reviewer.reload()
    await expect(
      reviewer.getByRole("link", { name: "Community release", exact: true })
    ).toHaveAttribute("aria-current", "page")
    const frozen = await getCommunityStandard(
      db,
      { vocabularySlug: member.vocabularySlug },
      steward.userId
    )
    assert.equal(frozen.releases.length, 1)
    pass(
      "Working version contains accepted change; named community release survives reload"
    )
    await reviewer.screenshot({
      path: resolve(output, "community-release-desktop.png"),
      fullPage: false
    })
    secondSource = await installSyntheticUiSource(
      member,
      `ui-next-${randomUUID()}`
    )
    for (const width of [1440, 390]) {
      await reviewer.setViewportSize({ width, height: 900 })
      await reviewer.goto(
        `${home}?view=vocabulary&standard=working&release=${encodeURIComponent(secondSource.releaseId)}`
      )
      await expect(
        reviewer.getByLabel("Reference version", { exact: true })
      ).toHaveValue(secondSource.releaseId)
      await reviewer
        .getByRole("navigation", { name: "Standard version" })
        .getByRole("link", { name: "Community release", exact: true })
        .click()
      await expect(
        reviewer.getByRole("combobox", {
          name: "Community release",
          exact: true
        })
      ).toHaveValue(frozen.releases[0].id)
      assert.equal(
        new URL(reviewer.url()).searchParams.get("release"),
        initial.reference!.id
      )
      await reviewer.reload()
      await expect(
        reviewer.getByRole("region", { name: "Community standard" })
      ).toBeVisible()
      await expect(
        reviewer.getByRole("link", { name: "Community release", exact: true })
      ).toHaveAttribute("aria-current", "page")
      await expect
        .poll(() =>
          reviewer.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        .toBe(true)
      await reviewer.screenshot({
        path: resolve(output, `release-version-switch-${width}px.png`),
        fullPage: false
      })
    }
    pass(
      "Community release tab selects its recorded reference from another version on desktop and mobile; reload preserves the release"
    )
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(detail.href)
      await expect(
        page.getByRole("article", { name: source.payload.label, exact: true })
      ).toBeVisible()
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
      await page
        .getByRole("link", { name: "Back to fields", exact: true })
        .click()
      await expect(
        page.getByRole("navigation", { name: "Field hierarchy" })
      ).toBeVisible()
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
      const mobileField = page
        .getByRole("navigation", { name: "Field hierarchy" })
        .getByRole("link", { name: source.payload.label, exact: true })
      await mobileField.click()
      await expect(
        page.getByRole("article", { name: source.payload.label, exact: true })
      ).toBeVisible()
      await page
        .getByRole("link", { name: "Back to fields", exact: true })
        .click()
      await expect(mobileField).toBeFocused()
      await page.screenshot({
        path: resolve(output, `standard-${width}px.png`),
        fullPage: false
      })
    }
    pass("320px and 390px field/detail navigation has no horizontal overflow")
    const anonymous = await browser.newContext()
    await guard(anonymous)
    const visitor = await anonymous.newPage()
    await visitor.goto(home)
    await expect(
      visitor.getByRole("navigation", { name: "Field hierarchy" })
    ).toHaveCount(0)
    await expect(
      visitor.getByRole("heading", { name: member.communityTitle, exact: true })
    ).toBeVisible()
    await visitor.goto(`${base}/communities/${steward.communitySlug}`)
    await expect(
      visitor
        .getByRole("navigation", { name: "Community workspace" })
        .getByRole("link", { name: "Vocabulary", exact: true })
    ).toBeVisible()
    await expect(
      visitor.getByRole("link", { name: "Proposals", exact: true })
    ).toHaveCount(0)
    pass(
      "Private content is unavailable to visitors; ordinary community retains vocabulary navigation"
    )
    const privateRead = await anonymous.request.get(
      `${base}/api/trpc/matcoreWorkflow.standard?${new URLSearchParams({ batch: "1", input: JSON.stringify({ 0: { vocabularySlug: member.vocabularySlug } }) })}`
    )
    assert.equal(privateRead.status(), 404)
    assert.equal(
      (await privateRead.text()).includes(source.payload.definition),
      false
    )
    for (const [key, value] of [
      ["release", "missing-release"],
      ["source", "missing-source"],
      ["profile", "dft"]
    ]) {
      const invalid = new URL(detail.href)
      invalid.searchParams.set(key, value)
      await page.goto(invalid.href)
      await expect(
        page.getByRole("article", { name: source.payload.label, exact: true })
      ).toHaveCount(0)
      await expect(
        page.getByText(/not found|could not|unavailable/i).first()
      ).toBeVisible()
    }
    await page.goto(`${base}/metadata/matcore#creator`)
    await expect(page.locator("#creator")).toBeVisible()
    pass(
      "Private API reads and mismatched source/profile/version routes fail closed; the historical catalog remains available"
    )
    await page.goto(draftURL)
    await expect(
      page.getByRole("link", { name: "View proposal", exact: true })
    ).toBeVisible()
    assert.deepEqual(errors, [])
    assert.deepEqual(blocked, [])
  } catch (error) {
    failure = error
  } finally {
    if (browser) await closeBrowserAfterRoutes(browser)
    const fixture = fixtures[0]
    if (fixture) {
      await db.transaction(async (tx) => {
        const owned = await tx
          .select()
          .from(fields)
          .where(eq(fields.vocabularySlug, fixture.vocabularySlug))
        assert.ok(
          owned.every(
            (row) =>
              fixtures.some((f) => f.userId === row.createdById) &&
              row.termId === null
          )
        )
        const ids = owned.map((row) => row.id)
        await tx
          .delete(releases)
          .where(eq(releases.vocabularySlug, fixture.vocabularySlug))
        if (ids.length) {
          await tx.delete(events).where(inArray(events.fieldId, ids))
          await tx.delete(drafts).where(inArray(drafts.fieldId, ids))
          await tx.delete(revisions).where(inArray(revisions.fieldId, ids))
          await tx.delete(fields).where(inArray(fields.id, ids))
        }
        await tx
          .delete(vocabularyWorkspaceSettingsTable)
          .where(
            eq(
              vocabularyWorkspaceSettingsTable.vocabularySlug,
              fixture.vocabularySlug
            )
          )
        if (fixtures[1])
          await tx
            .delete(communityMembersTable)
            .where(
              and(
                eq(communityMembersTable.communityId, fixture.communityId),
                eq(communityMembersTable.userId, fixtures[1].userId)
              )
            )
      })
      if (secondSource)
        await removeSyntheticUiSource(
          fixture,
          secondSource.created,
          secondSource.releaseId
        )
      if (installed) await removeSyntheticUiSource(fixture, sourceCreated)
    }
    for (const fixture of fixtures.reverse())
      await removeGuidedSetupFixture(fixture)
    const after = await fingerprints()
    assert.deepEqual(
      after,
      before,
      "All retained table fingerprints match after cleanup"
    )
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          passed,
          errors,
          blocked,
          cleanup: "passed",
          preservation: "all retained public tables unchanged",
          failure: failure instanceof Error ? failure.message : null
        },
        null,
        2
      )
    )
  }
  if (failure) throw failure
  console.log(
    `Community standard UI tests passed (${passed.length} groups; fixture cleanup and preservation passed).`
  )
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
