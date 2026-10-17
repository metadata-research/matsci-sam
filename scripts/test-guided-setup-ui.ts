// Real browser -> Next -> database test. Requires an already-running local
// preview connected to the same disposable database as this process.
import "dotenv/config"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  expect as playwrightExpect,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test"
import { eq } from "drizzle-orm"
import { db, termDraftsTable, termsTable } from "../drizzle"
import {
  closeBrowserAfterRoutes,
  launchBrowser,
  localPreviewBase,
  rememberView,
  signInAs
} from "./ui-test-harness"
import {
  createGuidedSetupFixture,
  removeGuidedSetupFixture,
  verifyGuidedSetupPublication
} from "./guided-setup-ui-fixture"

const expect = playwrightExpect.configure({ timeout: 20000 })

async function main() {
  const base = localPreviewBase()
  assert.ok(process.env.SESSION_PASSWORD, "Use the preview's session password")
  const fixture = await createGuidedSetupFixture()
  const output = resolve(
    process.env.SAM_UI_TEST_OUTPUT_DIR ??
      `${tmpdir()}/matsci-guided-setup-ui-${fixture.token}`
  )
  const term = `guided setup test ${fixture.token}`
  const firstDefinition =
    "A temporary term used to verify the guided setup workflow."
  const editedDefinition = `${firstDefinition} This sentence was added in the full editor.`
  const finalDefinition = `${editedDefinition} Reviewed before publication.`
  const example =
    "This test term is used only in an isolated local test database."
  const results: string[] = []
  const errors: string[] = []
  const blocked: string[] = []
  const screenshots: string[] = []
  const requests: string[] = []
  const draftSnapshots: Array<{
    checkpoint: string
    ids: string[]
    examples: Array<string | undefined>
  }> = []
  let originalDraftId = ""
  let browser: Browser | undefined
  let page: Page | undefined
  let draftId = ""
  let publication:
    | Awaited<ReturnType<typeof verifyGuidedSetupPublication>>
    | undefined
  let failure: unknown
  let cleaned = false

  async function context(signedIn: boolean) {
    assert.ok(browser)
    const ctx = await browser.newContext({
      viewport: { width: 1365, height: 1000 }
    })
    if (signedIn) await signInAs(ctx, base, fixture.userId)
    await rememberView(ctx, base, "simple")
    // Never let a browser regression invoke a provider or mutate unrelated data.
    // Draft saves and publication remain real HTTP requests, with real DB writes.
    await ctx.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? []
      const forbiddenProvider = paths.some((path) =>
        /^(aiAssist\.|termReferences\.retrieve|ontologyContext\.)/.test(path)
      )
      const forbiddenWrite =
        request.method() !== "GET" &&
        (paths.length === 0 ||
          paths.some(
            (path) =>
              ![
                "termDrafts.create",
                "termDrafts.update",
                "termDrafts.publish"
              ].includes(path)
          ))
      if (
        url.origin !== new URL(base).origin ||
        forbiddenProvider ||
        forbiddenWrite
      ) {
        blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
        return route.abort("blockedbyclient")
      }
      if (request.method() !== "GET") {
        requests.push(...paths)
        // Await real writes so unrouteAll(wait) can drain them before cleanup.
        const response = await route.fetch({ timeout: 30000 })
        return route.fulfill({ response })
      }
      return route.continue()
    })
    return ctx
  }

  async function open(ctx: BrowserContext) {
    const next = await ctx.newPage()
    next.setDefaultTimeout(20000)
    next.setDefaultNavigationTimeout(60000)
    next.on("pageerror", (error) => errors.push(error.message))
    next.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    next.on("response", (response) => {
      if (response.status() >= 500)
        errors.push(
          `HTTP ${response.status()} ${new URL(response.url()).pathname}`
        )
    })
    next.on("dialog", async (dialog) => {
      errors.push(`Unexpected ${dialog.type()} dialog`)
      await dialog.dismiss()
    })
    return next
  }

  async function step(name: string, action: () => Promise<void>) {
    await action()
    results.push(name)
    console.log(`PASS ${name}`)
  }
  async function screenshot(name: string) {
    assert.ok(page)
    await expect
      .poll(() =>
        page!.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      .toBe(true)
    await expect(page.locator("nextjs-portal")).not.toContainText(
      /Build Error|Runtime Error|Unhandled Runtime/
    )
    await page.screenshot({
      path: resolve(output, `${name}.png`),
      fullPage: true,
      animations: "disabled"
    })
    screenshots.push(`${name}.png`)
  }
  async function noPublishedTerm() {
    assert.deepEqual(
      await db
        .select({ id: termsTable.id })
        .from(termsTable)
        .where(eq(termsTable.vocabularySlug, fixture.vocabularySlug)),
      []
    )
  }
  async function oneDraft(checkpoint: string, expectedExample?: string) {
    const drafts = await db
      .select()
      .from(termDraftsTable)
      .where(eq(termDraftsTable.ownerId, fixture.userId))
    draftSnapshots.push({
      checkpoint,
      ids: drafts.map((draft) => draft.id),
      examples: drafts.map((draft) => draft.payload?.initialExample)
    })
    assert.equal(
      drafts.length,
      1,
      `${checkpoint}: one draft for the entire journey`
    )
    originalDraftId ||= drafts[0].id
    assert.equal(drafts[0].id, originalDraftId, `${checkpoint}: same draft ID`)
    assert.equal(drafts[0].payload?.vocabularySlug, fixture.vocabularySlug)
    assert.equal(drafts[0].payload?.collectionId, fixture.collectionId)
    if (expectedExample !== undefined)
      assert.equal(
        drafts[0].payload?.initialExample,
        expectedExample,
        `${checkpoint}: saved example is preserved`
      )
  }
  async function saved() {
    await expect(
      page!.getByText("Draft saved to your account", { exact: true })
    ).toBeVisible()
  }
  const button = (name: string) =>
    page!.getByRole("button", { name, exact: true })
  const heading = (name: string) =>
    page!.getByRole("heading", { name, exact: true })
  const field = (name: string) =>
    page!.getByRole("textbox", { name, exact: true })

  try {
    await mkdir(output, { recursive: true })
    browser = await launchBrowser()
    const anonymous = await context(false)
    page = await open(anonymous)
    await step("Signed-out visitors see the sign-in gate", async () => {
      await page!.goto(`${base}/setup`, { waitUntil: "domcontentloaded" })
      await expect(page!).toHaveTitle(/Quick start & guided setup/)
      await expect(
        page!.getByText("Sign in to get started", { exact: true })
      ).toBeVisible()
      await expect(
        page!.getByRole("link", { name: "Sign in to continue" })
      ).toHaveAttribute("href", /returnTo=/)
      await expect(page!.getByLabel("Existing community")).toHaveCount(0)
    })
    await anonymous.close()
    const firstContext = await context(true)
    page = await open(firstContext)
    const start = `${base}/setup?communityId=${fixture.communityId}&vocabularySlug=${fixture.vocabularySlug}`
    await step(
      "Community and vocabulary selections follow the five-step guide",
      async () => {
        await page!.goto(start, { waitUntil: "domcontentloaded" })
        await expect(heading("Choose a community")).toBeVisible()
        await expect(
          page!
            .getByRole("navigation", { name: "Setup progress" })
            .getByRole("button", { name: "Review", exact: true })
        ).toBeDisabled()
        await page!
          .getByLabel("Existing community", { exact: true })
          .selectOption("")
        await page!
          .getByLabel("Existing community", { exact: true })
          .selectOption(String(fixture.communityId))
        await screenshot("01-community-desktop")
        await button("Continue").click()
        await expect(heading("Choose a vocabulary")).toBeFocused()
        await expect(page!.getByLabel("Vocabulary for your terms")).toHaveValue(
          fixture.vocabularySlug
        )
        await button("Continue").click()
        await expect(heading("Choose a collection")).toBeVisible()
      }
    )
    await step(
      "Collection is optional; Back preserves the selected destination",
      async () => {
        await button("Skip collection").click()
        await expect(heading("Add your terms")).toBeVisible()
        await button("Back").click()
        await page!
          .getByLabel("Group these terms in a collection")
          .selectOption(String(fixture.collectionId))
        await button("Use collection").click()
        await expect(
          page!.getByText(
            `New definitions will be published in ${fixture.vocabularyTitle} and grouped in ${fixture.collectionTitle}.`,
            { exact: true }
          )
        ).toBeVisible()
      }
    )
    await step(
      "Incomplete input cannot advance to review or publish a term",
      async () => {
        await button("Review term").click()
        await expect(field("Term")).toBeFocused()
        await expect(heading("Add your terms")).toBeVisible()
        await field("Term").fill(term)
        await button("Review term").click()
        await expect(field("First definition")).toBeFocused()
        await noPublishedTerm()
      }
    )
    await step(
      "Back navigation flushes typing; reload restores the account draft",
      async () => {
        await field("First definition").fill(firstDefinition)
        await button("Back").click()
        await expect(heading("Choose a collection")).toBeVisible()
        await oneDraft("Immediate Back after first save")
        await expect(
          page!.getByLabel("Group these terms in a collection")
        ).toHaveValue(String(fixture.collectionId))
        await button("Use collection").click()
        await expect(field("First definition")).toHaveValue(firstDefinition)
        await saved()
        await oneDraft("Return to Terms")
        await page!.reload({ waitUntil: "domcontentloaded" })
        await expect(field("Term")).toHaveValue(term)
        await expect(field("First definition")).toHaveValue(firstDefinition)
        await saved()
        await oneDraft("Reload setup")
        await page!.setViewportSize({ width: 390, height: 844 })
        await screenshot("02-terms-mobile")
        await page!.setViewportSize({ width: 1365, height: 1000 })
      }
    )
    let fullEditorUrl = ""
    await step(
      "The full editor and guided setup share writing and examples",
      async () => {
        await button("Open the full term editor").click()
        await expect(page!).toHaveURL(/\/add\?.*draftId=/)
        fullEditorUrl = page!.url()
        draftId = new URL(fullEditorUrl).searchParams.get("draftId") ?? ""
        assert.match(draftId, /^[0-9a-f-]{36}$/)
        assert.equal(draftId, originalDraftId)
        await expect(field("Term")).toHaveValue(term)
        await button("Confirm term").click()
        await expect(field("Definition")).toHaveValue(firstDefinition)
        await field("Definition").fill(editedDefinition)
        await button("Add an example").click()
        await field("Example of use (optional)").fill(example)
        await button("Return to guided setup").click()
        await expect(field("First definition")).toHaveValue(editedDefinition)
        await saved()
        await oneDraft("Return from full editor", example)
        await page!
          .getByRole("link", { name: "My drafts", exact: true })
          .click()
        await expect(page!).toHaveURL(`${base}/profile/drafts`)
        await expect(heading(term)).toBeVisible()
        await expect(
          page!.getByRole("link", { name: `Resume ${term}`, exact: true })
        ).toHaveAttribute("href", `/add?draftId=${draftId}`)
      }
    )
    await firstContext.close()
    const secondContext = await context(true)
    page = await open(secondContext)
    await step(
      "A fresh browser context resumes the same draft without local storage",
      async () => {
        await page!.goto(`${base}/profile/drafts`, {
          waitUntil: "domcontentloaded"
        })
        await page!
          .getByRole("link", { name: `Resume ${term}`, exact: true })
          .click()
        await expect(field("Definition")).toHaveValue(editedDefinition)
        await expect(field("Example of use (optional)")).toHaveValue(example)
        await saved()
        await oneDraft("Resume in a fresh browser context", example)
        await page!.reload({ waitUntil: "domcontentloaded" })
        await expect(field("Definition")).toHaveValue(editedDefinition)
        await expect(field("Example of use (optional)")).toHaveValue(example)
        await saved()
        await oneDraft("Reload the full editor", example)
        // Revisit the actual full-editor handoff URL, as a saved link would.
        await page!.goto(fullEditorUrl, { waitUntil: "domcontentloaded" })
        await expect(field("Definition")).toHaveValue(editedDefinition)
        await button("Return to guided setup").click()
        await expect(field("First definition")).toHaveValue(editedDefinition)
        await saved()
        await oneDraft("Return to setup in a fresh context", example)
      }
    )
    await step(
      "Review is explicit; breadcrumb edits are reflected before publication",
      async () => {
        await button("Review term").click()
        await expect(heading("Review your contribution")).toBeVisible()
        await expect(page!.getByText(example, { exact: true })).toBeVisible()
        await saved()
        await oneDraft("Initial review", example)
        await noPublishedTerm()
        await page!
          .getByRole("navigation", { name: "Setup progress" })
          .getByRole("button", { name: "Terms", exact: true })
          .click()
        await field("First definition").fill(finalDefinition)
        await button("Review term").click()
        await expect(heading("Review your contribution")).toBeVisible()
        await expect(
          page!.getByText(finalDefinition, { exact: true })
        ).toBeVisible()
        await saved()
        await oneDraft("Review after breadcrumb edits", example)
        await screenshot("03-review-desktop")
        await page!.setViewportSize({ width: 390, height: 844 })
        await screenshot("04-review-mobile")
        await noPublishedTerm()
      }
    )
    await step(
      "Publishing creates one term, revision and collection membership",
      async () => {
        await button("Publish new term").click()
        await expect(heading("Term published")).toBeVisible()
        publication = await verifyGuidedSetupPublication(
          fixture,
          term,
          finalDefinition
        )
        const receiptLink = page!.getByRole("link", {
          name: "Open term",
          exact: true
        })
        await expect(receiptLink).toHaveAttribute(
          "href",
          publication.definitionPath
        )
        await screenshot("05-published-mobile")
        await receiptLink.click()
        await expect(page!).toHaveURL(`${base}${publication.definitionPath}`)
        await expect(
          page!.getByText(finalDefinition, { exact: true }).first()
        ).toBeVisible()
        await expect(
          page!.getByText(example, { exact: true }).first()
        ).toBeVisible()
      }
    )
    await step(
      "Published drafts leave My drafts; reopening cannot publish again",
      async () => {
        await page!.goto(`${base}/profile/drafts`, {
          waitUntil: "domcontentloaded"
        })
        await expect(
          page!.getByText("No saved drafts yet.", { exact: true })
        ).toBeVisible()
        await page!.goto(`${base}/add?draftId=${draftId}`, {
          waitUntil: "domcontentloaded"
        })
        await expect(
          page!.getByText("This draft has already been published.", {
            exact: true
          })
        ).toBeVisible()
        await expect(button("Publish new term")).toHaveCount(0)
        const [draft] = await db
          .select()
          .from(termDraftsTable)
          .where(eq(termDraftsTable.id, draftId))
        assert.equal(draft.payload, null)
        assert.equal(draft.publishedDefinitionId, publication!.definitionId)
        await verifyGuidedSetupPublication(fixture, term, finalDefinition)
        assert.equal(
          requests.filter((path) => path === "termDrafts.publish").length,
          1
        )
        assert.deepEqual(
          blocked,
          [],
          "No blocked provider or unrelated mutation requests"
        )
        assert.deepEqual(errors, [], "No browser, server or console errors")
      }
    )
  } catch (error) {
    failure = error
    if (page && !page.isClosed()) {
      await page
        .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
        .catch(() => {})
      await writeFile(
        resolve(output, "failure.txt"),
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).catch(() => {})
    }
  } finally {
    try {
      if (browser) await closeBrowserAfterRoutes(browser)
    } catch (error) {
      failure ??= error
      errors.push(`Browser cleanup: ${String(error)}`)
    } finally {
      try {
        await removeGuidedSetupFixture(fixture)
        cleaned = true
      } catch (error) {
        failure ??= error
        errors.push(`Fixture cleanup: ${String(error)}`)
      }
      await mkdir(output, { recursive: true })
      await writeFile(
        resolve(output, "results.json"),
        JSON.stringify(
          {
            passed: !failure,
            base,
            viewports: [1365, 390],
            results,
            screenshots,
            term,
            fixture,
            draftId,
            draftSnapshots,
            publication,
            errors,
            blocked,
            cleaned,
            failure:
              failure instanceof Error
                ? failure.message
                : failure
                  ? String(failure)
                  : null
          },
          null,
          2
        )
      )
    }
  }
  console.log(`Evidence: ${output}`)
  if (failure) throw failure
  console.log("Guided setup UI test passed; temporary data removed.")
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$client.end())
