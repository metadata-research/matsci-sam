// Real local HTTP with uniquely owned fixtures. No provider, publishing or
// unrelated writes are allowed; retained metadata drafts are fingerprinted.
import "dotenv/config"
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  expect as baseExpect,
  type Browser,
  type BrowserContext,
  type Page,
  type Route
} from "@playwright/test"
import { and, eq, inArray } from "drizzle-orm"
import {
  db,
  communityMembersTable,
  importBatchesTable,
  importRowsTable,
  matcoreFieldsTable,
  matcoreSpecDraftsTable,
  matcoreSpecRevisionsTable,
  matcoreWorkflowEventsTable,
  termDraftsTable,
  vocabularyWorkspaceSettingsTable
} from "../drizzle"
import { emptyMatcoreDraftPayload } from "../lib/matcore-workflow-types"
import { emptyTermDraftPayload } from "../lib/term-draft-types"
import {
  createGuidedSetupFixture,
  removeGuidedSetupFixture,
  type GuidedSetupFixture
} from "./guided-setup-ui-fixture"
import {
  closeBrowserAfterRoutes,
  launchBrowser,
  localPreviewBase,
  rememberView,
  signInAs
} from "./ui-test-harness"

const expect = baseExpect.configure({ timeout: 30000 })
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const deferred = () => {
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { wait, release, reached: false }
}
const retainedMetadata = async () => {
  const tables = await Promise.all([
    db.select().from(matcoreFieldsTable).orderBy(matcoreFieldsTable.id),
    db.select().from(matcoreSpecDraftsTable).orderBy(matcoreSpecDraftsTable.id),
    db
      .select()
      .from(matcoreSpecRevisionsTable)
      .orderBy(matcoreSpecRevisionsTable.id),
    db
      .select()
      .from(matcoreWorkflowEventsTable)
      .orderBy(matcoreWorkflowEventsTable.id)
  ])
  return tables.map((rows) => ({ count: rows.length, sha256: hash(rows) }))
}

