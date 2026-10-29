// Real HTTP + disposable local database. No source, ontology or AI provider is
// called. Every write is allowlisted and every fixture is removed afterward.
import "dotenv/config"
import "next/dist/server/node-environment"
import {
  installSyntheticUiSource,
  removeSyntheticUiSource
} from "./fixtures/matcore-source-db-fixture"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  expect as baseExpect,
  type Browser,
  type Page,
  type Route
} from "@playwright/test"
import { and, eq, inArray } from "drizzle-orm"
import {
  db,
  communityMembersTable,
  matcoreFieldsTable,
  matcoreSpecDraftsTable,
  matcoreSpecRevisionsTable,
  matcoreWorkflowEventsTable,
  termDraftsTable,
  termsTable,
  usersTable,
  vocabulariesTable,
  vocabularyWorkspaceSettingsTable
} from "../drizzle"
import {
  MATCORE_STANDARD_MANIFEST,
  MATCORE_FIXTURE_VERSION
} from "./fixtures/matcore-source-fixture"
import {
  createGuidedSetupFixture,
  removeGuidedSetupFixture
} from "./guided-setup-ui-fixture"
import {
  closeBrowserAfterRoutes,
  launchBrowser,
  localPreviewBase,
  rememberView,
  signInAs
} from "./ui-test-harness"

const expect = baseExpect.configure({ timeout: 30000 })

