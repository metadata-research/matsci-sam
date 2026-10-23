// Native browser -> Next -> isolated database. Import, save, source assignment
// and publication use real HTTP; provider requests and unrelated writes fail.
import "dotenv/config"
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { expect as baseExpect, type Browser } from "@playwright/test"
import { eq, inArray } from "drizzle-orm"
import {
  db,
  importBatchesTable,
  termDraftsTable,
  termsTable,
  contributionFilesTable,
  contributionSourceAssetsTable,
  termMetadataAssertionsTable,
  revisionImportOriginsTable,
  revisionManualCitationsTable
} from "../drizzle"
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
const quote = (text: string) => `"${text.replaceAll('"', '""')}"`

async function main() {
  const base = localPreviewBase()
  const origin = new URL(base).origin
  const fixture = await createGuidedSetupFixture()
  const output = resolve(
    process.env.SAM_UI_TEST_OUTPUT_DIR ??
      `${tmpdir()}/matsci-import-drafts-ui-${fixture.token}`
  )
  await mkdir(output, { recursive: true })
  const a = `solid electrolyte fixture ${fixture.token}`
  const b = `ionic conductivity fixture ${fixture.token}`
  const c = `polymer electrolyte fixture ${fixture.token}`
  const name = `Private import ${fixture.token}`
  const definition =
    "An isolated transport fixture reviewed before publication."
  const importedDefinition = `${definition} This is the selected second version.`
  const edited = `${importedDefinition} The contributor revised this wording in the editor.`
  const sourceTitle = `Shared import note ${fixture.token}`
  const sourceText = `${a} and ${b} are synthetic transport examples used only to test source reuse.`
  const headers = [
    "term",
    "definition",
    "source_title",
    "source_creator",
    "source_url",
    "ontology_iri",
    "ontology_name",
    "ontology_version",
    "ontology_source_url",
    "ontology_note",
    "source_keys",
    "private_extra"
  ]
  const rows = [
    [
      a,
      "A duplicate version that must not be silently selected.",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "private secret"
    ],
    [
      a,
      importedDefinition,
      "Declared source title",
      "Original research group",
      "https://example.org/source",
      "https://example.org/ontology/transport",
      "Example ontology",
      "v1",
      "https://example.org/ontology",
      "Related concept; this test does not assert equivalence.",
      "shared",
      "private secret"
    ],
    [b, definition, "", "", "", "", "", "", "", "", "shared", "private secret"],
    [c, "", "", "", "", "", "", "", "", "", "", "unpublished private secret"]
  ]
  for (const label of [
    "electrolyte",
    "charge-carrier diffusivity",
    "lithium-ion transference number",
    "electrochemical impedance spectroscopy",
    "activation energy of conductivity",
    "space-charge layer",
    "electrochemical stability window",
    "transport efficiency",
    "nernst–einstein relation"
  ])
    rows.push([
      `${label} fixture ${fixture.token}`,
      "",
      ...Array(headers.length - 2).fill("")
    ])
  const input = [
    headers.join(","),
    ...rows.map((row) => row.map(quote).join(","))
  ].join("\n")
  const passed: string[] = []
  const blocked: string[] = []
  const errors: string[] = []
  let browser: Browser | undefined
  let failure: unknown
  let batchId = ""
  let droppedCreate = false
  let dropCreationResponse = true
  const allowedWrites = new Set([
    "importDrafts.preview",
    "importDrafts.create",
    "importDrafts.review",
    "importDrafts.publish",
    "importDrafts.archive",
    "termDrafts.update",
    "sourceDocuments.check"
  ])
  const record = (name: string) => {
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  const drafts = () =>
    db
      .select()
      .from(termDraftsTable)
      .where(eq(termDraftsTable.ownerId, fixture.userId))

  try {
    browser = await launchBrowser()
    const context = await browser.newContext({
      viewport: { width: 1365, height: 1000 }
    })
    await signInAs(context, base, fixture.userId)
    await rememberView(context, base, "simple")
    await context.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? []
      const sourceWrite =
        /^\/api\/contribution-files(?:\/[^/]+\/(?:reuse|source))?$/.test(
          url.pathname
        )
      const forbidden =
        url.origin !== origin ||
        paths.some((path) =>
          /^(aiAssist\.|termReferences\.retrieve|ontologyContext\.)/.test(path)
        ) ||
        (request.method() !== "GET" &&
          !sourceWrite &&
          (!paths.length || paths.some((path) => !allowedWrites.has(path))))
      if (forbidden) {
        blocked.push(`${request.method()} ${url.pathname}`)
        return route.abort("blockedbyclient")
      }
      if (request.method() !== "GET") {
        const response = await route.fetch({ timeout: 60000 })
        if (
          dropCreationResponse &&
          paths.includes("importDrafts.create") &&
          response.ok()
        ) {
          dropCreationResponse = false
          droppedCreate = true
          return route.abort("connectionreset")
        }
        return route.fulfill({ response })
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30000)
    page.setDefaultNavigationTimeout(90000)
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !/ERR_CONNECTION_RESET|ERR_FAILED|Failed to fetch/.test(message.text())
      )
        errors.push(message.text())
    })
    page.on("dialog", async (dialog) => {
      errors.push(`Unexpected dialog: ${dialog.message()}`)
      await dialog.dismiss()
    })
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true })
    const saved = () =>
      page.getByText("Draft saved to your account", { exact: true })
    const openBatch = () =>
      page.goto(`${base}/profile/drafts/imports/${batchId}`)
    await page.goto(
      `${base}/setup?task=import&vocabularySlug=${fixture.vocabularySlug}`
    )
    await button("Continue").click()
    await button("Skip collection").click()
    await page.getByLabel("Terms and definitions", { exact: true }).fill(input)
    const importFile = page.getByLabel("Choose a CSV or TSV file (optional)", {
      exact: true
    })
    await importFile.setInputFiles({
      name: "latin1.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([0x74, 0xe9, 0x72, 0x6d])
    })
    await expect(
      page.getByRole("alert").filter({ hasText: "Unable to continue" })
    ).toContainText("not valid UTF-8")
    await expect(
      page.getByLabel("Terms and definitions", { exact: true })
    ).toHaveValue(input)
    const bomInput = `\uFEFF${input}`
    await importFile.setInputFiles({
      name: "unicode.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(bomInput, "utf8")
    })
    await expect(
      page.getByLabel("Terms and definitions", { exact: true })
    ).toHaveValue(bomInput)
    record(
      "Invalid UTF-8 preserves existing input; a valid Unicode file preserves its byte order mark"
    )
    await button("Preview terms").click()
    await expect(
      page.getByText("Unrecognized columns", { exact: true })
    ).toBeVisible()
    await button("Leave these columns out").click()
    const preview = page.getByRole("region", {
      name: "Preview imported drafts"
    })
    await preview.getByLabel("Import name (optional)").fill(name)
    const rowItems = preview.locator("li")
    await rowItems.nth(1).getByRole("checkbox").check()
    await expect(rowItems.nth(0).getByRole("checkbox")).toBeDisabled()
    await button("Select unambiguous new terms").click()
    await button("Create 12 private drafts").click()
    await expect.poll(() => droppedCreate).toBe(true)
    await expect(
      page.getByRole("alert").filter({ hasText: /retry this request/ })
    ).toBeVisible()
    assert.equal((await drafts()).length, 12)
    assert.equal(
      (
        await db
          .select()
          .from(termsTable)
          .where(eq(termsTable.vocabularySlug, fixture.vocabularySlug))
      ).length,
      0
    )
    await button("Create 12 private drafts").click()
    await page.getByRole("link", { name: "Open import", exact: true }).click()
    await expect(page).toHaveURL((url) =>
      /^\/profile\/drafts\/imports\/[a-f0-9-]+$/.test(url.pathname)
    )
    assert.equal(
      new URL(page.url()).searchParams.get("returnTo"),
      `/communities/${fixture.communitySlug}?view=work#term-imports`
    )
    batchId = new URL(page.url()).pathname.split("/").at(-1)!
    assert.equal((await drafts()).length, 12)
    assert.equal(
      (
        await db
          .select()
          .from(importBatchesTable)
          .where(eq(importBatchesTable.ownerId, fixture.userId))
      ).length,
      1
    )
    record(
      "Unknown columns require consent; duplicate selection is explicit; lost creation response retries the same twelve private drafts"
    )

    await page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: a, exact: true }) })
      .getByRole("link", { name: "Review term", exact: true })
      .click()
    await button("Confirm term").click()
    await expect(
      page.getByRole("checkbox", {
        name: "Include original wording in public provenance",
        exact: true
      })
    ).not.toBeChecked()
    await page
      .getByRole("textbox", { name: "Definition", exact: true })
      .fill(edited)
    await page
      .getByLabel("Origin attribution", { exact: true })
      .selectOption("include")
    await button("Also add as a citation").click()
    await page
      .getByLabel("Review citation 1", { exact: true })
      .selectOption("include")
    await page
      .getByLabel("Review concept 1", { exact: true })
      .selectOption("include")
    await button("Add file or text").click()
    await page.getByRole("tab", { name: "Paste text", exact: true }).click()
    await page.getByLabel("Source text", { exact: true }).fill(sourceText)
    await page.getByLabel("Title", { exact: true }).fill(sourceTitle)
    await button("Attach source").click()
    await expect(
      page
        .getByRole("list", { name: "Attached files" })
        .getByText(sourceTitle, { exact: true })
    ).toBeVisible()
    await button("Check term").click()
    await expect(page.getByText(/Term found · 1 match/)).toBeVisible()
    const fileA = (
      await db
        .select()
        .from(contributionFilesTable)
        .where(eq(contributionFilesTable.uploadedById, fixture.userId))
    )[0]
    assert(fileA)
    await page
      .getByLabel("Source for shared", { exact: true })
      .selectOption(fileA.id)
    await page
      .getByLabel("Review source shared", { exact: true })
      .selectOption("include")
    await button("Review definition").click()
    await page
      .getByRole("checkbox", { name: `Cite "${sourceTitle}"`, exact: true })
      .check()
    await expect(saved()).toBeVisible()
    await page.reload()
    await expect(
      page.getByLabel("Origin attribution", { exact: true })
    ).toHaveValue("include")
    await expect(
      page.getByLabel("Review concept 1", { exact: true })
    ).toHaveValue("include")
    await expect(
      page.getByLabel("Source for shared", { exact: true })
    ).toHaveValue(fileA.id)
    await button("Save and return to import").click()
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `/profile/drafts/imports/${batchId}` &&
        url.searchParams.get("returnTo") ===
          `/communities/${fixture.communitySlug}?view=work#term-imports`
    )
    record(
      "The existing editor saves and reloads declared credit, manual citation, ontology review and attached source mapping"
    )

    await page
      .getByText("Share a source between drafts", { exact: true })
      .click()
    await page.getByLabel("Source", { exact: true }).selectOption(fileA.id)
    await page
      .getByRole("group", { name: "Assign to drafts", exact: true })
      .getByLabel(b, { exact: true })
      .check()
    await button("Assign source to selected drafts").click()
    await expect(
      page.getByText(/Source assigned. Open each draft/)
    ).toBeVisible()
    const allFiles = await db
      .select()
      .from(contributionFilesTable)
      .where(eq(contributionFilesTable.uploadedById, fixture.userId))
    assert.equal(allFiles.length, 2)
    assert.equal(new Set(allFiles.map((file) => file.assetId)).size, 1)
    const fileB = allFiles.find((file) => file.id !== fileA.id)!
    await page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: b, exact: true }) })
      .getByRole("link", { name: "Review term", exact: true })
      .click()
    await button("Confirm term").click()
    await page
      .getByRole("checkbox", {
        name: "Include original wording in public provenance",
        exact: true
      })
      .check()
    await button("Add file or text").click()
    await button("Check term").click()
    await expect(page.getByText(/Term found · 1 match/)).toBeVisible()
    await page
      .getByLabel("Source for shared", { exact: true })
      .selectOption(fileB.id)
    await page
      .getByLabel("Review source shared", { exact: true })
      .selectOption("include")
    await button("Review definition").click()
    await expect(
      page.getByRole("checkbox", { name: `Cite "${sourceTitle}"`, exact: true })
    ).not.toBeChecked()
    await page
      .getByRole("checkbox", { name: `Cite "${sourceTitle}"`, exact: true })
      .check()
    await button("Save and review import").click()
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `/profile/drafts/imports/${batchId}` &&
        Boolean(url.searchParams.get("review"))
    )
    record(
      "One upload is assigned to another draft with separate binding and saved publication choices"
    )

    await page.getByLabel(`Select ${a}`, { exact: true }).check()
    await button("Review selected for publication").click()
    await expect(button("Publish 2 selected terms")).toBeEnabled()
    await expect(
      page.getByRole("region", { name: "Publication review" })
    ).toContainText("proposed for curator review")
    const reviewedA = page
      .getByRole("region", { name: "Publication review" })
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: a, exact: true }) })
    await expect(reviewedA.getByText(edited, { exact: true })).toBeVisible()
    await expect(reviewedA).toContainText(
      "Original wording will be omitted from public provenance."
    )
    const reviewedB = page
      .getByRole("region", { name: "Publication review" })
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: b, exact: true }) })
    await expect(reviewedB).toContainText(
      "Original wording will be included in public provenance."
    )
    const originalWording = reviewedA.locator("details")
    await expect(originalWording).not.toHaveAttribute("open")
    await originalWording
      .getByText("Original imported wording", { exact: true })
      .click()
    await expect(
      originalWording.getByText(importedDefinition, { exact: true })
    ).toBeVisible()
    await expect(originalWording).not.toContainText(edited)
    await expect(originalWording).toContainText("This comparison is private")
    await originalWording
      .getByText("Original imported wording", { exact: true })
      .click()
    await expect(
      page.locator("nextjs-portal").filter({
        hasText: /Build Error|Runtime Error|Unhandled Runtime/
      })
    ).toHaveCount(0)
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
    await page.screenshot({
      path: resolve(output, "import-publication-review.png"),
      fullPage: true,
      caret: "initial"
    })
    await page
      .getByRole("heading", { name: "Review publication", exact: true })
      .evaluate((heading) => heading.scrollIntoView({ block: "start" }))
    await page.screenshot({
      path: resolve(output, "import-publication-review-viewport.png"),
      fullPage: false,
      caret: "initial"
    })
    await button("Publish 2 selected terms").click()
    await expect(
      page.getByText("2 terms published. Remaining drafts are still private.", {
        exact: true
      })
    ).toBeVisible()
    await page.reload()
    const terms = await db
      .select()
      .from(termsTable)
      .where(eq(termsTable.vocabularySlug, fixture.vocabularySlug))
    assert.equal(terms.length, 2)
    assert(terms.every((term) => term.term !== c))
    const finalDrafts = await drafts()
    assert.equal(finalDrafts.filter((draft) => !draft.publishedAt).length, 10)
    assert.equal(finalDrafts.filter((draft) => !!draft.publishedAt).length, 2)
    assert.equal(
      finalDrafts.filter(
        (draft) => !draft.publishedAt && draft.payload?.term === c
      ).length,
      1
    )
    const origins = await db
      .select()
      .from(revisionImportOriginsTable)
      .where(eq(revisionImportOriginsTable.importedById, fixture.userId))
    assert.equal(origins.length, 2)
    const originalA = origins.find(
      (origin) => origin.receipt.originalTerm === a
    )
    assert.equal(originalA?.receipt.originalDefinition, importedDefinition)
    assert.notEqual(originalA?.receipt.originalDefinition, edited)
    assert.equal(originalA?.receipt.publishOriginalWording, false)
    const originalB = origins.find(
      (origin) => origin.receipt.originalTerm === b
    )
    assert.equal(originalB?.receipt.publishOriginalWording, true)
    assert.equal(
      (
        await db
          .select()
          .from(revisionManualCitationsTable)
          .where(eq(revisionManualCitationsTable.assertedById, fixture.userId))
      ).length,
      1
    )
    const metadata = await db
      .select()
      .from(termMetadataAssertionsTable)
      .where(eq(termMetadataAssertionsTable.assertedById, fixture.userId))
    assert.equal(metadata.length, 2)
    assert.deepEqual(metadata.map((item) => item.fieldKey).sort(), [
      "relatedConcept",
      "usageNote"
    ])
    assert(metadata.every((item) => item.status === "proposed"))
    record(
      "Reviewed group publishes atomically with manual citation, import receipts and proposed metadata; ten remaining rows stay private"
    )

    await page.goto(`${base}/profile/drafts`)
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Review import", exact: true })
    ).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await openBatch()
    // Exercise the hydrated mobile page before measuring or capturing it.
    // Playwright's default caret hiding mutates every input's inline style,
    // which can itself cause a hydration mismatch during a fresh navigation.
    await page.getByLabel(`Select ${c}`, { exact: true }).check()
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible()
    await button("Clear selection").click()
    await expect(page.getByText("0 selected", { exact: true })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
      .toBe(true)
    await page.screenshot({
      path: resolve(output, "import-overview-mobile.png"),
      fullPage: true,
      caret: "initial"
    })
    record(
      "My drafts groups the import; the mobile overview has no horizontal overflow"
    )
    assert.deepEqual(blocked, [], "No provider calls or unrelated writes")
    assert.deepEqual(errors, [], "No browser runtime errors")
  } catch (error) {
    failure = error
    const page = browser?.contexts().flatMap((context) => context.pages())[0]
    if (page) {
      await page
        .screenshot({
          path: resolve(output, "failure.png"),
          fullPage: true,
          caret: "initial"
        })
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
    if (browser) await closeBrowserAfterRoutes(browser)
    // Remove only this disposable fixture's additional import relationships,
    // before the existing guarded fixture helper deletes its draft/term/user.
    await db
      .delete(importBatchesTable)
      .where(eq(importBatchesTable.ownerId, fixture.userId))
    await db
      .delete(termDraftsTable)
      .where(eq(termDraftsTable.ownerId, fixture.userId))
    await db
      .delete(termMetadataAssertionsTable)
      .where(eq(termMetadataAssertionsTable.assertedById, fixture.userId))
    await db
      .delete(contributionFilesTable)
      .where(eq(contributionFilesTable.uploadedById, fixture.userId))
    const assets = await db
      .select({ id: contributionSourceAssetsTable.id })
      .from(contributionSourceAssetsTable)
      .where(eq(contributionSourceAssetsTable.ownerId, fixture.userId))
    if (assets.length)
      await db.delete(contributionSourceAssetsTable).where(
        inArray(
          contributionSourceAssetsTable.id,
          assets.map((asset) => asset.id)
        )
      )
    await removeGuidedSetupFixture(fixture)
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          passed,
          blocked,
          errors,
          failure: failure instanceof Error ? failure.stack : (failure ?? null)
        },
        null,
        2
      )
    )
  }
  if (failure) throw failure
  console.log(`Import UI evidence: ${output}`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
