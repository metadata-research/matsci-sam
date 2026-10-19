// Real browser, account drafts, uploaded text, conflicts and publication on a
// disposable local database. No model or reference provider is called.
// Run with --conditions=react-server and a bounded preview + source worker.
import "dotenv/config"
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  expect as baseExpect,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test"
import { eq } from "drizzle-orm"
import {
  contributionFilesTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  termDraftsTable,
  termsTable
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
const deferred = () => {
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { wait, release }
}
type Mutation = {
  path: string
  input: Record<string, unknown>
  at: string
}
type Fault = "conflict" | "offline" | "dropped-response" | null
type HeldResponse = ReturnType<typeof deferred> & {
  reached: boolean
  action: "hold" | "drop"
}

async function main() {
  const base = localPreviewBase()
  const origin = new URL(base).origin
  const fixture = await createGuidedSetupFixture()
  const term = `draft resilience ${fixture.token}`
  const sourceTitle = `Resilience source ${fixture.token}`
  const sourceText = `${term} is a synthetic reference coupon for checking saved drafts.`
  const initialWriting =
    "A reference coupon used to test private draft recovery."
  const tabAWriting = "Tab A saved this definition before the other tab."
  const tabBWriting = "Tab B has unsaved writing that must survive a conflict."
  const resumedWriting = "The recovered draft can be edited and saved again."
  const offlineWriting = "Writing added offline must survive reconnecting."
  const output = resolve(
    process.env.SAM_UI_TEST_OUTPUT_DIR ??
      `${tmpdir()}/matsci-draft-resilience-${fixture.token}`
  )
  const passed: string[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const blocked: string[] = []
  const expectedErrors: Array<{ fault: Fault; text: string; url: string }> = []
  const mutations: Mutation[] = []
  const responses: Array<{ path: string; status: number }> = []
  const requestFailures: Array<{ path: string; fault: Fault; error: string }> =
    []
  const navigations: Array<{ page: number; path: string }> = []
  const receipts: Record<string, unknown> = {}
  const draftIds = new Set<string>()
  const fileIds = new Set<string>()
  const holds: HeldResponse[] = []
  let fault: Fault = null
  let browser: Browser | undefined
  let context: BrowserContext | undefined
  let page: Page | undefined
  let failure: unknown
  let cleaned = false
  let uploadCount = 0
  let saveResponse: HeldResponse | null = null
  let destinationResponse: HeldResponse | null = null
  let publishResponse: HeldResponse | null = null
  let destinationRequests = 0
  let interruptNextSaveOffline = false
  let saveInterruptedOffline = false
  let pageCount = 0
  let draftUrl = ""

  const hold = (action: HeldResponse["action"] = "hold") => {
    const control = { ...deferred(), reached: false, action }
    holds.push(control)
    return control
  }
  const button = (name: string) =>
    page!.getByRole("button", { name, exact: true })
  const citation = () =>
    page!
      .getByRole("region", { name: "Review attached files" })
      .getByRole("checkbox")
  const writing = () =>
    page!.getByRole("textbox", { name: "Definition", exact: true })
  const savedLabel = () =>
    page!.getByText("Draft saved to your account", { exact: true })
  const saveAlert = () =>
    page!
      .getByRole("link", { name: "My drafts", exact: true })
      .locator("..")
      .getByRole("alert")
  const allDrafts = () =>
    db
      .select()
      .from(termDraftsTable)
      .where(eq(termDraftsTable.ownerId, fixture.userId))
  const savedDraft = async () => {
    const rows = await allDrafts()
    assert.equal(rows.length, 1, "The journey owns exactly one draft")
    assert(draftIds.has(rows[0].id))
    return rows[0]
  }
  const settled = async (
    definition: string,
    cited: boolean,
    step: "write" | "review" = "review"
  ) => {
    await expect(savedLabel()).toBeVisible()
    await expect
      .poll(async () => {
        const row = await savedDraft()
        return {
          definition: row.payload?.definition,
          cited: row.payload?.files[0]?.publish,
          step: row.payload?.editorState?.step
        }
      })
      .toEqual({ definition, cited, step })
    await expect(savedLabel()).toBeVisible()
    return savedDraft()
  }
  const screenshot = async (name: string) => {
    await expect
      .poll(() =>
        page!.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      .toBe(true)
    await page!.screenshot({
      path: resolve(output, `${name}.png`),
      fullPage: true,
      animations: "disabled"
    })
  }
  const step = async (name: string, action: () => Promise<void>) => {
    await action()
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  const newPage = async () => {
    const next = await context!.newPage()
    const id = ++pageCount
    next.setDefaultTimeout(30000)
    next.on("pageerror", (error) => errors.push(error.message))
    next.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text())
      if (message.type() !== "error") return
      const url = message.location().url
      const isUpdate = url.includes("/api/trpc/termDrafts.update")
      const expected =
        isUpdate &&
        ((fault === "conflict" && /status of 409/.test(message.text())) ||
          ((fault === "offline" || fault === "dropped-response") &&
            /Failed to load resource: net::ERR_/.test(message.text())))
      if (expected) expectedErrors.push({ fault, text: message.text(), url })
      else errors.push(message.text())
    })
    next.on("framenavigated", (frame) => {
      if (frame === next.mainFrame())
        navigations.push({ page: id, path: new URL(frame.url()).pathname })
    })
    return next
  }
  const confirmReload = async (accept: boolean) => {
    const dialog = page!.waitForEvent("dialog")
    const clicked = button("Reload saved draft").click()
    const prompt = await dialog
    assert.equal(prompt.type(), "confirm")
    assert.match(prompt.message(), /Unsaved writing.*replaced/)
    if (accept) await prompt.accept()
    else await prompt.dismiss()
    await clicked
  }

  try {
    await mkdir(output, { recursive: true })
    browser = await launchBrowser()
    context = await browser.newContext({
      viewport: { width: 1365, height: 1000 }
    })
    await signInAs(context, base, fixture.userId)
    await rememberView(context, base, "simple")
    context.on("response", (response) => {
      const path = new URL(response.url()).pathname
      if (path.startsWith("/api/trpc/termDrafts."))
        responses.push({ path, status: response.status() })
    })
    context.on("requestfailed", (request) => {
      const path = new URL(request.url()).pathname
      const error = request.failure()?.errorText ?? "Unknown network error"
      requestFailures.push({ path, fault, error })
      if (path === "/api/trpc/termDrafts.update" && !fault)
        errors.push(`Unexpected save network failure: ${error}`)
    })
    await context.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? []
      try {
        assert.equal(url.origin, origin, "No external browser requests")
        assert(
          !paths.some((path) =>
            /^(aiAssist\.|termReferences\.|ontologyContext\.|agentOne\.)/.test(
              path
            )
          ),
          "No model or reference provider calls"
        )
        if (request.method() === "GET") {
          if (url.pathname === "/profile/drafts") {
            // Count actual navigations, not optional Next prefetches.
            if (request.headers()["next-router-prefetch"] !== "1") {
              destinationRequests += 1
              const control = destinationResponse
              if (control) {
                destinationResponse = null
                const response = await route.fetch({ timeout: 30000 })
                control.reached = true
                await control.wait
                return route.fulfill({ response })
              }
            }
          }
          return route.continue()
        }
        assert.equal(request.method(), "POST", "Only fixture POSTs are allowed")
        if (url.pathname === "/api/contribution-files") {
          assert.equal(uploadCount, 0, "Only one owned source is uploaded")
          const boundary = request
            .headers()
            ["content-type"]?.match(/boundary=(?:"([^"]+)"|([^;]+))/)
          assert(boundary)
          const parts = request
            .postDataBuffer()!
            .toString("utf8")
            .split(`--${boundary[1] ?? boundary[2]}`)
          const metadataPart = parts.find((part) =>
            /name="metadata"/.test(part)
          )
          assert(metadataPart)
          const metadata = JSON.parse(metadataPart.split("\r\n\r\n")[1].trim())
          assert.equal(metadata.term, term)
          assert.equal(metadata.vocabularySlug, fixture.vocabularySlug)
          assert.equal(metadata.origin, "paste")
          assert.equal(metadata.title, sourceTitle)
          assert.equal(metadata.filename, "pasted-source.txt")
          uploadCount += 1
          const response = await route.fetch({ timeout: 30000 })
          assert.equal(response.status(), 201)
          const uploaded = await response.json()
          assert.equal(typeof uploaded.id, "string")
          fileIds.add(uploaded.id)
          return route.fulfill({ response })
        }
        assert.equal(
          paths.length,
          1,
          "Only a single fixture mutation per request"
        )
        const path = paths[0]
        assert(
          [
            "termDrafts.create",
            "termDrafts.update",
            "termDrafts.publish"
          ].includes(path),
          `Unexpected write: ${path}`
        )
        const input = request.postDataJSON()["0"] as Record<string, unknown>
        assert.equal(typeof input.id, "string")
        if (path === "termDrafts.create") {
          assert.equal(input.expectedOwnerId, fixture.userId)
          draftIds.add(input.id as string)
        } else
          assert(
            draftIds.has(input.id as string),
            "Only the owned draft can change"
          )
        if (path !== "termDrafts.publish") {
          const payload = input.payload as {
            term: string
            vocabularySlug: string
            files: Array<{ fileId: string }>
            aiSuggestionId: unknown
            sources: unknown[]
          }
          assert.equal(payload.term, term)
          assert.equal(payload.vocabularySlug, fixture.vocabularySlug)
          assert(payload.files.every((file) => fileIds.has(file.fileId)))
          assert.equal(payload.aiSuggestionId, null)
          assert.equal(payload.sources.length, 0)
        }
        mutations.push({ path, input, at: new Date().toISOString() })
        if (path === "termDrafts.update" && interruptNextSaveOffline) {
          interruptNextSaveOffline = false
          // Interrupt an already dispatched request: setting offline before
          // mutateAsync begins would let TanStack pause it without a failure.
          await context!.setOffline(true)
          saveInterruptedOffline = true
          return route.continue()
        }
        const control =
          path === "termDrafts.update" ? saveResponse : publishResponse
        if (control && path !== "termDrafts.create") {
          if (path === "termDrafts.update") saveResponse = null
          else publishResponse = null
          const response = await route.fetch({ timeout: 30000 })
          assert.equal(response.status(), 200)
          control.reached = true
          if (control.action === "drop") return route.abort("connectionreset")
          await control.wait
          return route.fulfill({ response })
        }
        // Deliberately continue normal traffic through the browser network.
        // route.fetch would bypass browserContext.setOffline(true).
        return route.continue()
      } catch (error) {
        const description = `${request.method()} ${url.pathname}: ${error instanceof Error ? error.message : String(error)}`
        blocked.push(description)
        await route.abort("blockedbyclient")
      }
    })
    page = await newPage()

    await step("A real private draft retains one pasted source", async () => {
      await page!.goto(`${base}/add?vocabularySlug=${fixture.vocabularySlug}`, {
        waitUntil: "networkidle"
      })
      await page!.getByRole("textbox", { name: "Term", exact: true }).fill(term)
      await button("Confirm term").click()
      await writing().fill(initialWriting)
      await button("Add file or text").click()
      const panel = page!.getByRole("region", {
        name: "Add file or text",
        exact: true
      })
      await panel.getByRole("tab", { name: "Paste text" }).click()
      await panel.getByLabel("Source text", { exact: true }).fill(sourceText)
      await panel.getByLabel("Title", { exact: true }).fill(sourceTitle)
      await panel
        .getByRole("button", { name: "Attach source", exact: true })
        .click()
      await expect(
        page!
          .getByRole("region", {
            name: `Source text: ${sourceTitle}`,
            exact: true
          })
          .getByRole("button", { name: "Check term", exact: true })
      ).toBeVisible({ timeout: 90000 })
      await button("Review definition").click()
      await expect(citation()).not.toBeChecked()
      const row = await settled(initialWriting, false)
      draftUrl = `${base}/add?draftId=${row.id}`
      assert.equal(fileIds.size, 1)
      const [file] = await db
        .select()
        .from(contributionFilesTable)
        .where(eq(contributionFilesTable.id, [...fileIds][0]))
      assert.equal(file.uploadedById, fixture.userId)
      assert.equal(file.publishedRevisionId, null)
      receipts.created = {
        draftId: row.id,
        fileId: file.id,
        version: row.version
      }
      await screenshot("01-private-draft")
    })

    await step(
      "Rapid My drafts clicks save once and navigate once",
      async () => {
        const before = await settled(initialWriting, false)
        const updatesBefore = mutations.filter(
          (item) => item.path === "termDrafts.update"
        ).length
        const routesBefore = destinationRequests
        const navigationsBefore = navigations.filter(
          (item) => item.path === "/profile/drafts"
        ).length
        const saving = hold()
        const destination = hold()
        saveResponse = saving
        destinationResponse = destination
        await citation().check()
        const link = page!.getByRole("link", { name: "My drafts", exact: true })
        await link.scrollIntoViewIfNeeded()
        const box = await link.boundingBox()
        assert(box)
        await page!.mouse.dblclick(
          box.x + box.width / 2,
          box.y + box.height / 2,
          { delay: 40 }
        )
        await expect.poll(() => saving.reached).toBe(true)
        await expect(
          page!.getByText("Opening My drafts…", { exact: true })
        ).toBeVisible()
        assert.equal(new URL(page!.url()).pathname, "/add")
        assert.equal(
          mutations.filter((item) => item.path === "termDrafts.update").length -
            updatesBefore,
          1
        )
        const committed = await savedDraft()
        assert.equal(committed.version, before.version + 1)
        assert.equal(committed.payload?.files[0].publish, true)
        saving.release()
        await expect.poll(() => destination.reached).toBe(true)
        await expect(link).toHaveAttribute("aria-busy", "true")
        await page!.mouse.dblclick(
          box.x + box.width / 2,
          box.y + box.height / 2,
          { delay: 40 }
        )
        await expect(link).toHaveAttribute("aria-busy", "true")
        assert.equal(destinationRequests - routesBefore, 1)
        assert.equal(
          mutations.filter((item) => item.path === "termDrafts.update").length -
            updatesBefore,
          1
        )
        await screenshot("02-repeated-navigation-pending")
        destination.release()
        await expect(page!).toHaveURL(/\/profile\/drafts$/)
        assert.equal(
          navigations.filter((item) => item.path === "/profile/drafts").length -
            navigationsBefore,
          1
        )
        assert.equal((await savedDraft()).version, committed.version)
        await page!.goto(draftUrl, { waitUntil: "domcontentloaded" })
        await expect(citation()).toBeChecked()
        await settled(initialWriting, true)
        receipts.rapidNavigation = {
          clicks: 4,
          updates: 1,
          destinationRequests: 1,
          navigationCommits: 1,
          beforeVersion: before.version,
          afterVersion: committed.version,
          sourceRetained: true
        }
      }
    )

    await step(
      "Two real tabs report conflicts and reload only with consent",
      async () => {
        await button("Back to writing").click()
        const baseline = await settled(initialWriting, true, "write")
        const beforeOpening = mutations.length
        const tabA = page!
        const tabB = await newPage()
        await tabB.goto(draftUrl, { waitUntil: "networkidle" })
        await expect(
          tabB.getByRole("textbox", { name: "Definition", exact: true })
        ).toHaveValue(initialWriting)
        await expect(
          tabB.getByText("Draft saved to your account", { exact: true })
        ).toBeVisible()
        // This negative assertion must span the 700 ms autosave debounce.
        // Opening a JSONB-hydrated draft is not an edit, even if its object
        // keys arrive in a different order from the editor's reconstruction.
        await tabB.waitForTimeout(900)
        assert.equal(
          mutations.length,
          beforeOpening,
          "Opening a second tab must not save an unchanged draft"
        )
        assert.equal((await savedDraft()).version, baseline.version)
        receipts.passiveTabOpen = {
          versionBefore: baseline.version,
          versionAfter: baseline.version,
          mutationCount: 0,
          debounceObservationMs: 900
        }
        await writing().fill(tabAWriting)
        const aSaved = await settled(tabAWriting, true, "write")
        assert(aSaved.version > baseline.version)
        page = tabB
        fault = "conflict"
        const responseStart = responses.length
        await writing().fill(tabBWriting)
        await button("Review definition").click()
        await citation().uncheck()
        const conflictAlert = saveAlert().filter({
          hasText: "This draft changed in another tab or device."
        })
        await expect(conflictAlert).toBeVisible()
        await expect(button("Retry save")).toHaveCount(0)
        await expect(
          page!.getByText(tabBWriting, { exact: true })
        ).toBeVisible()
        await expect(citation()).not.toBeChecked()
        await expect
          .poll(() =>
            responses
              .slice(responseStart)
              .some(
                (item) =>
                  item.path === "/api/trpc/termDrafts.update" &&
                  item.status === 409
              )
          )
          .toBe(true)
        assert.equal((await savedDraft()).version, aSaved.version)
        assert.equal((await savedDraft()).payload?.definition, tabAWriting)
        assert.equal((await savedDraft()).payload?.files[0].publish, true)
        await screenshot("03-two-tab-conflict")
        await confirmReload(false)
        await expect(conflictAlert).toBeVisible()
        await expect(
          page!.getByText(tabBWriting, { exact: true })
        ).toBeVisible()
        await expect(citation()).not.toBeChecked()
        await confirmReload(true)
        await expect(writing()).toHaveValue(tabAWriting)
        await expect(conflictAlert).not.toBeVisible()
        await settled(tabAWriting, true, "write")
        fault = null
        await tabA.close()
        await writing().fill(resumedWriting)
        await button("Review definition").click()
        await expect(citation()).toBeChecked()
        const resumed = await settled(resumedWriting, true)
        await page!.reload({ waitUntil: "domcontentloaded" })
        await expect(
          page!.getByText(resumedWriting, { exact: true })
        ).toBeVisible()
        await expect(citation()).toBeChecked()
        receipts.conflict = {
          baselineVersion: baseline.version,
          tabAVersion: aSaved.version,
          resumedVersion: resumed.version,
          realStatus: 409,
          cancelPreservedLocalWritingAndCitation: true,
          explicitReloadAdoptedSavedState: true
        }
      }
    )

    await step(
      "A genuinely offline save preserves writing and recovers after reconnecting",
      async () => {
        await button("Back to writing").click()
        const before = await settled(resumedWriting, true, "write")
        await page!.waitForLoadState("networkidle")
        fault = "offline"
        interruptNextSaveOffline = true
        await writing().fill(offlineWriting)
        await button("Review definition").click()
        await citation().uncheck()
        await expect.poll(() => saveInterruptedOffline).toBe(true)
        await expect(button("Retry save")).toBeVisible()
        await expect(saveAlert()).toBeVisible()
        await expect(
          page!.getByText(offlineWriting, { exact: true })
        ).toBeVisible()
        await expect(citation()).not.toBeChecked()
        await expect(
          page!.getByRole("region", { name: "Review attached files" })
        ).toContainText(sourceTitle)
        const unchanged = await savedDraft()
        assert.equal(unchanged.version, before.version)
        assert.equal(unchanged.payload?.definition, resumedWriting)
        assert.equal(unchanged.payload?.files[0].publish, true)
        await screenshot("04-offline-writing-retained")
        await context!.setOffline(false)
        await button("Retry save").click()
        const recovered = await settled(offlineWriting, false)
        await expect(button("Retry save")).toHaveCount(0)
        fault = null
        await page!.reload({ waitUntil: "domcontentloaded" })
        await expect(
          page!.getByText(offlineWriting, { exact: true })
        ).toBeVisible()
        await expect(citation()).not.toBeChecked()
        await expect(
          page!.getByRole("region", { name: "Review attached files" })
        ).toContainText(sourceTitle)
        receipts.offline = {
          beforeVersion: before.version,
          afterVersion: recovered.version,
          interruptedAfterDispatch: true,
          databaseUnchangedWhileOffline: true,
          writingSourceAndCitationRetained: true
        }
      }
    )

    for (const revert of [false, true]) {
      await step(
        revert
          ? "Retry reconciles an exact local reversion after a committed response is lost"
          : "A lost committed save response retries without duplicating the write",
        async () => {
          if (await citation().isChecked()) {
            await citation().uncheck()
            await settled(offlineWriting, false)
          }
          const before = await settled(offlineWriting, false)
          const mutationStart = mutations.length
          const dropped = hold("drop")
          saveResponse = dropped
          fault = "dropped-response"
          await citation().check()
          await expect.poll(() => dropped.reached).toBe(true)
          await expect(button("Retry save")).toBeVisible()
          await expect(citation()).toBeChecked()
          const committed = await savedDraft()
          assert.equal(committed.version, before.version + 1)
          assert.equal(committed.payload?.files[0].publish, true)
          if (revert) {
            await citation().uncheck()
            await expect(citation()).not.toBeChecked()
            assert.equal((await savedDraft()).payload?.files[0].publish, true)
          }
          await screenshot(
            revert
              ? "06-lost-response-local-reversion"
              : "05-lost-response-retained"
          )
          await button("Retry save").click()
          const recovered = await settled(offlineWriting, !revert)
          await expect(button("Retry save")).toHaveCount(0)
          await expect(saveAlert()).toHaveCount(0)
          const writes = mutations
            .slice(mutationStart)
            .filter((item) => item.path === "termDrafts.update")
          assert.equal(writes.length, revert ? 3 : 2)
          assert.deepEqual(
            writes[1].input,
            writes[0].input,
            "Retry acknowledges the exact original mutation"
          )
          assert.equal(recovered.version, committed.version + (revert ? 1 : 0))
          if (revert) {
            assert.notEqual(
              writes[2].input.mutationId,
              writes[0].input.mutationId
            )
            assert.equal(writes[2].input.expectedVersion, committed.version)
          }
          fault = null
          await page!.reload({ waitUntil: "domcontentloaded" })
          await expect(citation()).toBeChecked({ checked: !revert })
          await expect(
            page!.getByText(offlineWriting, { exact: true })
          ).toBeVisible()
          receipts[revert ? "lostResponseReversion" : "lostResponse"] = {
            beforeVersion: before.version,
            committedVersion: committed.version,
            recoveredVersion: recovered.version,
            requestCount: writes.length,
            identicalRetry: true,
            finalCitation: !revert
          }
        }
      )
    }

    await step(
      "Rapid publication creates one term, definition, and initial revision",
      async () => {
        await citation().check()
        const before = await settled(offlineWriting, true)
        const publicationStart = mutations.filter(
          (item) => item.path === "termDrafts.publish"
        ).length
        const publishing = hold()
        publishResponse = publishing
        const publish = button("Publish new term")
        await publish.scrollIntoViewIfNeeded()
        const box = await publish.boundingBox()
        assert(box)
        await page!.mouse.dblclick(
          box.x + box.width / 2,
          box.y + box.height / 2,
          { delay: 40 }
        )
        await expect.poll(() => publishing.reached).toBe(true)
        await expect(publish).toBeDisabled()
        assert.equal(
          mutations.filter((item) => item.path === "termDrafts.publish")
            .length - publicationStart,
          1
        )
        const terms = await db
          .select()
          .from(termsTable)
          .where(eq(termsTable.vocabularySlug, fixture.vocabularySlug))
        assert.equal(terms.length, 1)
        assert.equal(terms[0].term, term)
        const definitions = await db
          .select()
          .from(definitionsTable)
          .where(eq(definitionsTable.termId, terms[0].id))
        assert.equal(definitions.length, 1)
        assert.equal(definitions[0].definition, offlineWriting)
        assert.equal(definitions[0].authorId, fixture.userId)
        const revisions = await db
          .select()
          .from(definitionRevisionsTable)
          .where(eq(definitionRevisionsTable.definitionId, definitions[0].id))
        assert.equal(revisions.length, 1)
        const publishedDraft = await savedDraft()
        assert(publishedDraft.publishedAt)
        assert.equal(publishedDraft.publishedDefinitionId, definitions[0].id)
        assert.equal(publishedDraft.publishedVersion, before.version)
        assert.equal(publishedDraft.payload, null)
        const [source] = await db
          .select()
          .from(contributionFilesTable)
          .where(eq(contributionFilesTable.id, [...fileIds][0]))
        assert.equal(source.publishedRevisionId, revisions[0].id)
        assert.equal(source.contributorCited, true)
        await screenshot("07-single-publication-pending")
        publishing.release()
        await expect(page!).toHaveURL(/\/vocabulary\/.+\/definitions\/1/)
        await expect(
          page!.getByText(offlineWriting, { exact: true }).first()
        ).toBeVisible()
        await page!.goto(draftUrl, { waitUntil: "domcontentloaded" })
        await expect(
          page!.getByText("This draft has already been published.", {
            exact: true
          })
        ).toBeVisible()
        await expect(button("Publish new term")).toHaveCount(0)
        assert.equal(
          mutations.filter((item) => item.path === "termDrafts.publish")
            .length - publicationStart,
          1
        )
        receipts.publication = {
          clicks: 2,
          requests: 1,
          termId: terms[0].id,
          definitionId: definitions[0].id,
          revisionId: revisions[0].id,
          publishedVersion: publishedDraft.publishedVersion,
          citedSourcePublished: true
        }
        assert.equal(uploadCount, 1)
        assert.equal(draftIds.size, 1)
        assert.deepEqual(blocked, [])
        assert.deepEqual(errors, [])
      }
    )
  } catch (error) {
    failure = error
    if (page && !page.isClosed()) {
      await page
        .screenshot({
          path: resolve(output, "failure.png"),
          fullPage: true,
          timeout: 5000
        })
        .catch(() => {})
      const failureText = await page
        .locator("body")
        .innerText({ timeout: 3000 })
        .catch(() => null)
      if (failureText !== null)
        await writeFile(resolve(output, "failure.txt"), failureText).catch(
          () => {}
        )
    }
  } finally {
    holds.forEach((control) => control.release())
    try {
      if (context) await context.setOffline(false)
      if (browser) await closeBrowserAfterRoutes(browser)
    } catch (error) {
      failure ??= error
    }
    try {
      await removeGuidedSetupFixture(fixture)
      cleaned = true
    } catch (error) {
      failure ??= error
    }
    await mkdir(output, { recursive: true })
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          passed,
          receipts,
          mutations,
          responses,
          requestFailures,
          navigations,
          expectedErrors,
          errors,
          warnings,
          blocked,
          draftIds: [...draftIds],
          fileIds: [...fileIds],
          uploadCount,
          providerCalls: 0,
          cleaned,
          failure:
            failure instanceof Error ? failure.message : (failure ?? null)
        },
        null,
        2
      )
    )
  }
  console.log(`Evidence: ${output}`)
  if (failure) throw failure
  console.log(
    "Draft resilience UI checks passed; owned fixtures removed. No AI providers were called."
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$client.end())
