// The flow under test is: a community's versioned source catalog -> a single
// private proposal -> save, reload and return to the unchanged source entry.
// Browser plugin not available: use the repository's bounded Playwright harness.
// Every write is confined to UUID-owned local fixtures; providers and publishing
// are blocked, and every retained public-table row is fingerprinted after cleanup.
import "dotenv/config"
import "next/dist/server/node-environment"
import {
  installSyntheticUiSource,
  removeSyntheticUiSource
} from "./fixtures/matcore-source-db-fixture"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  expect as baseExpect,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test"
import { and, eq, inArray, sql } from "drizzle-orm"
import {
  db,
  communityMembersTable,
  matcoreFieldsTable,
  matcoreSourceOccurrencesTable,
  matcoreSourceReleasesTable,
  matcoreSpecDraftsTable,
  matcoreSpecRevisionsTable,
  matcoreWorkflowEventsTable,
  vocabularyWorkspaceSettingsTable
} from "../drizzle"
import type { MatcoreDraftPayload } from "../lib/matcore-workflow-types"
import {
  MATCORE_STANDARD_MANIFEST,
  MATCORE_FIXTURE_VERSION
} from "./fixtures/matcore-source-fixture"
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

async function fingerprints() {
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `)
  const result: Record<string, { count: number; md5: string }> = {}
  for (const { table_name } of tables.rows) {
    const rows = await db.execute<{ count: number; md5: string }>(sql`
      select count(*)::int as count,
        md5(coalesce(string_agg(to_jsonb(t)::text, E'\n'
          order by to_jsonb(t)::text), '')) as md5
      from ${sql.identifier(table_name)} as t
    `)
    result[table_name] = rows.rows[0]
  }
  return result
}

type SourceCatalog = {
  selectedRelease: { id: string; version: string }
  occurrences: Array<{
    id: string
    profileKey: string
    baseline: MatcoreDraftPayload
  }>
}

async function readProcedure<T>(
  context: BrowserContext,
  base: string,
  name: string,
  input: Record<string, unknown>
) {
  const query = new URLSearchParams({
    batch: "1",
    input: JSON.stringify({ 0: input })
  })
  const response = await context.request.get(
    `${base}/api/trpc/matcoreWorkflow.${name}?${query}`
  )
  assert.equal(response.status(), 200)
  const body = (await response.json()) as Array<{ result?: { data: T } }>
  assert.ok(body[0]?.result, `The read-only ${name} query succeeded`)
  return body[0].result.data
}

async function main() {
  const base = localPreviewBase()
  const origin = new URL(base).origin
  const output = resolve(
    process.env.SAM_UI_TEST_OUTPUT_DIR ??
      `${tmpdir()}/matsci-matcore-catalog-${randomUUID()}`
  )
  const retainedBefore = await fingerprints()
  const fixtures: GuidedSetupFixture[] = []
  const passed: string[] = []
  const blocked: string[] = []
  const errors: string[] = []
  const expectedFailures: string[] = []
  const allowed404s = new Set<string>()
  const mutations: Array<{ path: string; id?: string; ownerId: number }> = []
  const draftOwners = new Map<string, number>()
  const createdFieldIds = new Set<string>()
  const observedPages = new WeakSet<Page>()
  const measurements: Record<string, unknown> = {}
  let browser: Browser | undefined
  let observedPage: Page | undefined
  let occurrenceId = ""
  let releaseId = ""
  let failure: unknown
  let cleanupFailure: unknown
  let syntheticSourceCreated = false
  let sourceInstalled = false
  let cleaned = false
  let retainedAfter: Awaited<ReturnType<typeof fingerprints>> | undefined
  const record = (name: string) => {
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  const observe = (page: Page) => {
    observedPage = page
    if (observedPages.has(page)) return
    observedPages.add(page)
    page.setDefaultNavigationTimeout(90000)
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() !== "error") return
      if (/404/.test(message.text()) && allowed404s.has(message.location().url))
        expectedFailures.push(message.text())
      else errors.push(`${message.text()} ${message.location().url}`)
    })
    page.on("dialog", async (dialog) => {
      errors.push(`Unexpected native dialog: ${dialog.message()}`)
      await dialog.dismiss()
    })
  }
  const capture = async (page: Page, name: string) => {
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
      .toBe(true)
    await page.screenshot({
      path: resolve(output, `${name}.png`),
      fullPage: false,
      animations: "disabled"
    })
  }
  const guard = async (context: BrowserContext, ownerId: number | null) => {
    await context.route("**/*", async (route) => {
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
      const input = request.postDataJSON() as Record<
        string,
        {
          id?: string
          vocabularySlug?: string
          releaseId?: string
          occurrenceId?: string
          expectedOwnerId?: number
        }
      >
      const path = paths[0]
      const body = input?.[0]
      const allowed =
        ownerId !== null &&
        paths.length === 1 &&
        ((path === "matcoreWorkflow.startSourceChange" &&
          body?.vocabularySlug === fixtures[0]?.vocabularySlug &&
          body.releaseId === releaseId &&
          body.occurrenceId === occurrenceId &&
          body.expectedOwnerId === ownerId) ||
          (path === "matcoreWorkflow.updateDraft" &&
            draftOwners.get(body?.id ?? "") === ownerId))
      if (!allowed) {
        blocked.push(`${request.method()} ${url.pathname}`)
        return route.abort("blockedbyclient")
      }
      mutations.push({ path, id: body?.id, ownerId })
      const response = await route.fetch({ timeout: 90000 })
      if (path === "matcoreWorkflow.startSourceChange") {
        const results = (await response.json()) as Array<{
          result?: { data: { kind: string; draftId?: string } }
        }>
        const result = results[0]?.result?.data
        if (result?.kind === "draft" && result.draftId)
          draftOwners.set(result.draftId, ownerId)
      }
      return route.fulfill({ response })
    })
  }
  const ownedDrafts = (ownerId: number) =>
    db
      .select()
      .from(matcoreSpecDraftsTable)
      .where(eq(matcoreSpecDraftsTable.ownerId, ownerId))

  try {
    await mkdir(output, { recursive: true })
    const fixture = await createGuidedSetupFixture()
    fixtures.push(fixture)
    const colleague = await createGuidedSetupFixture()
    fixtures.push(colleague)
    await writeFile(
      resolve(output, "fixtures.json"),
      JSON.stringify(fixtures, null, 2)
    )
    syntheticSourceCreated = (await installSyntheticUiSource(fixture)).created
    sourceInstalled = true
    await db.insert(vocabularyWorkspaceSettingsTable).values({
      vocabularySlug: fixture.vocabularySlug,
      metadataEnabled: true,
      matcoreEnabled: true,
      updatedById: fixture.userId
    })
    await db.insert(communityMembersTable).values({
      communityId: fixture.communityId,
      userId: colleague.userId,
      role: "member",
      addedById: fixture.userId
    })
    browser = await launchBrowser()
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 }
    })
    await signInAs(context, base, fixture.userId)
    await rememberView(context, base, "simple")
    await guard(context, fixture.userId)
    const page = await context.newPage()
    observe(page)
    const catalog = await readProcedure<SourceCatalog>(
      context,
      base,
      "sourceCatalog",
      { vocabularySlug: fixture.vocabularySlug, profileKey: "dft", offset: 40 }
    )
    releaseId = catalog.selectedRelease.id
    assert.equal(catalog.selectedRelease.version, MATCORE_FIXTURE_VERSION)
    assert.equal(catalog.occurrences.length, 4)
    const source = catalog.occurrences[0]
    occurrenceId = source.id
    assert.equal(source.profileKey, "dft")
    const catalogParams = new URLSearchParams({
      view: "vocabulary",
      release: releaseId,
      profile: "dft",
      offset: "40"
    })
    const catalogPath = `/communities/${fixture.communitySlug}?${catalogParams}`
    const detailParams = new URLSearchParams(catalogParams)
    detailParams.set("source", occurrenceId)
    const detailPath = `/communities/${fixture.communitySlug}?${detailParams}`
    const sourceRowsBefore = await db
      .select()
      .from(matcoreSourceOccurrencesTable)
      .orderBy(matcoreSourceOccurrencesTable.id)
    const releasesBefore = await db
      .select()
      .from(matcoreSourceReleasesTable)
      .orderBy(matcoreSourceReleasesTable.id)

    await page.goto(`${base}${catalogPath}`)
    await expect(page).toHaveTitle(new RegExp(fixture.communityTitle))
    await expect(
      page.getByRole("heading", { name: "MatCore catalog", exact: true })
    ).toBeVisible()
    await expect(
      page.getByLabel("Source version", { exact: true })
    ).toHaveValue(releaseId)
    await expect(page.getByLabel("Profile", { exact: true })).toHaveValue("dft")
    await expect(
      page.getByRole("link", { name: source.baseline.label, exact: true })
    ).toBeVisible()
    assert.deepEqual(await ownedDrafts(fixture.userId), [])
    await capture(page, "catalog-desktop")
    await page.getByLabel("Profile", { exact: true }).selectOption("minimal")
    await expect(page).toHaveURL(
      `${base}/communities/${fixture.communitySlug}?${new URLSearchParams({ view: "vocabulary", release: releaseId, profile: "minimal" })}`
    )
    await page.getByLabel("Profile", { exact: true }).selectOption("dft")
    await expect(page).toHaveURL(
      `${base}/communities/${fixture.communitySlug}?${new URLSearchParams({ view: "vocabulary", release: releaseId, profile: "dft" })}`
    )
    const pagination = page.getByRole("navigation", {
      name: "MatCore catalog pages",
      exact: true
    })
    await expect(
      pagination.getByRole("button", { name: "Previous", exact: true })
    ).toBeDisabled()
    await pagination.getByRole("button", { name: "Next", exact: true }).click()
    await expect(page).toHaveURL(`${base}${catalogPath}`)
    await expect(
      pagination.getByRole("button", { name: "Next", exact: true })
    ).toBeDisabled()
    record(
      "A fresh member can browse and filter the versioned catalog, paginate DFT entries, and create no private drafts by browsing"
    )

    await page
      .getByRole("link", { name: source.baseline.label, exact: true })
      .click()
    await expect(page).toHaveURL(`${base}${detailPath}`)
    const sourceArticle = page.getByRole("article", {
      name: source.baseline.label,
      exact: true
    })
    await expect(sourceArticle).toBeVisible()
    await expect(
      sourceArticle.getByText(source.baseline.definition, { exact: true })
    ).toBeVisible()
    await expect(sourceArticle.getByRole("textbox")).toHaveCount(0)
    await sourceArticle
      .getByText("Source text and attribution", { exact: true })
      .click()
    await expect(
      sourceArticle.getByText(MATCORE_STANDARD_MANIFEST.release.attribution, {
        exact: true
      })
    ).toBeVisible()
    await expect(
      sourceArticle.getByText(
        `SHA-256: ${MATCORE_STANDARD_MANIFEST.release.sha256}`,
        { exact: true }
      )
    ).toBeVisible()
    await expect(
      sourceArticle.getByRole("link", {
        name: "Read the source specification",
        exact: true
      })
    ).toHaveAttribute("href", "https://example.invalid/synthetic-metadata#dft")
    await capture(page, "source-desktop")
    record(
      "The source entry is read-only and shows its preserved wording, source location, publisher and hash"
    )

    await page
      .getByRole("button", { name: "Propose a change", exact: true })
      .dblclick()
    await expect(page).toHaveURL(/\/metadata\/workspace\/[0-9a-f-]+\?returnTo=/)
    const draftId = new URL(page.url()).pathname.split("/").at(-1)!
    assert.equal(draftOwners.get(draftId), fixture.userId)
    const firstDrafts = await ownedDrafts(fixture.userId)
    assert.equal(firstDrafts.length, 1)
    assert.equal(firstDrafts[0].id, draftId)
    assert.equal(firstDrafts[0].sourceOccurrenceId, occurrenceId)
    assert.equal(firstDrafts[0].profileReleaseId, releaseId)
    assert.deepEqual(firstDrafts[0].payload, source.baseline)
    createdFieldIds.add(firstDrafts[0].fieldId)
    const editorURL = page.url()
    const definition = page.getByRole("textbox", {
      name: "Definition",
      exact: true
    })
    await expect(definition).toHaveValue(source.baseline.definition)
    const editedDefinition = `Local catalog proposal ${fixture.token}: this change belongs only to this contributor.`
    await definition.fill(editedDefinition)
    const returnLink = page.locator(`a[href=${JSON.stringify(detailPath)}]`)
    await expect(returnLink).toHaveCount(1)
    await returnLink.click()
    await expect(page).toHaveURL(`${base}${detailPath}`)
    await expect(
      sourceArticle.getByText(source.baseline.definition, { exact: true })
    ).toBeVisible()
    await expect(page.getByText(editedDefinition, { exact: true })).toHaveCount(
      0
    )
    assert.equal(
      (await ownedDrafts(fixture.userId))[0].payload.definition,
      editedDefinition
    )
    record(
      "Propose a change creates only the selected source draft; immediate return saves edits and leaves the source entry unchanged"
    )

    await page
      .getByRole("link", { name: "Continue my draft", exact: true })
      .click()
    await expect(page).toHaveURL(editorURL)
    await expect(definition).toHaveValue(editedDefinition)
    await page.reload()
    await expect(definition).toHaveValue(editedDefinition)
    await page
      .getByRole("tab", { name: "Sources & history", exact: true })
      .click()
    await expect(
      page.getByText("Preserved source baseline", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText(source.baseline.definition, { exact: true })
    ).toBeVisible()
    const provenance = await db
      .select()
      .from(matcoreWorkflowEventsTable)
      .where(eq(matcoreWorkflowEventsTable.draftId, draftId))
    assert.ok(provenance.some((event) => event.action === "imported"))
    assert.ok(provenance.some((event) => event.action === "saved"))
    assert.ok(provenance.every((event) => event.actorId === fixture.userId))
    const imported = provenance.find((event) => event.action === "imported")!
    assert.equal(
      imported.detail.sourceHash,
      MATCORE_STANDARD_MANIFEST.release.sha256
    )
    assert.equal(
      imported.detail.sourcePublisher,
      MATCORE_STANDARD_MANIFEST.release.attribution
    )
    await returnLink.click()
    await page.reload()
    await page
      .getByRole("link", { name: "Continue my draft", exact: true })
      .click()
    await expect(page).toHaveURL(editorURL)
    await expect(definition).toHaveValue(editedDefinition)
    assert.equal((await ownedDrafts(fixture.userId)).length, 1)
    record(
      "Reload and repeated visits resume the exact edited draft, with preserved source attribution and save history"
    )

    const secondContext = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    })
    await signInAs(secondContext, base, colleague.userId)
    await guard(secondContext, colleague.userId)
    const secondPage = await secondContext.newPage()
    observe(secondPage)
    await secondPage.goto(`${base}${detailPath}`)
    await expect(
      secondPage.getByRole("link", { name: "Continue my draft", exact: true })
    ).toHaveCount(0)
    await expect(
      secondPage.getByText(editedDefinition, { exact: true })
    ).toHaveCount(0)
    await secondPage
      .getByRole("button", { name: "Propose a change", exact: true })
      .click()
    await expect(secondPage).toHaveURL(
      /\/metadata\/workspace\/[0-9a-f-]+\?returnTo=/
    )
    const colleagueDrafts = await ownedDrafts(colleague.userId)
    assert.equal(colleagueDrafts.length, 1)
    assert.notEqual(colleagueDrafts[0].id, draftId)
    assert.equal(colleagueDrafts[0].fieldId, firstDrafts[0].fieldId)
    assert.deepEqual(colleagueDrafts[0].payload, source.baseline)
    await expect(
      secondPage.getByRole("textbox", { name: "Definition", exact: true })
    ).toHaveValue(source.baseline.definition)
    allowed404s.add(editorURL)
    await secondPage.goto(editorURL)
    await expect(
      secondPage.getByRole("textbox", { name: "Definition", exact: true })
    ).toHaveCount(0)
    await expect(
      secondPage.getByText(editedDefinition, { exact: true })
    ).toHaveCount(0)
    await expect(
      secondPage.getByText(/not found|could not/i).first()
    ).toBeVisible()
    record(
      "Two members receive separate private drafts for one source field; another member's direct editor URL cannot expose their writing"
    )

    observe(page)
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto(`${base}${catalogPath}`)
      await expect(
        page.getByLabel("Source version", { exact: true })
      ).toBeVisible()
      await expect(page.getByLabel("Profile", { exact: true })).toBeVisible()
      await expect
        .poll(() =>
          page.getByRole("heading", { level: 1 }).evaluate((heading) => {
            const range = document.createRange()
            range.selectNodeContents(heading)
            return Array.from(range.getClientRects()).every(
              (rect) => rect.left >= -1 && rect.right <= innerWidth + 1
            )
          })
        )
        .toBe(true)
      await capture(page, `catalog-${width}px`)
      await page
        .getByRole("link", { name: source.baseline.label, exact: true })
        .click()
      await expect(page).toHaveURL(`${base}${detailPath}`)
      await capture(page, `source-${width}px`)
      await page
        .getByRole("link", { name: "Continue my draft", exact: true })
        .click()
      await expect(definition).toHaveValue(editedDefinition)
      await capture(page, `proposal-${width}px`)
      await returnLink.click()
      await expect(page).toHaveURL(`${base}${detailPath}`)
      await page
        .getByRole("link", { name: "Back to MatCore catalog", exact: true })
        .click()
      await expect(page).toHaveURL(`${base}${catalogPath}`)
      await expect(page.getByLabel("Profile", { exact: true })).toHaveValue(
        "dft"
      )
    }
    record(
      "390px and 320px catalog, source and editor navigation preserve release, DFT filter and page 2 without horizontal overflow"
    )

    const anonymous = await browser.newContext({
      viewport: { width: 390, height: 844 }
    })
    await guard(anonymous, null)
    const visitor = await anonymous.newPage()
    observe(visitor)
    await visitor.goto(`${base}/communities/${fixture.communitySlug}`)
    await expect(
      visitor.getByText(source.baseline.definition, { exact: true })
    ).toHaveCount(0)
    const privateQuery = new URLSearchParams({
      batch: "1",
      input: JSON.stringify({
        0: { vocabularySlug: fixture.vocabularySlug, releaseId, occurrenceId }
      })
    })
    const denied = await anonymous.request.get(
      `${base}/api/trpc/matcoreWorkflow.sourceEntry?${privateQuery}`
    )
    assert.equal(denied.status(), 404)
    assert.equal(
      (await denied.text()).includes(source.baseline.definition),
      false
    )
    record(
      "Anonymous visitors can see the community name but cannot read its source catalog, draft state or protected definitions"
    )

    observe(page)
    await page.setViewportSize({ width: 1440, height: 1000 })
    for (const [key, value] of [
      ["release", "matcore:missing-release"],
      ["source", "matcore:missing-occurrence"],
      ["profile", "minimal"]
    ]) {
      const params = new URLSearchParams(detailParams)
      params.set(key, value)
      const invalid = `${base}/communities/${fixture.communitySlug}?${params}`
      allowed404s.add(invalid)
      await page.goto(invalid)
      await expect(
        page.getByRole("button", { name: "Propose a change", exact: true })
      ).toHaveCount(0)
      await expect(
        page.getByRole("link", { name: "Continue my draft", exact: true })
      ).toHaveCount(0)
      await expect(
        page.getByRole("textbox", { name: "Definition", exact: true })
      ).toHaveCount(0)
      await expect(
        page.getByText(/not found|unavailable|could not|invalid/i).first()
      ).toBeVisible()
    }
    assert.equal((await ownedDrafts(fixture.userId)).length, 1)
    const forged = new URL(editorURL)
    forged.searchParams.set(
      "returnTo",
      `/communities/${colleague.communitySlug}?${detailParams}`
    )
    await page.goto(forged.href)
    await expect(definition).toHaveValue(editedDefinition)
    await expect(
      page.locator(`a[href^="/communities/${colleague.communitySlug}?"]`)
    ).toHaveCount(0)
    record(
      "Invalid releases, occurrences and mismatched profile or return contexts fail safely without creating or moving drafts"
    )

    await page.goto(`${base}/metadata/matcore#creator`)
    await expect(
      page.getByRole("heading", { name: "MatCore metadata", exact: true })
    ).toBeVisible()
    await expect(
      page.getByText(
        "Preliminary snapshot from the 2025 paper. This is not an official MatCore release.",
        { exact: true }
      )
    ).toBeVisible()
    await expect(page.locator("#creator")).toBeVisible()
    await expect(page.locator("#creator").getByRole("link")).toHaveAttribute(
      "href",
      "#creator"
    )
    measurements.historicalCatalog = await page.locator("#creator").innerText()
    await capture(page, "historical-2025-catalog")
    assert.deepEqual(
      await db
        .select()
        .from(matcoreSourceOccurrencesTable)
        .orderBy(matcoreSourceOccurrencesTable.id),
      sourceRowsBefore,
      "Every preserved source occurrence remains unchanged after editing proposals"
    )
    assert.deepEqual(
      await db
        .select()
        .from(matcoreSourceReleasesTable)
        .orderBy(matcoreSourceReleasesTable.id),
      releasesBefore,
      "Every preserved source release remains unchanged"
    )
    record(
      "The independent 2025 catalog keeps its original creator anchor, and all preserved release and source rows remain unchanged"
    )
    assert.deepEqual(
      blocked,
      [],
      "No provider, external, publication or unrelated writes"
    )
    assert.deepEqual(
      errors,
      [],
      "No unexpected browser errors or framework overlay"
    )
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
    if (browser) await closeBrowserAfterRoutes(browser)
    try {
      const [fixture, colleague] = fixtures
      if (fixture) {
        await db.transaction(async (tx) => {
          const fields = await tx
            .select()
            .from(matcoreFieldsTable)
            .where(
              eq(matcoreFieldsTable.vocabularySlug, fixture.vocabularySlug)
            )
          const ownerIds = fixtures.map((row) => row.userId)
          assert.ok(
            fields.every(
              (row) => ownerIds.includes(row.createdById) && row.termId === null
            )
          )
          const fieldIds = fields.map((row) => row.id)
          for (const id of fieldIds) createdFieldIds.add(id)
          if (fieldIds.length) {
            const drafts = await tx
              .select()
              .from(matcoreSpecDraftsTable)
              .where(inArray(matcoreSpecDraftsTable.fieldId, fieldIds))
            assert.ok(
              drafts.every(
                (row) =>
                  ownerIds.includes(row.ownerId) &&
                  row.sourceOccurrenceId === occurrenceId &&
                  row.publishedRevisionId === null
              )
            )
            const revisions = await tx
              .select()
              .from(matcoreSpecRevisionsTable)
              .where(inArray(matcoreSpecRevisionsTable.fieldId, fieldIds))
            assert.deepEqual(
              revisions,
              [],
              "This suite never publishes a proposal"
            )
            const events = await tx
              .select()
              .from(matcoreWorkflowEventsTable)
              .where(inArray(matcoreWorkflowEventsTable.fieldId, fieldIds))
            assert.ok(
              events.every(
                (row) =>
                  ownerIds.includes(row.actorId) && row.revisionId === null
              )
            )
            await writeFile(
              resolve(output, "cleanup-manifest.json"),
              JSON.stringify(
                {
                  fieldIds,
                  draftIds: drafts.map((row) => row.id),
                  eventIds: events.map((row) => row.id),
                  sourceOccurrencesDeleted: [],
                  sourceReleasesDeleted: []
                },
                null,
                2
              )
            )
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
          await tx
            .delete(vocabularyWorkspaceSettingsTable)
            .where(
              eq(
                vocabularyWorkspaceSettingsTable.vocabularySlug,
                fixture.vocabularySlug
              )
            )
          if (colleague)
            await tx
              .delete(communityMembersTable)
              .where(
                and(
                  eq(communityMembersTable.communityId, fixture.communityId),
                  eq(communityMembersTable.userId, colleague.userId),
                  eq(communityMembersTable.addedById, fixture.userId)
                )
              )
        })
      }
      if (fixtures[0] && sourceInstalled)
        await removeSyntheticUiSource(fixtures[0], syntheticSourceCreated)
      for (const fixture of fixtures) await removeGuidedSetupFixture(fixture)
      retainedAfter = await fingerprints()
      assert.deepEqual(
        retainedAfter,
        retainedBefore,
        "All retained public-table rows, drafts and provenance remain byte-for-byte unchanged"
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
          browserPath:
            "Browser plugin not available; repository Playwright harness",
          passed,
          blocked,
          errors,
          expectedFailures,
          mutations,
          draftIds: [...draftOwners.keys()],
          fieldIds: [...createdFieldIds],
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
  console.log(`MatCore catalog UI evidence: ${output}`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