async function main() {
  const base = localPreviewBase()
  const origin = new URL(base).origin
  const retainedBefore = await retainedMetadata()
  const fixtures: GuidedSetupFixture[] = []
  const output = resolve(
    process.env.SAM_UI_TEST_OUTPUT_DIR ??
      `${tmpdir()}/matsci-community-sections-${randomUUID()}`
  )
  const passed: string[] = []
  const blocked: string[] = []
  const errors: string[] = []
  const expectedFailures: string[] = []
  const mutations: Array<{ path: string; id: unknown }> = []
  const measurements: Record<string, unknown> = {}
  const fieldIds: string[] = []
  const fieldDraftIds: string[] = []
  const termId = randomUUID()
  const importedId = randomUUID()
  const batchId = randomUUID()
  let browser: Browser | undefined
  let observedPage: Page | undefined
  let failure: unknown
  let cleanupFailure: unknown
  let cleaned = false
  let retainedAfter: Awaited<ReturnType<typeof retainedMetadata>> | undefined
  let rejectFieldSaves = false
  let heldTermSave: ReturnType<typeof deferred> | undefined
  const record = (name: string) => {
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  const observe = (page: Page) => {
    observedPage = page
    page.setDefaultNavigationTimeout(90000)
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() !== "error") return
      const expected =
        message
          .location()
          .url.includes("/api/trpc/matcoreWorkflow.updateDraft") &&
        /ERR_CONNECTION_RESET|ERR_FAILED/.test(message.text())
      if (expected) expectedFailures.push(message.text())
      else errors.push(message.text())
    })
    page.on("dialog", async (dialog) => {
      errors.push(`Unexpected native dialog: ${dialog.message()}`)
      await dialog.dismiss()
    })
  }
  const outline = (page: Page) =>
    page.getByRole("navigation", { name: "On this page", exact: true })
  const outlineTargets = (page: Page) =>
    outline(page)
      .locator("a[href]")
      .evaluateAll((nodes) =>
        nodes.map((node) => new URL((node as HTMLAnchorElement).href).hash)
      )
  const visibleFocus = async (page: Page, id: string) => {
    const target = page.locator(`[id="${id}"]`)
    await expect(target).toBeFocused()
    await expect
      .poll(() =>
        target.evaluate((node) => {
          const rect = node.getBoundingClientRect()
          return rect.top >= 0 && rect.bottom <= innerHeight
        })
      )
      .toBe(true)
    await expect
      .poll(() =>
        target.evaluate((node) => {
          const rect = node.getBoundingClientRect()
          const top = document.elementFromPoint(
            rect.left + Math.min(8, rect.width / 2),
            rect.top + rect.height / 2
          )
          return top === node || node.contains(top)
        })
      )
      .toBe(true)
  }
  const jump = async (page: Page, id: string, keyboard = false) => {
    const nav = outline(page)
    const disclosure = nav.getByRole("button", { name: /^On this page/ })
    if (
      (await disclosure.isVisible()) &&
      (await disclosure.getAttribute("aria-expanded")) !== "true"
    )
      await disclosure.click()
    const link = nav.locator(`a[href$="#${id}"]`)
    if (keyboard) {
      await link.focus()
      await page.keyboard.press("Enter")
    } else await link.click()
    await expect(page).toHaveURL(new RegExp(`#${id}$`))
    await visibleFocus(page, id)
    await expect(link).toHaveAttribute("aria-current", "location")
    await expect
      .poll(() =>
        page
          .locator(`[id="${id}"]`)
          .evaluate((node) =>
            Boolean(
              node.hasAttribute("data-arrived") ||
                node.closest("[data-arrived]")
            )
          )
      )
      .toBe(true)
    if (await disclosure.isVisible())
      await expect(disclosure).toHaveAttribute("aria-expanded", "false")
  }
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
  const guard = async (context: BrowserContext) => {
    await context.route("**/*", async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? []
      if (
        url.origin !== origin ||
        paths.some((path) =>
          /^(aiAssist\.|termReferences\.retrieve|ontologyContext\.)/.test(path)
        )
      ) {
        blocked.push(`${request.method()} ${url.pathname}`)
        return route.abort("blockedbyclient")
      }
      if (request.method() === "GET") return route.continue()
      if (paths.length !== 1) {
        blocked.push(`${request.method()} ${url.pathname}`)
        return route.abort("blockedbyclient")
      }
      const input = request.postDataJSON() as Record<string, { id?: string }>
      const allowed =
        paths.length === 1 &&
        ((paths[0] === "termDrafts.update" && input[0]?.id === termId) ||
          (paths[0] === "matcoreWorkflow.updateDraft" &&
            fieldDraftIds.includes(input[0]?.id ?? "")))
      if (!allowed) {
        blocked.push(`${request.method()} ${url.pathname}`)
        return route.abort("blockedbyclient")
      }
      mutations.push({ path: paths[0], id: input[0]?.id })
      if (rejectFieldSaves && paths[0] === "matcoreWorkflow.updateDraft")
        return route.abort("connectionreset")
      if (heldTermSave && paths[0] === "termDrafts.update") {
        heldTermSave.reached = true
        await heldTermSave.wait
      }
      const response = await route.fetch({ timeout: 90000 })
      return route.fulfill({ response })
    })
  }
  try {
    await mkdir(output, { recursive: true })
    const fixture = await createGuidedSetupFixture()
    fixtures.push(fixture)
    const emptyFixture = await createGuidedSetupFixture()
    fixtures.push(emptyFixture)
    await writeFile(
      resolve(output, "fixtures.json"),
      JSON.stringify(fixtures, null, 2)
    )
    await db
      .update(communityMembersTable)
      .set({ role: "steward" })
      .where(
        and(
          eq(communityMembersTable.communityId, fixture.communityId),
          eq(communityMembersTable.userId, fixture.userId)
        )
      )
    await db.insert(vocabularyWorkspaceSettingsTable).values({
      vocabularySlug: fixture.vocabularySlug,
      metadataEnabled: true,
      matcoreEnabled: false,
      updatedById: fixture.userId
    })
    const termName = `section navigation term ${fixture.token}`
    for (const [id, label] of [
      [termId, termName],
      [importedId, `import ${termName}`]
    ]) {
      const payload = emptyTermDraftPayload(fixture.vocabularySlug)
      payload.term = label
      payload.definition =
        "A synthetic material used only by this local navigation regression."
      payload.editorState = {
        step: "write",
        confirmed: {
          term: label,
          vocabularySlug: fixture.vocabularySlug,
          vocabularyTitle: fixture.vocabularyTitle
        },
        references: [],
        preview: null,
        appliedDraft: null,
        undo: null,
        includeDefinition: false,
        includeExample: false
      }
      await db.insert(termDraftsTable).values({
        id,
        ownerId: fixture.userId,
        payload,
        creationHash: hash(payload)
      })
    }
    await db.insert(importBatchesTable).values({
      id: batchId,
      ownerId: fixture.userId,
      name: `Navigation import ${fixture.token}`,
      creationHash: hash(batchId),
      inputHash: hash(termName),
      parserVersion: "draft-csv-v1",
      format: "csv",
      originalText: `term,definition\n${termName},Synthetic material`,
      vocabularySlug: fixture.vocabularySlug
    })
    await db.insert(importRowsTable).values({
      id: randomUUID(),
      batchId,
      rowIdentity: "2",
      recordNumber: 1,
      sourceLine: 2,
      rowHash: hash(termName),
      original: {
        term: `import ${termName}`,
        definition: "Synthetic material"
      },
      decision: "selected",
      draftId: importedId
    })
    // Forty-four rows exercise real pagination without importing or modifying
    // any retained MatCore standard rows.
    for (let index = 0; index < 44; index++) {
      const fieldId = randomUUID()
      const id = randomUUID()
      const payload = emptyMatcoreDraftPayload()
      payload.label = `Navigation field ${String(index + 1).padStart(2, "0")} ${fixture.token}`
      payload.definition =
        "A synthetic metadata field for local navigation checks."
      payload.specification.path = `navigation.field${index + 1}`
      await db.insert(matcoreFieldsTable).values({
        id: fieldId,
        vocabularySlug: fixture.vocabularySlug,
        label: payload.label,
        createdById: fixture.userId
      })
      fieldIds.push(fieldId)
      await db.insert(matcoreSpecDraftsTable).values({
        id,
        ownerId: fixture.userId,
        fieldId,
        occurrenceKey: `local:${id}`,
        payload,
        creationHash: hash(payload)
      })
      fieldDraftIds.push(id)
    }
    browser = await launchBrowser()
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 }
    })
    await signInAs(context, base, fixture.userId)
    await rememberView(context, base, "simple")
    await guard(context)
    const page = await context.newPage()
    observe(page)
    const workPath = `/communities/${fixture.communitySlug}?view=work`
    const work = `${base}${workPath}`
    await page.goto(work)
    await expect(outline(page)).toBeVisible()
    assert.deepEqual(await outlineTargets(page), [
      "#term-drafts",
      "#term-imports",
      "#my-field-drafts",
      "#workspace-tools"
    ])
    await jump(page, "my-field-drafts", true)
    await jump(page, "my-field-drafts")
    await jump(page, "workspace-tools")
    await expect(
      page.getByRole("button", {
        name: "Disable new metadata fields",
        exact: true
      })
    ).toBeVisible()
    await jump(page, "term-drafts")
    await capture(page, "my-work-desktop")
    record(
      "Desktop outline contains authorized sections; pointer and keyboard jumps focus and highlight visible targets"
    )

    const beforeScrollURL = page.url()
    await page.mouse.wheel(0, 100000)
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            scrollY + innerHeight >= document.documentElement.scrollHeight - 2
        )
      )
      .toBe(true)
    await expect(page.locator("#term-drafts")).toBeFocused()
    await expect(page.locator("#term-drafts")).not.toBeInViewport()
    await expect(
      outline(page).locator('a[href$="#workspace-tools"]')
    ).toHaveAttribute("aria-current", "location")
    assert.equal(page.url(), beforeScrollURL)
    await page
      .locator("#my-field-drafts")
      .evaluate((node) =>
        node.scrollIntoView({ block: "start", behavior: "instant" })
      )
    await expect(
      outline(page).locator('a[href$="#my-field-drafts"]')
    ).toHaveAttribute("aria-current", "location")
    assert.equal(
      page.url(),
      beforeScrollURL,
      "Passive scrolling must not replace the explicit fragment"
    )
    await page.goto(`${work}#my-field-drafts`)
    await expect(page.locator("#my-field-drafts")).toBeInViewport()
    await jump(page, "term-drafts")
    await page.goBack()
    await expect(page).toHaveURL(`${work}#my-field-drafts`)
    await expect(page.locator("#my-field-drafts")).toBeInViewport()
    await page.goForward()
    await expect(page).toHaveURL(`${work}#term-drafts`)
    await expect(page.locator("#term-drafts")).toBeInViewport()
    record(
      "Direct fragments and Back/Forward restore sections; passive scrolling does not rewrite history"
    )

    const people = `${base}/communities/${fixture.communitySlug}?view=people`
    await page
      .getByRole("navigation", { name: "Community workspace", exact: true })
      .getByRole("link", { name: "People", exact: true })
      .click()
    await expect(page).toHaveURL(people)
    assert.deepEqual(await outlineTargets(page), [
      "#people",
      "#access-requests",
      "#invitations",
      "#join-link"
    ])
    await jump(page, "invitations")
    await jump(page, "join-link", true)
    await page.goBack()
    await expect(page).toHaveURL(`${people}#invitations`)
    await page.goBack()
    await expect(page).toHaveURL(people)
    await page.goBack()
    await expect(page).toHaveURL(`${work}#term-drafts`)
    await page.goForward()
    await expect(page).toHaveURL(people)
    await page.goForward()
    await expect(page).toHaveURL(`${people}#invitations`)
    await expect(page.locator("#invitations")).toBeInViewport()
    record(
      "People outline follows view changes and query-plus-fragment Back/Forward navigation"
    )

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(work)
    const disclosure = outline(page).getByRole("button", {
      name: /^On this page/
    })
    await expect(disclosure).toBeVisible()
    await disclosure.click()
    await expect(disclosure).toHaveAttribute("aria-expanded", "true")
    assert.ok(
      await outline(page)
        .locator("ul")
        .evaluate(
          (node) =>
            node.getBoundingClientRect().height <= innerHeight * 0.55 + 1
        ),
      "The expanded mobile outline remains bounded"
    )
    await page.keyboard.press("Escape")
    await expect(disclosure).toHaveAttribute("aria-expanded", "false")
    await expect(disclosure).toBeFocused()
    await jump(page, "my-field-drafts")
    await jump(page, "my-field-drafts", true)
    await capture(page, "my-work-mobile")
    await jump(page, "workspace-tools", true)
    await expect(
      page.getByRole("button", {
        name: "Disable new metadata fields",
        exact: true
      })
    ).toBeVisible()
    await page.goto(`${people}#invitations`)
    await jump(page, "join-link")
    await capture(page, "people-mobile")
    await page.emulateMedia({ reducedMotion: "reduce" })
    await jump(page, "people", true)
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto(work)
    await jump(page, "my-field-drafts", true)
    await capture(page, "my-work-320px")
    record(
      "390px and 320px navigation closes after jumps, keeps focus visible and works with reduced motion without horizontal overflow"
    )

    await page.setViewportSize({ width: 1440, height: 1000 })
    const pagedWork = `${work}&offset=40`
    // Entering initially with a hash is essential: Next can seed that hash in
    // its route cache, then duplicate it during a later soft return from an
    // editor. Check the actual resulting address, not only the link's href.
    await page.goto(`${pagedWork}#my-field-drafts`)
    const fieldLink = page.locator('a[href^="/metadata/workspace/"]').first()
    const fieldHref = await fieldLink.getAttribute("href")
    assert.ok(fieldHref)
    const fieldURL = new URL(fieldHref, base)
    const fieldId = fieldURL.pathname.split("/").at(-1)!
    assert.ok(fieldDraftIds.includes(fieldId))
    await fieldLink.click()
    const fieldReturn = page.getByRole("link", { name: /^Back to .*My work/ })
    await expect(fieldReturn).toHaveAttribute(
      "href",
      `${workPath}&offset=40#my-field-drafts`
    )
    const fieldWriting = page.getByRole("textbox", {
      name: "Definition",
      exact: true
    })
    const newWriting =
      "This synthetic edit survives a failed contextual return and retry."
    rejectFieldSaves = true
    await fieldWriting.fill(newWriting)
    await fieldReturn.click()
    await expect(
      page.getByRole("button", { name: "Retry save", exact: true })
    ).toBeVisible()
    await expect(page).toHaveURL(fieldURL.href)
    await expect(fieldWriting).toHaveValue(newWriting)
    rejectFieldSaves = false
    await page.getByRole("button", { name: "Retry save", exact: true }).click()
    await expect(
      page.getByText("Draft saved to your account", { exact: true })
    ).toBeVisible()
    await fieldReturn.click()
    await expect(page).toHaveURL(`${pagedWork}#my-field-drafts`)
    await expect(page.locator("#my-field-drafts")).toBeInViewport()
    assert.equal(
      (
        await db
          .select()
          .from(matcoreSpecDraftsTable)
          .where(eq(matcoreSpecDraftsTable.id, fieldId))
      )[0].payload.definition,
      newWriting
    )
    record(
      "Metadata draft return preserves page 2 and section; a failed save retains writing until retry succeeds"
    )

    const filteredWork = `${work}&profile=dft&offset=40`
    const filteredWorkPath = `${workPath}&profile=dft&offset=40`
    await page.goto(`${filteredWork}#term-drafts`)
    await page
      .getByRole("link", { name: `Resume ${termName}`, exact: true })
      .click()
    const termReturn = page.getByRole("link", { name: /^Back to .*My work/ })
    await expect(termReturn).toHaveAttribute(
      "href",
      `${filteredWorkPath}#term-drafts`
    )
    const termWriting = page.getByRole("textbox", {
      name: "Definition",
      exact: true
    })
    await expect(termWriting).toBeEditable()
    const termURL = page.url()
    heldTermSave = deferred()
    const termText =
      "A pending save finishes before returning to the originating community."
    await termWriting.fill(termText)
    await termReturn.click()
    await expect.poll(() => heldTermSave!.reached).toBe(true)
    await expect(page).toHaveURL(termURL)
    await expect(termWriting).toHaveValue(termText)
    heldTermSave.release()
    await expect(page).toHaveURL(`${filteredWork}#term-drafts`)
    heldTermSave = undefined
    assert.equal(
      (
        await db
          .select()
          .from(termDraftsTable)
          .where(eq(termDraftsTable.id, termId))
      )[0].payload?.definition,
      termText
    )
    await page
      .getByRole("link", { name: `Resume ${termName}`, exact: true })
      .click()
    await expect(termWriting).toHaveValue(termText)
    await termReturn.click()
    await expect(page).toHaveURL(`${filteredWork}#term-drafts`)
    record(
      "Term draft first-click contextual return waits for the real save, preserves filters and pagination, and retains writing on re-entry"
    )

    await jump(page, "term-imports")
    await page.getByRole("link", { name: "Review import", exact: true }).click()
    const importReturn = page.getByRole("link", { name: /^Back to .*My work/ })
    await expect(importReturn).toHaveAttribute(
      "href",
      `${filteredWorkPath}#term-imports`
    )
    await importReturn.click()
    await expect(page).toHaveURL(`${filteredWork}#term-imports`)
    record(
      "Import review returns to the same community, pagination and import section"
    )

    // All role/configuration mutations below affect only this run's fixture.
    await db
      .update(communityMembersTable)
      .set({ role: "member" })
      .where(
        and(
          eq(communityMembersTable.communityId, fixture.communityId),
          eq(communityMembersTable.userId, fixture.userId)
        )
      )
    await db
      .update(vocabularyWorkspaceSettingsTable)
      .set({ metadataEnabled: false })
      .where(
        eq(
          vocabularyWorkspaceSettingsTable.vocabularySlug,
          fixture.vocabularySlug
        )
      )
    await page.goto(`${work}#workspace-tools`)
    assert.deepEqual(await outlineTargets(page), [
      "#term-drafts",
      "#term-imports",
      "#my-field-drafts"
    ])
    await expect(page.locator("#workspace-tools")).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "New metadata field", exact: true })
    ).toHaveCount(0)
    await expect(
      page.locator('a[href^="/metadata/workspace/"]').first()
    ).toBeVisible()
    await page.goto(`${people}#invitations`)
    await expect(outline(page)).toHaveCount(0)
    await expect(page.locator("#access-requests")).toHaveCount(0)
    await expect(page.locator("#invitations")).toHaveCount(0)
    await expect(page.locator("#join-link")).toHaveCount(0)
    record(
      "Member navigation cannot reveal management sections; disabled creation tools preserve existing metadata drafts"
    )

    const emptyContext = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    })
    await signInAs(emptyContext, base, emptyFixture.userId)
    await guard(emptyContext)
    const emptyPage = await emptyContext.newPage()
    observe(emptyPage)
    await emptyPage.goto(
      `${base}/communities/${emptyFixture.communitySlug}?view=work`
    )
    await expect(outline(emptyPage)).toHaveCount(0)
    await expect(
      emptyPage.getByRole("heading", { name: "My term drafts", exact: true })
    ).toBeVisible()
    measurements.empty = await emptyPage.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      viewport: innerHeight,
      draftHeadingY:
        document.getElementById("term-drafts")!.getBoundingClientRect().top +
        scrollY
    }))
    await capture(emptyPage, "empty-work-desktop")
    await db.insert(vocabularyWorkspaceSettingsTable).values({
      vocabularySlug: emptyFixture.vocabularySlug,
      metadataEnabled: true,
      matcoreEnabled: false,
      updatedById: emptyFixture.userId
    })
    await emptyPage.reload()
    await expect(outline(emptyPage)).toBeVisible()
    const emptyMetadataTop = await emptyPage
      .locator("#my-field-drafts")
      .evaluate((node) => node.getBoundingClientRect().top + scrollY)
    measurements.emptyMetadataTop = emptyMetadataTop
    assert.ok(
      emptyMetadataTop < 720,
      "Compact empty term state keeps metadata work in the first desktop screen"
    )
    await capture(emptyPage, "empty-metadata-work-desktop")
    const anonymous = await browser.newContext({
      viewport: { width: 390, height: 844 }
    })
    await guard(anonymous)
    const visitor = await anonymous.newPage()
    observe(visitor)
    await visitor.goto(work)
    await expect(outline(visitor)).toHaveCount(0)
    await expect(
      visitor.getByRole("link", { name: "Sign in", exact: true })
    ).toBeVisible()
    await expect(visitor.getByText(termName, { exact: true })).toHaveCount(0)
    await visitor.goto(`${people}#invitations`)
    await expect(outline(visitor)).toHaveCount(0)
    await expect(visitor.locator("#access-requests")).toHaveCount(0)
    await expect(visitor.locator("#invitations")).toHaveCount(0)
    record(
      "Empty and signed-out views omit unnecessary outlines and expose no private work"
    )
    assert.deepEqual(
      blocked,
      [],
      "No provider, external or unrelated write requests"
    )
    assert.deepEqual(errors, [], "No unexpected browser errors")
  } catch (error) {
    failure = error
    if (observedPage && !observedPage.isClosed()) {
      measurements.failureURL = observedPage.url()
      await observedPage
        .screenshot({
          path: resolve(output, "failure.png"),
          fullPage: true,
          animations: "disabled"
        })
        .catch(() => {})
    }
  } finally {
    heldTermSave?.release()
    if (browser) await closeBrowserAfterRoutes(browser)
    try {
      const fixture = fixtures[0]
      if (fixture) {
        await db.transaction(async (tx) => {
          if (fieldIds.length) {
            const drafts = await tx
              .select()
              .from(matcoreSpecDraftsTable)
              .where(inArray(matcoreSpecDraftsTable.fieldId, fieldIds))
            assert.ok(
              drafts.every(
                (row) =>
                  row.ownerId === fixture.userId &&
                  fieldDraftIds.includes(row.id)
              )
            )
            const fields = await tx
              .select()
              .from(matcoreFieldsTable)
              .where(inArray(matcoreFieldsTable.id, fieldIds))
            assert.ok(
              fields.every(
                (row) =>
                  row.createdById === fixture.userId &&
                  row.vocabularySlug === fixture.vocabularySlug
              )
            )
            const events = await tx
              .select()
              .from(matcoreWorkflowEventsTable)
              .where(inArray(matcoreWorkflowEventsTable.fieldId, fieldIds))
            assert.ok(events.every((row) => row.actorId === fixture.userId))
            await tx
              .delete(matcoreWorkflowEventsTable)
              .where(inArray(matcoreWorkflowEventsTable.fieldId, fieldIds))
            await tx
              .delete(matcoreSpecDraftsTable)
              .where(inArray(matcoreSpecDraftsTable.fieldId, fieldIds))
            await tx
              .delete(matcoreFieldsTable)
              .where(inArray(matcoreFieldsTable.id, fieldIds))
          }
          const batches = await tx
            .select()
            .from(importBatchesTable)
            .where(eq(importBatchesTable.id, batchId))
          assert.ok(
            batches.every(
              (row) =>
                row.ownerId === fixture.userId &&
                row.vocabularySlug === fixture.vocabularySlug
            )
          )
          await tx
            .delete(importBatchesTable)
            .where(
              and(
                eq(importBatchesTable.id, batchId),
                eq(importBatchesTable.ownerId, fixture.userId)
              )
            )
          await tx
            .delete(vocabularyWorkspaceSettingsTable)
            .where(
              eq(
                vocabularyWorkspaceSettingsTable.vocabularySlug,
                fixture.vocabularySlug
              )
            )
        })
      }
      for (const fixture of fixtures) {
        await db
          .delete(vocabularyWorkspaceSettingsTable)
          .where(
            eq(
              vocabularyWorkspaceSettingsTable.vocabularySlug,
              fixture.vocabularySlug
            )
          )
        await removeGuidedSetupFixture(fixture)
      }
      retainedAfter = await retainedMetadata()
      assert.deepEqual(
        retainedAfter,
        retainedBefore,
        "Retained metadata drafts, fields, revisions and provenance must remain byte-for-byte unchanged"
      )
      cleaned = true
    } catch (error) {
      cleanupFailure = error
    }
    await mkdir(output, { recursive: true })
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          passed,
          blocked,
          errors,
          expectedFailures,
          mutations,
          measurements,
          cleaned,
          retainedBefore,
          retainedAfter,
          failure: failure instanceof Error ? failure.stack : (failure ?? null),
          cleanupFailure:
            cleanupFailure instanceof Error
              ? cleanupFailure.stack
              : (cleanupFailure ?? null)
        },
        null,
        2
      )
    )
  }
  if (failure) throw failure
  if (cleanupFailure) throw cleanupFailure
  console.log(`Community section UI evidence: ${output}`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