async function main() {
  const base = localPreviewBase()
  const origin = new URL(base).origin
  const fixture = await createGuidedSetupFixture()
  const genericFixture = await createGuidedSetupFixture()
  const output = resolve(
    process.env.SAM_UI_TEST_OUTPUT_DIR ??
      `${tmpdir()}/matsci-matcore-ui-${fixture.token}`
  )
  const passed: string[] = []
  const blocked: string[] = []
  const errors: string[] = []
  const mutations: Array<{ path: string; input: Record<string, unknown> }> = []
  let browser: Browser | undefined
  let failure: unknown
  let cleanupFailure: unknown
  let dropNextSave = false
  let droppedSave = false
  let rejectSaves = false
  let activeDraftId = ""
  let syntheticSourceCreated = false
  let sourceInstalled = false
  let cleaned = false
  const allowedWrites = new Set([
    "matcoreWorkflow.configureWorkspace",
    "termDrafts.create",
    "termDrafts.update",
    "termDrafts.publish",
    "matcoreWorkflow.importStandard",
    "matcoreWorkflow.createDraft",
    "matcoreWorkflow.updateDraft",
    "matcoreWorkflow.submit",
    "matcoreWorkflow.revise",
    "matcoreWorkflow.withdraw"
  ])
  const record = (name: string) => {
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  const allDrafts = () =>
    db
      .select()
      .from(matcoreSpecDraftsTable)
      .where(eq(matcoreSpecDraftsTable.ownerId, fixture.userId))
  const activeDraft = async () => {
    const [draft] = await db
      .select()
      .from(matcoreSpecDraftsTable)
      .where(
        and(
          eq(matcoreSpecDraftsTable.id, activeDraftId),
          eq(matcoreSpecDraftsTable.ownerId, fixture.userId)
        )
      )
    assert.ok(draft)
    return draft
  }
  const saved = (page: Page) =>
    page.getByText("Draft saved to your account", { exact: true })
  const definition = (page: Page) =>
    page.getByRole("textbox", { name: "Definition", exact: true })
  const button = (page: Page, name: string) =>
    page.getByRole("button", { name, exact: true })
  const capture = async (page: Page, name: string) => {
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
      .toBe(true)
    await page.screenshot({
      path: resolve(output, `${name}.png`),
      fullPage: true,
      animations: "disabled"
    })
  }
  const expectedUnloads = new Map<
    Page,
    { action: "accept" | "dismiss"; seen: boolean }
  >()
  const unloadDecisions: string[] = []
  const observe = (page: Page) => {
    page.setDefaultTimeout(30000)
    page.setDefaultNavigationTimeout(90000)
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
    page.on("console", (message) => {
      if (message.type() !== "error") return
      const expected =
        message
          .location()
          .url.includes("/api/trpc/matcoreWorkflow.updateDraft") &&
        /409|ERR_CONNECTION_RESET|ERR_FAILED/.test(message.text())
      if (!expected) errors.push(message.text())
    })
    page.on("dialog", async (dialog) => {
      const expected = expectedUnloads.get(page)
      if (dialog.type() === "beforeunload" && expected) {
        expected.seen = true
        unloadDecisions.push(expected.action)
        await dialog[expected.action]()
        return
      }
      errors.push(`Unexpected native dialog: ${dialog.message()}`)
      await dialog.dismiss()
    })
  }

  try {
    await mkdir(output, { recursive: true })
    await writeFile(
      resolve(output, "fixtures.json"),
      JSON.stringify({ fixture, genericFixture }, null, 2)
    )
    syntheticSourceCreated = (await installSyntheticUiSource(fixture)).created
    sourceInstalled = true
    await db.insert(vocabularyWorkspaceSettingsTable).values({
      vocabularySlug: fixture.vocabularySlug,
      metadataEnabled: true,
      matcoreEnabled: true,
      updatedById: fixture.userId
    })
    // Only disposable fixture membership changes; no global administrator role.
    await db
      .update(communityMembersTable)
      .set({ role: "steward" })
      .where(
        and(
          eq(communityMembersTable.communityId, genericFixture.communityId),
          eq(communityMembersTable.userId, genericFixture.userId)
        )
      )
    await db.insert(communityMembersTable).values({
      communityId: fixture.communityId,
      userId: genericFixture.userId,
      role: "member",
      addedById: fixture.userId
    })
    browser = await launchBrowser()
    const context = await browser.newContext({
      viewport: { width: 1365, height: 1000 }
    })
    await signInAs(context, base, fixture.userId)
    await rememberView(context, base, "simple")
    const routeRequests = async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? []
      const forbidden =
        url.origin !== origin ||
        paths.some((path) =>
          /^(aiAssist\.|termReferences\.retrieve|ontologyContext\.)/.test(path)
        ) ||
        (request.method() !== "GET" &&
          (!paths.length || paths.some((path) => !allowedWrites.has(path))))
      if (forbidden) {
        blocked.push(`${request.method()} ${url.pathname}`)
        return route.abort("blockedbyclient")
      }
      if (request.method() !== "GET") {
        const inputs = request.postDataJSON() as Record<
          string,
          Record<string, unknown>
        >
        paths.forEach((path, index) =>
          mutations.push({ path, input: inputs[index] ?? {} })
        )
        if (rejectSaves && paths.includes("matcoreWorkflow.updateDraft"))
          return route.abort("connectionreset")
        const response = await route.fetch({ timeout: 90000 })
        if (
          dropNextSave &&
          paths.includes("matcoreWorkflow.updateDraft") &&
          response.ok()
        ) {
          dropNextSave = false
          droppedSave = true
          return route.abort("connectionreset")
        }
        return route.fulfill({ response })
      }
      return route.continue()
    }
    await context.route("**/*", routeRequests)
    const page = await context.newPage()
    observe(page)
    const workspace = `${base}/communities/${fixture.communitySlug}?view=work`
    const legacyWorkspace = `${base}/metadata/workspace?vocabularySlug=${fixture.vocabularySlug}`
    await page.goto(legacyWorkspace)
    await expect(page).toHaveURL(workspace)
    await expect(
      page.getByRole("heading", { name: fixture.communityTitle, exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "My work", exact: true })
    ).toBeVisible()
    await expect(
      page.getByLabel("Destination vocabulary", { exact: true })
    ).toHaveCount(0)
    if (!(await button(page, "Import all sections as drafts").isVisible()))
      await page.getByText("Prepare drafts in bulk", { exact: true }).click()
    await button(page, "Import all sections as drafts").click()
    await button(page, "Import private drafts").click()
    await expect(
      page.getByRole("status").filter({ hasText: "Import complete:" })
    ).toBeVisible({ timeout: 120000 })
    const imported = await allDrafts()
    assert.equal(imported.length, MATCORE_STANDARD_MANIFEST.occurrences.length)
    assert.equal(
      new Set(imported.map((row) => row.importKey)).size,
      imported.length
    )
    assert.deepEqual(
      [...new Set(imported.map((row) => row.profileKey))].sort(),
      ["derived", "dft", "mbpt", "md", "minimal", "ml", "pf"]
    )
    assert.ok(imported.every((row) => !row.publication))
    assert.deepEqual(
      await db
        .select()
        .from(termsTable)
        .where(eq(termsTable.vocabularySlug, fixture.vocabularySlug)),
      []
    )
    if (!(await button(page, "Import all sections as drafts").isVisible()))
      await page.getByText("Prepare drafts in bulk", { exact: true }).click()
    await button(page, "Import all sections as drafts").click()
    await button(page, "Import private drafts").click()
    await expect(
      page.getByRole("status").filter({ hasText: "Import complete:" })
    ).toBeVisible()
    assert.equal((await allDrafts()).length, imported.length)
    record(
      "All seven sections import privately through HTTP; a repeated import creates no duplicates or public terms"
    )

    const selected =
      imported.find(
        (draft) =>
          draft.profileKey === "minimal" &&
          draft.payload.specification.path === "creation-date"
      ) ?? imported.find((draft) => draft.profileKey === "minimal")!
    activeDraftId = selected.id
    const draftUrl = `${base}/metadata/workspace/${activeDraftId}`
    await page.goto(draftUrl)
    await expect(page.getByRole("tablist").getByRole("tab").first()).toHaveText(
      "Field specification"
    )
    await expect(
      page.getByRole("tab", { name: "Field specification", exact: true })
    ).toHaveAttribute("data-state", "active")
    const edited = `A metadata field explained by the local UI fixture ${fixture.token}.`
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(definition(page)).toBeEditable()
    await expect(page.getByLabel("Data type", { exact: true })).toBeVisible()
    await expect(
      page.getByLabel("Repeatable field", { exact: true })
    ).toBeVisible()
    await expect(page.getByLabel("Value form", { exact: true })).toHaveValue(
      "unspecified"
    )
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await definition(page).fill(edited)
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(definition(page)).toHaveValue(edited)
    await page
      .getByRole("textbox", { name: "Reason for this proposal", exact: true })
      .fill(
        "Clarify the field and its contextual requirement for the UI regression."
      )
    await page
      .getByRole("tab", { name: "Field specification", exact: true })
      .click()
    await page.getByLabel("Data type", { exact: true }).selectOption("text")
    await page.getByLabel("Value form", { exact: true }).selectOption("list")
    await page
      .getByLabel("Repeatable field", { exact: true })
      .selectOption("yes")
    await page.getByLabel("Format", { exact: true }).fill("YYYY-MM-DD")
    for (const [label, explanation] of [
      ["About field paths", /Include the parent context/],
      [
        "About field requirements",
        /required child field must be supplied when its parent is present/
      ],
      ["About repeatable fields", /single field can contain several values/]
    ] as const) {
      const help = page.getByRole("button", { name: label, exact: true })
      await help.focus()
      await page.keyboard.press("Enter")
      await expect(
        page.getByRole("dialog", { name: label, exact: true })
      ).toContainText(explanation)
      await page.keyboard.press("Escape")
      await expect(help).toBeFocused()
    }
    await page.locator("#field-requirement").selectOption("conditional")
    await page
      .getByLabel("Requirement condition", { exact: true })
      .fill("Required when the enclosing object is present.")
    await page.getByText("More specification details", { exact: true }).click()
    await page.getByLabel("Units", { exact: true }).fill("unitless")
    await page.getByLabel("Allowed values", { exact: true }).fill("A\nB")
    await page
      .getByLabel("Notes", { exact: true })
      .fill("Record the dates in acquisition order.")
    await page.getByText("Compare with source rules", { exact: true }).click()
    await expect(
      page.locator('dl[aria-label="Source and proposal field rules"]')
    ).toContainText("Changed")
    await capture(page, "source-rule-comparison-desktop")
    await page.setViewportSize({ width: 320, height: 800 })
    await capture(page, "source-rule-comparison-320px")
    await page.setViewportSize({ width: 1365, height: 1000 })
    await page
      .getByRole("tab", { name: "Sources & history", exact: true })
      .click()
    await expect(page.getByText("Reference", { exact: true })).toBeVisible()
    await button(page, "Add citation").click()
    await page
      .getByRole("textbox", { name: "Source title", exact: true })
      .fill("Metadata source for the UI fixture")
    await page
      .getByRole("textbox", { name: "Source address", exact: true })
      .fill("https://example.org/matcore-ui-source")
    await page
      .getByRole("textbox", {
        name: "How this source supports the proposal",
        exact: true
      })
      .fill("Explains the proposed date format and parent condition.")
    await button(page, "Save citation").click()
    // Deliberately leave before the autosave debounce; navigation must flush.
    await page
      .getByRole("link", {
        name: `Back to ${fixture.communityTitle} · My work`,
        exact: true
      })
      .click()
    await expect(page).toHaveURL(`${workspace}#my-field-drafts`)
    const committed = await activeDraft()
    assert.equal(committed.payload.definition, edited)
    assert.equal(committed.payload.citations.length, 1)
    assert.equal(committed.payload.specification.requirement, "conditional")
    assert.equal(committed.payload.specification.valueType, "text")
    assert.equal(committed.payload.specification.valueForm, "list")
    assert.equal(committed.payload.specification.repeatability, "yes")
    assert.equal(
      committed.payload.specification.notes,
      "Record the dates in acquisition order."
    )
    assert.deepEqual(committed.payload.specification.allowedValues, ["A", "B"])
    await page.goto(draftUrl)
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(definition(page)).toHaveValue(edited)
    await page
      .getByRole("tab", { name: "Sources & history", exact: true })
      .click()
    await expect(
      page.getByRole("link", {
        name: "Metadata source for the UI fixture",
        exact: true
      })
    ).toBeVisible()
    await page
      .getByRole("tab", { name: "Field specification", exact: true })
      .click()
    await expect(
      page.getByLabel("Requirement condition", { exact: true })
    ).toHaveValue("Required when the enclosing object is present.")
    await expect(page.getByLabel("Data type", { exact: true })).toHaveValue(
      "text"
    )
    await expect(page.getByLabel("Value form", { exact: true })).toHaveValue(
      "list"
    )
    await expect(
      page.getByLabel("Repeatable field", { exact: true })
    ).toHaveValue("yes")
    await page.getByText("More specification details", { exact: true }).click()
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
      "Record the dates in acquisition order."
    )
    await expect(
      page.getByLabel("Allowed values", { exact: true })
    ).toHaveValue("A\nB")
    await expect(page.getByLabel("Units", { exact: true })).toHaveValue(
      "unitless"
    )
    await capture(page, "field-specification-desktop")
    await page.reload()
    await expect(page.getByLabel("Value form", { exact: true })).toHaveValue(
      "list"
    )
    await expect(
      page.getByLabel("Repeatable field", { exact: true })
    ).toHaveValue("yes")
    await page.setViewportSize({ width: 390, height: 844 })
    await capture(page, "field-rules-390px")
    await page.setViewportSize({ width: 320, height: 800 })
    await capture(page, "field-rules-320px")
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      ),
      false
    )
    await page.setViewportSize({ width: 1365, height: 1000 })
    record(
      "Definition, conditional rules and citation survive a first-click navigation flush and reload"
    )

    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    const beforeLost = await activeDraft()
    const lostWriting = `${edited} Save-response recovery was exercised.`
    dropNextSave = true
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await definition(page).fill(lostWriting)
    await expect(button(page, "Retry save")).toBeVisible()
    assert.equal(droppedSave, true)
    assert.equal((await activeDraft()).payload.definition, lostWriting)
    await button(page, "Retry save").click()
    await expect(saved(page)).toBeVisible()
    assert.equal((await activeDraft()).version, beforeLost.version + 1)
    const attempts = mutations.filter(
      (entry) =>
        entry.path === "matcoreWorkflow.updateDraft" &&
        (entry.input.payload as { definition?: string })?.definition ===
          lostWriting
    )
    assert.equal(attempts.length, 2)
    assert.deepEqual(attempts[0].input, attempts[1].input)
    record(
      "A committed save with a lost response retries the same mutation without an extra version"
    )

    // Private editor entry uses a fresh document. Browser Back must preserve
    // the existing leave warning and this tab's recovery copy after leaving.
    const returnFromWorkspace = async () => {
      // Keep the workspace interactivity check as well as the editor check.
      await button(page, "New metadata field").click()
      const dialog = page.getByRole("dialog")
      await expect(dialog).toBeVisible()
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await page
        .locator(`a[href^="/metadata/workspace/${activeDraftId}"]`)
        .first()
        .click()
      await expect(page).toHaveURL(
        (url) => url.pathname === `/metadata/workspace/${activeDraftId}`
      )
      await page.getByRole("tab", { name: "Definition", exact: true }).click()
      await expect(definition(page)).toBeEditable()
    }
    const backToWorkspace = async () => {
      const leave = { action: "accept" as const, seen: false }
      expectedUnloads.set(page, leave)
      try {
        await page.goBack()
        assert.equal(
          leave.seen,
          true,
          "Leaving an unsaved draft requires confirmation"
        )
        await expect(
          page.getByRole("heading", {
            name: fixture.communityTitle,
            exact: true
          })
        ).toBeVisible()
      } finally {
        expectedUnloads.delete(page)
      }
    }
    await page
      .getByRole("link", {
        name: `Back to ${fixture.communityTitle} · My work`,
        exact: true
      })
      .click()
    await returnFromWorkspace()
    const beforeBack = await activeDraft()
    const backWriting = `${edited} This writing survives browser Back after a failed save.`
    rejectSaves = true
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await definition(page).fill(backWriting)
    await expect(button(page, "Retry save")).toBeVisible()
    assert.equal(
      (await activeDraft()).payload.definition,
      beforeBack.payload.definition
    )
    const canceledBack = { action: "dismiss" as const, seen: false }
    expectedUnloads.set(page, canceledBack)
    const beforeCanceledBack = page.url()
    try {
      await page.evaluate(() => history.back())
      await expect.poll(() => canceledBack.seen).toBe(true)
      await expect(page).toHaveURL(beforeCanceledBack)
      await page.getByRole("tab", { name: "Definition", exact: true }).click()
      await expect(definition(page)).toHaveValue(backWriting)
      assert.equal((await activeDraft()).version, beforeBack.version)
    } finally {
      expectedUnloads.delete(page)
    }
    await backToWorkspace()
    await returnFromWorkspace()
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(definition(page)).toHaveValue(backWriting)
    await expect(
      page.getByText(
        "Recovered unsaved changes from this tab; save to your account.",
        { exact: true }
      )
    ).toBeVisible()
    await expect(saved(page)).toHaveCount(0)
    assert.equal((await activeDraft()).version, beforeBack.version)
    rejectSaves = false
    await button(page, "Save draft").click()
    await expect(saved(page)).toBeVisible()
    assert.equal((await activeDraft()).payload.definition, backWriting)
    record(
      "Failed-save Back can be canceled; confirmed leaving and reopening restore this tab's writing, and an explicit save acknowledges recovery"
    )

    await page
      .getByRole("link", {
        name: `Back to ${fixture.communityTitle} · My work`,
        exact: true
      })
      .click()
    await returnFromWorkspace()
    const staleBase = await activeDraft()
    const staleWriting = `${edited} Preserve this recovery copy while another tab saves.`
    rejectSaves = true
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await definition(page).fill(staleWriting)
    await expect(button(page, "Retry save")).toBeVisible()
    await backToWorkspace()
    rejectSaves = false
    const concurrent = await context.newPage()
    observe(concurrent)
    await concurrent.goto(draftUrl)
    await concurrent
      .getByRole("tab", { name: "Definition", exact: true })
      .click()
    await expect(definition(concurrent)).toBeEditable()
    const concurrentWriting = `${edited} A newer account version was saved while the first tab was away.`
    await concurrent
      .getByRole("tab", { name: "Definition", exact: true })
      .click()
    await definition(concurrent).fill(concurrentWriting)
    await expect(saved(concurrent)).toBeVisible()
    assert.equal((await activeDraft()).payload.definition, concurrentWriting)
    await returnFromWorkspace()
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(definition(page)).toHaveValue(staleWriting)
    await expect(saved(page)).toHaveCount(0)
    // Next may restore a cached route. Either the fresh read or the subsequent
    // version-checked save must detect the newer row without rebasing recovery.
    if (await button(page, "Save draft").isEnabled())
      await button(page, "Save draft").click()
    await expect(
      page.getByText("A newer saved version is available", { exact: true })
    ).toBeVisible()
    assert.equal((await activeDraft()).payload.definition, concurrentWriting)
    const staleAttempts = mutations.filter(
      (entry) =>
        entry.path === "matcoreWorkflow.updateDraft" &&
        (entry.input.payload as { definition?: string })?.definition ===
          staleWriting
    )
    assert.ok(
      staleAttempts.every(
        (entry) => entry.input.expectedVersion === staleBase.version
      )
    )
    await button(page, "Reload saved draft").click()
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Keep editing", exact: true })
      .click()
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(definition(page)).toHaveValue(staleWriting)
    await button(page, "Reload saved draft").click()
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Reload saved draft", exact: true })
      .click()
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(definition(page)).toHaveValue(concurrentWriting)
    await expect(saved(page)).toBeVisible()
    await concurrent.close()
    record(
      "A recovered copy keeps its original version; newer account writing produces a conflict and survives explicit recovery discard"
    )

    const other = await context.newPage()
    observe(other)
    await other.goto(draftUrl)
    const firstTabWriting = `${edited} The first tab saved this wording.`
    await page.getByRole("tab", { name: "Definition", exact: true }).click()
    await definition(page).fill(firstTabWriting)
    await expect(saved(page)).toBeVisible()
    await expect
      .poll(async () => (await activeDraft()).payload.definition)
      .toBe(firstTabWriting)
    const secondTabWriting = `${edited} The second tab has different unsaved writing.`
    await other.getByRole("tab", { name: "Definition", exact: true }).click()
    await definition(other).fill(secondTabWriting)
    await expect(
      other.getByText("A newer saved version is available", { exact: true })
    ).toBeVisible()
    await other.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(definition(other)).toHaveValue(secondTabWriting)
    assert.equal((await activeDraft()).payload.definition, firstTabWriting)
    await button(other, "Reload saved draft").click()
    await other
      .getByRole("dialog")
      .getByRole("button", { name: "Keep editing", exact: true })
      .click()
    await other.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(definition(other)).toHaveValue(secondTabWriting)
    await button(other, "Reload saved draft").click()
    await other
      .getByRole("dialog")
      .getByRole("button", { name: "Reload saved draft", exact: true })
      .click()
    await other.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(definition(other)).toHaveValue(firstTabWriting)
    const recovered = `${edited} The conflict was reviewed and saving resumed.`
    await other.getByRole("tab", { name: "Definition", exact: true }).click()
    await definition(other).fill(recovered)
    await expect(saved(other)).toBeVisible()
    await expect
      .poll(async () => (await activeDraft()).payload.definition)
      .toBe(recovered)
    await page.close()
    record(
      "Two-tab conflict preserves unsaved writing; cancel and explicit reload work, then saving resumes"
    )

    await button(other, "Review proposal").click()
    const reviewDialog = other.getByRole("dialog")
    await expect(
      reviewDialog.getByText(recovered, { exact: true })
    ).toBeVisible()
    await expect(
      reviewDialog.getByText("Changes from the reference", {
        exact: true
      })
    ).toBeVisible()
    await expect(
      reviewDialog.getByText(
        "1 supporting citation and one reference version.",
        { exact: true }
      )
    ).toBeVisible()
    await reviewDialog
      .getByRole("button", { name: "Submit for review", exact: true })
      .click()
    await expect(other).toHaveURL(/\/metadata\/fields\/[0-9a-f-]+\?revision=/)
    const publication = (await activeDraft()).publication
    assert.ok(publication)
    await expect(
      other.getByText("Awaiting review", { exact: true })
    ).toBeVisible()
    await expect(
      other
        .getByRole("region", {
          name: "Changes from the reference",
          exact: true
        })
        .getByText(recovered, { exact: true })
    ).toBeVisible()
    await other
      .getByRole("tab", { name: "Sources & history", exact: true })
      .click()
    await expect(
      other.getByText("1 supporting citation · 1 reference version", {
        exact: true
      })
    ).toBeVisible()
    await expect(
      other.getByRole("link", {
        name: "Metadata source for the UI fixture",
        exact: true
      })
    ).toBeVisible()
    assert.equal(
      publication.definitionRevisionId,
      null,
      "A standalone proposal has no dictionary revision"
    )
    assert.equal(
      publication.term,
      null,
      "Submitting a field does not create a dictionary entry"
    )
    const [revision] = await db
      .select()
      .from(matcoreSpecRevisionsTable)
      .where(eq(matcoreSpecRevisionsTable.id, publication.revisionId))
    assert.equal(revision.payload.citations.length, 1)
    assert.equal(revision.payload.definition, recovered)
    const download = await other
      .getByRole("link", { name: "Download specification", exact: true })
      .getAttribute("href")
    assert.equal(
      download,
      `/api/metadata/fields/${publication.fieldId}?revisionId=${publication.revisionId}`
    )
    const exportResponse = await context.request.get(`${base}${download}`)
    assert.equal(exportResponse.status(), 200)
    const exported = await exportResponse.json()
    assert.equal(exported.revision.id, publication.revisionId)
    assert.equal(
      exported.revision.payload.citations[0].url,
      "https://example.org/matcore-ui-source"
    )
    assert.deepEqual(exported.baseline, selected.payload)
    assert.equal(exported.revision.payload.specification.valueForm, "list")
    assert.equal(exported.revision.payload.specification.repeatability, "yes")
    assert.equal(
      exported.revision.payload.specification.notes,
      "Record the dates in acquisition order."
    )
    assert.equal(exported.sourceRelease.version, MATCORE_FIXTURE_VERSION)
    await capture(other, "published-field-provenance")
    await other.getByRole("tab", { name: "Changes", exact: true }).click()
    await expect(other.locator('dl[aria-label="Field rules"]')).toContainText(
      "List"
    )
    await other
      .getByRole("tab", { name: "Field specification", exact: true })
      .click()
    await expect(
      other.locator('dl[aria-label="Field specification"]')
    ).toContainText("Record the dates in acquisition order.")
    await other.getByText("Compare with source rules", { exact: true }).click()
    await expect(
      other.locator('dl[aria-label="Source and proposal field rules"]')
    ).toContainText("Not recorded separately")
    await capture(other, "published-field-rules")
    record(
      "Submission retains source attribution, supporting citation, standalone definition and exact-revision JSON export"
    )

    await expect(
      other.getByRole("link", { name: "View dictionary entry", exact: true })
    ).toHaveCount(0)
    await button(other, "Propose a revision").click()
    await expect(other).toHaveURL(/\/metadata\/workspace\/[0-9a-f-]+/)
    activeDraftId = new URL(other.url()).pathname.split("/").at(-1)!
    await other
      .getByRole("tab", { name: "Field specification", exact: true })
      .click()
    await other
      .getByLabel("Format", { exact: true })
      .fill("YYYY-MM-DD with an explicit date example")
    await other
      .getByRole("textbox", { name: "Reason for this proposal", exact: true })
      .fill(
        "Clarify format guidance without changing the explanatory definition."
      )
    await button(other, "Review proposal").click()
    await other
      .getByRole("dialog")
      .getByRole("button", { name: "Submit for review", exact: true })
      .click()
    await expect(other).toHaveURL(/\/metadata\/fields\/[0-9a-f-]+\?revision=/)
    await expect(
      other.getByRole("tablist").getByRole("tab").first()
    ).toHaveText("Changes")
    await expect(
      other.getByRole("tab", { name: "Changes", exact: true })
    ).toHaveAttribute("data-state", "active")
    await expect(
      other.getByRole("region", {
        name: "Changes from revision 1",
        exact: true
      })
    ).toContainText("YYYY-MM-DD with an explicit date example")
    const secondPublication = (await activeDraft()).publication
    assert.ok(secondPublication)
    assert.notEqual(secondPublication.revisionId, publication.revisionId)
    assert.equal(
      secondPublication.definitionRevisionId,
      publication.definitionRevisionId
    )
    await other
      .getByLabel("Revision", { exact: true })
      .selectOption(publication.revisionId)
    await expect(
      other.getByText("Earlier revision", { exact: true })
    ).toBeVisible()
    await expect(
      other.getByRole("button", { name: "Propose a revision", exact: true })
    ).toHaveCount(0)
    await other
      .getByRole("tab", { name: "Field specification", exact: true })
      .click()
    await expect(
      other
        .locator('dl[aria-label="Field specification"]')
        .getByText("YYYY-MM-DD", { exact: true })
    ).toBeVisible()
    await other.setViewportSize({ width: 390, height: 844 })
    await capture(other, "field-revision-mobile")
    record(
      "Specification-only revision preserves its standalone definition; historical rules remain readable on mobile"
    )
    const genericContext = await browser.newContext({
      viewport: { width: 1365, height: 1000 }
    })
    await signInAs(genericContext, base, genericFixture.userId)
    await rememberView(genericContext, base, "simple")
    await genericContext.route("**/*", routeRequests)
    const generic = await genericContext.newPage()
    observe(generic)
    const genericWorkspace = `${base}/communities/${genericFixture.communitySlug}?view=work`
    await generic.goto(`${base}/metadata/workspace`)
    await expect(
      generic.getByRole("heading", { name: "Choose a workspace", exact: true })
    ).toBeVisible()
    await generic.goto(genericWorkspace)
    await expect(
      generic.getByRole("heading", {
        name: genericFixture.communityTitle,
        exact: true
      })
    ).toBeVisible()
    await expect(button(generic, "New metadata field")).toHaveCount(0)
    await generic
      .getByRole("navigation", { name: "Community workspace", exact: true })
      .getByRole("button", { name: "More", exact: true })
      .click()
    await generic
      .getByRole("menuitem", { name: "Settings", exact: true })
      .click()
    await generic.locator("summary#workspace-tools").click()
    await button(generic, "Enable metadata development").click()
    await expect(button(generic, "Disable new metadata fields")).toBeVisible()
    await generic.goto(genericWorkspace)
    await expect(button(generic, "New metadata field")).toBeVisible()
    await expect(button(generic, "Import all sections as drafts")).toHaveCount(
      0
    )
    const [settings] = await db
      .select()
      .from(vocabularyWorkspaceSettingsTable)
      .where(
        eq(
          vocabularyWorkspaceSettingsTable.vocabularySlug,
          genericFixture.vocabularySlug
        )
      )
    assert.equal(settings.metadataEnabled, true)
    assert.equal(settings.matcoreEnabled, false)
    record(
      "A community steward enables metadata development without enabling MatCore"
    )

    const genericLabel = `Sample preparation temperature ${genericFixture.token}`
    const genericDefinition =
      "The temperature used during preparation of a material sample."
    await button(generic, "New metadata field").click()
    await generic
      .getByRole("dialog")
      .getByLabel("Field name", { exact: true })
      .fill(genericLabel)
    await expect(
      generic
        .getByRole("dialog")
        .getByLabel("Standard context", { exact: true })
    ).toHaveCount(0)
    await button(generic, "Create private draft").click()
    await expect(generic).toHaveURL(/\/metadata\/workspace\/[0-9a-f-]+/)
    const genericDraftUrl = generic.url()
    const genericDraftId = new URL(genericDraftUrl).pathname.split("/").at(-1)!
    const genericDraft = async () => {
      const [row] = await db
        .select()
        .from(matcoreSpecDraftsTable)
        .where(
          and(
            eq(matcoreSpecDraftsTable.id, genericDraftId),
            eq(matcoreSpecDraftsTable.ownerId, genericFixture.userId)
          )
        )
      assert.ok(row)
      return row
    }
    await generic.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(definition(generic)).toBeEditable()
    await expect(generic.getByLabel("Data type", { exact: true })).toBeVisible()
    await expect(
      generic.getByLabel("Repeatable field", { exact: true })
    ).toBeVisible()
    await expect(
      generic.getByText("Compare with source rules", { exact: true })
    ).toHaveCount(0)
    await generic.getByRole("tab", { name: "Definition", exact: true }).click()
    await definition(generic).fill(genericDefinition)
    await generic
      .getByLabel("Reason for this proposal", { exact: true })
      .fill("Record sample preparation conditions for this community.")
    await generic
      .getByRole("tab", { name: "Field specification", exact: true })
      .click()
    await generic
      .getByLabel("Field path", { exact: true })
      .fill("sample.preparation.temperature")
    await generic
      .getByLabel("Data type", { exact: true })
      .selectOption("number")
    await generic
      .getByLabel("Value form", { exact: true })
      .selectOption("array")
    await generic
      .getByLabel("Repeatable field", { exact: true })
      .selectOption("yes")
    await generic
      .getByLabel("Requirement", { exact: true })
      .selectOption("recommended")
    await generic
      .getByText("More specification details", { exact: true })
      .click()
    await generic.getByLabel("Units", { exact: true }).fill("K")
    await generic
      .getByLabel("Allowed values", { exact: true })
      .fill("273.15\n298.15")
    await generic
      .getByLabel("Notes", { exact: true })
      .fill("Measure after thermal equilibration.")
    await generic
      .getByRole("tab", { name: "Sources & history", exact: true })
      .click()
    await expect(
      generic.getByText("This field has no reference version.", { exact: true })
    ).toBeVisible()
    await button(generic, "Add citation").click()
    await generic
      .getByLabel("Source title", { exact: true })
      .fill("Community preparation protocol")
    await generic
      .getByLabel("Source address", { exact: true })
      .fill("https://example.org/preparation-protocol")
    await generic
      .getByLabel("How this source supports the proposal", { exact: true })
      .fill("Defines the preparation temperature and its units.")
    await button(generic, "Save citation").click()
    await generic
      .getByRole("link", {
        name: `Back to ${genericFixture.communityTitle} · My work`,
        exact: true
      })
      .click()
    await expect(generic).toHaveURL(`${genericWorkspace}#my-field-drafts`)
    let genericRow = await genericDraft()
    assert.equal(genericRow.payload.definition, genericDefinition)
    assert.equal(genericRow.profileKey, null)
    assert.equal(genericRow.profileReleaseId, null)
    assert.equal(genericRow.sourceOccurrenceId, null)
    assert.equal(genericRow.payload.citations.length, 1)
    assert.equal(genericRow.payload.specification.valueForm, "array")
    assert.equal(genericRow.payload.specification.repeatability, "yes")
    assert.equal(
      genericRow.payload.specification.notes,
      "Measure after thermal equilibration."
    )
    await generic.goto(genericDraftUrl)
    await generic.getByRole("tab", { name: "Definition", exact: true }).click()
    await expect(definition(generic)).toHaveValue(genericDefinition)
    await generic
      .getByRole("tab", { name: "Field specification", exact: true })
      .click()
    await generic
      .getByText("More specification details", { exact: true })
      .click()
    await expect(generic.getByLabel("Units", { exact: true })).toHaveValue("K")
    await expect(generic.getByLabel("Value form", { exact: true })).toHaveValue(
      "array"
    )
    await expect(
      generic.getByLabel("Repeatable field", { exact: true })
    ).toHaveValue("yes")
    await expect(generic.getByLabel("Notes", { exact: true })).toHaveValue(
      "Measure after thermal equilibration."
    )
    await expect(
      generic.getByLabel("Allowed values", { exact: true })
    ).toHaveValue("273.15\n298.15")
    await capture(generic, "generic-field-specification")
    await generic
      .getByLabel("Value form", { exact: true })
      .selectOption("scalar")
    await generic
      .getByLabel("Repeatable field", { exact: true })
      .selectOption("no")
    await button(generic, "Save draft").click()
    await expect
      .poll(async () => (await genericDraft()).payload.specification.valueForm)
      .toBe("scalar")
    await generic.reload()
    await expect(generic.getByLabel("Data type", { exact: true })).toHaveValue(
      "number"
    )
    await expect(generic.getByLabel("Value form", { exact: true })).toHaveValue(
      "scalar"
    )
    await expect(
      generic.getByLabel("Repeatable field", { exact: true })
    ).toHaveValue("no")
    await generic.setViewportSize({ width: 390, height: 844 })
    await capture(generic, "generic-field-rules-mobile")
    assert.equal(
      await generic.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      ),
      false
    )
    await generic.setViewportSize({ width: 1365, height: 1000 })
    record(
      "A metadata field outside MatCore saves and reloads its definition, value rules and citation without a profile or source baseline"
    )

    // This user is a member of both communities, but cannot see the first
    // contributor's private drafts. Scope also excludes their own other work.
    await generic.goto(workspace)
    await expect(
      generic.locator(`a[href^="/metadata/workspace/${selected.id}"]`)
    ).toHaveCount(0)
    await expect(
      generic.locator(`a[href^="/metadata/workspace/${genericDraftId}"]`)
    ).toHaveCount(0)
    // The server can begin streaming the page before notFound() runs, so the
    // page's transport status alone does not establish draft access control.
    const privateInput = encodeURIComponent(JSON.stringify({ id: selected.id }))
    const privateResponse = await genericContext.request.get(
      `${base}/api/trpc/matcoreWorkflow.getDraft?input=${privateInput}`
    )
    assert.equal(privateResponse.status(), 404)
    const privateResult = await privateResponse.json()
    assert.equal(privateResult.error.data.code, "NOT_FOUND")
    assert.equal(privateResult.result, undefined)
    const privatePage = await genericContext.newPage()
    await privatePage.goto(`${base}/metadata/workspace/${selected.id}`)
    await expect(
      privatePage.getByRole("heading", { name: "404", exact: true })
    ).toBeVisible()
    await expect(definition(privatePage)).toHaveCount(0)
    await privatePage.close()
    await generic.goto(genericWorkspace)
    await expect(
      generic
        .locator(`a[href^="/metadata/workspace/${genericDraftId}"]`)
        .first()
    ).toBeVisible()
    await expect(
      generic.locator(`a[href^="/metadata/workspace/${selected.id}"]`)
    ).toHaveCount(0)
    record(
      "Community work is scoped to its vocabulary and draft owner; membership does not grant access to another contributor's private UUID editor"
    )

    await generic.goto(genericDraftUrl)
    await button(generic, "Review proposal").click()
    await expect(
      generic
        .getByRole("dialog")
        .getByText("1 supporting citation.", { exact: true })
    ).toBeVisible()
    await generic
      .getByRole("dialog")
      .getByRole("button", { name: "Submit for review", exact: true })
      .click()
    await expect(generic).toHaveURL(/\/metadata\/fields\/[0-9a-f-]+\?revision=/)
    genericRow = await genericDraft()
    const genericPublication = genericRow.publication
    assert.ok(genericPublication)
    await generic
      .getByRole("tab", { name: "Sources & history", exact: true })
      .click()
    await expect(
      generic.getByRole("link", {
        name: "Community preparation protocol",
        exact: true
      })
    ).toBeVisible()
    await expect(
      generic.getByText("1 supporting citation · No reference version", {
        exact: true
      })
    ).toBeVisible()
    await expect(
      generic.getByText("This field has no reference version.", { exact: true })
    ).toBeVisible()
    const genericDownload = await generic
      .getByRole("link", { name: "Download specification", exact: true })
      .getAttribute("href")
    const genericExportResponse = await genericContext.request.get(
      `${base}${genericDownload}`
    )
    assert.equal(genericExportResponse.status(), 200)
    const genericExport = await genericExportResponse.json()
    assert.equal(genericExport.revision.id, genericPublication.revisionId)
    assert.equal(
      genericExport.revision.payload.citations[0].url,
      "https://example.org/preparation-protocol"
    )
    assert.equal(genericExport.profileContext, null)
    assert.equal(genericExport.sourceRelease, null)
    assert.equal(genericExport.baseline, null)
    assert.equal(genericExport.sourceOccurrence, null)
    assert.deepEqual(
      genericExport.revision.payload.specification,
      genericRow.payload.specification
    )
    assert.equal(
      genericExport.revision.payload.specification.valueForm,
      "scalar"
    )
    assert.equal(
      genericExport.revision.payload.specification.repeatability,
      "no"
    )
    assert.equal(genericPublication.definitionRevisionId, null)
    assert.equal(
      genericPublication.term,
      null,
      "An independent metadata proposal has no imported dictionary origin"
    )
    await capture(generic, "generic-field-provenance")
    record(
      "Submitting a generic field retains its citation and revision provenance; JSON explicitly has no MatCore profile, baseline or imported origin"
    )

    await generic.goto(genericWorkspace)
    await generic
      .getByRole("link", { name: "Define a term", exact: true })
      .click()
    await expect(generic).toHaveURL(/\/add\?/)
    assert.equal(
      new URL(generic.url()).searchParams.get("vocabularySlug"),
      genericFixture.vocabularySlug
    )
    const ordinaryLabel = `ordinary community concept ${genericFixture.token}`
    await generic.getByLabel("Term", { exact: true }).fill(ordinaryLabel)
    await button(generic, "Confirm term").click()
    await expect(definition(generic)).toBeEditable()
    await definition(generic).fill(
      "An ordinary vocabulary concept retained alongside metadata field proposals."
    )
    await expect
      .poll(async () => {
        const drafts = await db
          .select()
          .from(termDraftsTable)
          .where(eq(termDraftsTable.ownerId, genericFixture.userId))
        const candidate = drafts.find(
          (draft) => draft.payload?.term === ordinaryLabel
        )
        if (!candidate?.payload) return null
        return candidate.payload.vocabularySlug
      })
      .toBe(genericFixture.vocabularySlug)
    await generic
      .getByRole("link", {
        name: `Back to ${genericFixture.communityTitle} · My work`,
        exact: true
      })
      .click()
    await expect(generic).toHaveURL(`${genericWorkspace}#term-drafts`)
    await expect(
      generic.getByRole("heading", { name: "My term drafts", exact: true })
    ).toBeVisible()
    await expect(
      generic.getByRole("heading", { name: ordinaryLabel, exact: true })
    ).toBeVisible()
    const [ordinaryDraft] = await db
      .select()
      .from(termDraftsTable)
      .where(eq(termDraftsTable.ownerId, genericFixture.userId))
    assert.ok(ordinaryDraft?.payload, "The ordinary draft retains its payload")
    assert.equal(ordinaryDraft.payload.term, ordinaryLabel)
    await generic
      .getByRole("link", { name: `Resume ${ordinaryLabel}`, exact: true })
      .click()
    await expect(generic).toHaveURL(
      new RegExp(`[?&]draftId=${ordinaryDraft.id}(?:&|$)`)
    )
    await expect(definition(generic)).toHaveValue(
      "An ordinary vocabulary concept retained alongside metadata field proposals."
    )
    await button(generic, "Review definition").click()
    await button(generic, "Publish new term").click()
    await expect(generic).toHaveURL(
      new RegExp(`/vocabulary/${genericFixture.vocabularySlug}/`)
    )
    const ordinaryTerms = await db
      .select()
      .from(termsTable)
      .where(
        and(
          eq(termsTable.vocabularySlug, genericFixture.vocabularySlug),
          eq(termsTable.term, ordinaryLabel.toLowerCase())
        )
      )
    assert.equal(ordinaryTerms.length, 1)
    record(
      "The consolidated community creates, lists, resumes and publishes an ordinary vocabulary draft in the correct destination alongside metadata work"
    )
    assert.deepEqual(
      blocked,
      [],
      "No provider/ontology calls or unrelated writes"
    )
    assert.deepEqual(errors, [], "No browser runtime errors")
  } catch (error) {
    failure = error
    const page = browser
      ?.contexts()
      .flatMap((context) => context.pages())
      .at(-1)
    if (page) {
      await page
        .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
        .catch(() => {})
      await writeFile(
        resolve(output, "failure-page.txt"),
        await page
          .locator("body")
          .innerText()
          .catch(() => "Page unavailable")
      )
    }
  } finally {
    try {
      if (browser) await closeBrowserAfterRoutes(browser)
      // The second user also joins the first community for privacy checks.
      // Remove only that explicitly created cross-membership before either
      // helper deletes its fixture user/community.
      await db
        .delete(communityMembersTable)
        .where(
          and(
            eq(communityMembersTable.communityId, fixture.communityId),
            eq(communityMembersTable.userId, genericFixture.userId),
            eq(communityMembersTable.addedById, fixture.userId)
          )
        )
      const originalFixture = fixture
      for (const fixture of [genericFixture, originalFixture]) {
        await db.transaction(async (tx) => {
          const [user] = await tx
            .select()
            .from(usersTable)
            .where(eq(usersTable.id, fixture.userId))
          const [vocabulary] = await tx
            .select()
            .from(vocabulariesTable)
            .where(eq(vocabulariesTable.slug, fixture.vocabularySlug))
          assert.equal(user?.name, fixture.userName)
          assert.equal(vocabulary?.createdById, fixture.userId)
          const fields = await tx
            .select()
            .from(matcoreFieldsTable)
            .where(
              eq(matcoreFieldsTable.vocabularySlug, fixture.vocabularySlug)
            )
          assert.ok(
            fields.every((field) => field.createdById === fixture.userId)
          )
          const ids = fields.map((field) => field.id)
          if (ids.length) {
            const drafts = await tx
              .select()
              .from(matcoreSpecDraftsTable)
              .where(inArray(matcoreSpecDraftsTable.fieldId, ids))
            const revisions = await tx
              .select()
              .from(matcoreSpecRevisionsTable)
              .where(inArray(matcoreSpecRevisionsTable.fieldId, ids))
            const events = await tx
              .select()
              .from(matcoreWorkflowEventsTable)
              .where(inArray(matcoreWorkflowEventsTable.fieldId, ids))
            assert.ok(drafts.every((row) => row.ownerId === fixture.userId))
            assert.ok(
              revisions.every((row) => row.createdById === fixture.userId)
            )
            assert.ok(events.every((row) => row.actorId === fixture.userId))
            await tx
              .delete(matcoreWorkflowEventsTable)
              .where(inArray(matcoreWorkflowEventsTable.fieldId, ids))
            await tx
              .delete(matcoreSpecDraftsTable)
              .where(inArray(matcoreSpecDraftsTable.fieldId, ids))
            await tx
              .delete(matcoreSpecRevisionsTable)
              .where(inArray(matcoreSpecRevisionsTable.fieldId, ids))
            await tx
              .delete(matcoreFieldsTable)
              .where(inArray(matcoreFieldsTable.id, ids))
          }
        })
        await db
          .delete(vocabularyWorkspaceSettingsTable)
          .where(
            eq(
              vocabularyWorkspaceSettingsTable.vocabularySlug,
              fixture.vocabularySlug
            )
          )
        if (fixture === originalFixture && sourceInstalled)
          await removeSyntheticUiSource(fixture, syntheticSourceCreated)
        await removeGuidedSetupFixture(fixture)
      }
      cleaned = true
    } catch (error) {
      cleanupFailure = error
      console.error("Fixture cleanup failed:", error)
    }
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          passed,
          blocked,
          errors,
          unloadDecisions,
          cleaned,
          fixtures: { fixture, genericFixture },
          cleanupFailure:
            cleanupFailure instanceof Error
              ? cleanupFailure.stack
              : (cleanupFailure ?? null),
          failure: failure instanceof Error ? failure.stack : (failure ?? null)
        },
        null,
        2
      )
    )
  }
  if (failure) throw failure
  if (cleanupFailure) throw cleanupFailure
  console.log(`MatCore workflow UI evidence: ${output}`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
