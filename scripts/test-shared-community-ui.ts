// Local, disposable fixtures only. Real provider requests and unrelated writes are blocked.
import "dotenv/config"
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  expect as baseExpect,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test"
import { and, eq, inArray } from "drizzle-orm"
import {
  db,
  communitiesTable,
  communityMembersTable,
  communityReviewRoundsTable as reviewRounds,
  communityReviewItemsTable as reviewItems,
  communityReviewResponsesTable as reviewResponses,
  communityReviewEventsTable as reviewEvents,
  usersTable,
  termsTable,
  vocabularyWorkspaceSettingsTable,
  matcoreFieldsTable as fields,
  matcoreSpecDraftsTable as drafts,
  matcoreSpecRevisionsTable as revisions,
  matcoreWorkflowEventsTable as events
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
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import { createMatcoreDraft, submitMatcoreDraft } from "../lib/matcore-workflow"
import { emptyMatcoreDraftPayload } from "../lib/matcore-workflow-types"
import { reviewFingerprints } from "./community-review-test-support"
import {
  launchBrowser,
  localPreviewBase,
  rememberView,
  signInAs,
  closeBrowserAfterRoutes
} from "./ui-test-harness"

const expect = baseExpect.configure({ timeout: 30000 })
async function seedDefinition(fixture: GuidedSetupFixture, name: string) {
  return db.transaction(async (tx) => {
    const [term] = await tx
      .insert(termsTable)
      .values({
        term: name,
        slug: name.toLowerCase().replaceAll(" ", "_"),
        vocabularySlug: fixture.vocabularySlug
      })
      .returning()
    return createDefinitionWithInitialRevision(tx, {
      termId: term.id,
      authorId: fixture.userId,
      definition:
        name === "Ionic conductivity"
          ? "A material’s ability to conduct electric current through the movement of ions."
          : "A solid material that conducts ions through its structure.",
      example: "",
      source: "initial",
      changeNote: "Initial definition"
    })
  })
}
async function main() {
  const base = localPreviewBase(),
    origin = new URL(base).origin
  const output = resolve(
    process.env.SAM_UI_TEST_OUTPUT_DIR
      ? `${process.env.SAM_UI_TEST_OUTPUT_DIR}/shared-community`
      : `/tmp/shared-community-ui-${randomUUID()}`
  )
  await mkdir(output, { recursive: true })
  const before = await reviewFingerprints(),
    fixtures: GuidedSetupFixture[] = [],
    passed: string[] = [],
    blocked: string[] = [],
    errors: string[] = []
  let browser: Browser | undefined,
    page: Page | undefined,
    source: Awaited<ReturnType<typeof installSyntheticUiSource>> | undefined,
    failure: unknown
  const pass = (name: string) => {
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  try {
    const ordinary = await createGuidedSetupFixture()
    fixtures.push(ordinary)
    const mixed = await createGuidedSetupFixture()
    fixtures.push(mixed)
    const outsider = await createGuidedSetupFixture()
    fixtures.push(outsider)
    ordinary.communityTitle = "Materials vocabulary"
    mixed.communityTitle = "Phase Field collaboration"
    for (const fixture of [ordinary, mixed])
      await db
        .update(communitiesTable)
        .set({ title: fixture.communityTitle })
        .where(eq(communitiesTable.id, fixture.communityId))
    source = await installSyntheticUiSource(mixed)
    await db.insert(vocabularyWorkspaceSettingsTable).values({
      vocabularySlug: mixed.vocabularySlug,
      metadataEnabled: true,
      matcoreEnabled: true,
      updatedById: mixed.userId
    })
    for (const fixture of [ordinary, mixed]) {
      await db
        .update(communityMembersTable)
        .set({ role: "steward" })
        .where(
          and(
            eq(communityMembersTable.communityId, fixture.communityId),
            eq(communityMembersTable.userId, fixture.userId)
          )
        )
      await db
        .update(usersTable)
        .set({ activeCommunityId: fixture.communityId })
        .where(eq(usersTable.id, fixture.userId))
    }
    await db.insert(communityMembersTable).values({
      communityId: mixed.communityId,
      userId: ordinary.userId,
      role: "member",
      addedById: mixed.userId
    })
    const ordinaryDefinition = await seedDefinition(
      ordinary,
      "Ionic conductivity"
    )
    await seedDefinition(mixed, "Solid electrolyte")
    const payload = emptyMatcoreDraftPayload()
    payload.label = "Mesh spacing"
    payload.definition =
      "Distance between adjacent mesh points used in a simulation."
    payload.rationale = "Record the spatial resolution explicitly."
    payload.specification.path = "domain.mesh.spacing"
    payload.specification.requirement = "recommended"
    payload.specification.repeatability = "no"
    payload.specification.valueType = "list"
    delete payload.specification.valueForm
    payload.specification.guidance =
      "One spacing per coordinate direction, in metres."
    payload.citations = [
      {
        title: "Mesh specification",
        url: "https://example.org/mesh",
        note: "Defines the recorded spacing."
      }
    ]
    const publication = await db.transaction(async (tx) => {
      const draft = await createMatcoreDraft(
        tx,
        {
          id: randomUUID(),
          vocabularySlug: mixed.vocabularySlug,
          profileKey: "pf",
          profileReleaseId: source!.releaseId,
          payload
        },
        mixed.userId
      )
      return submitMatcoreDraft(
        tx,
        { id: draft.id, expectedVersion: draft.version },
        mixed.userId
      )
    })
    browser = await launchBrowser()
    const guard = async (context: BrowserContext) => {
      await context.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url()),
          paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? []
        if (url.origin !== origin && url.protocol !== "blob:") {
          blocked.push(url.pathname)
          return route.abort()
        }
        if (
          paths.some((path) =>
            /^(aiAssist\.|termReferences\.|ontologyContext\.)/.test(path)
          )
        ) {
          blocked.push(url.pathname)
          return route.abort()
        }
        if (
          request.method() === "GET" ||
          (url.pathname === "/__nextjs_original-stack-frames" &&
            request.method() === "POST")
        )
          return route.continue()
        const input = request.postDataJSON()?.[0] as
          | Record<string, unknown>
          | undefined
        if (paths.length === 1 && input) {
          if (
            paths[0] === "communityReviews.create" &&
            input.communityId === ordinary.communityId &&
            Array.isArray(input.targetIds) &&
            input.targetIds.length === 1 &&
            input.targetIds[0] ===
              `definition:${ordinaryDefinition.revision.id}`
          )
            return route.continue()
          if (paths[0] === "communityReviews.save") {
            const [owned] = await db
              .select({ id: reviewItems.id })
              .from(reviewItems)
              .innerJoin(reviewRounds, eq(reviewRounds.id, reviewItems.roundId))
              .where(
                and(
                  eq(reviewItems.id, String(input.itemId)),
                  eq(reviewRounds.communityId, ordinary.communityId),
                  eq(
                    reviewItems.definitionRevisionId,
                    ordinaryDefinition.revision.id
                  )
                )
              )
            if (owned) return route.continue()
          }
          if (
            paths[0] === "matcoreWorkflow.createDraft" &&
            input.vocabularySlug === mixed.vocabularySlug &&
            input.expectedOwnerId === mixed.userId
          )
            return route.continue()
          if (paths[0] === "matcoreWorkflow.updateDraft") {
            const [owned] = await db
              .select({ id: drafts.id })
              .from(drafts)
              .innerJoin(fields, eq(fields.id, drafts.fieldId))
              .where(
                and(
                  eq(drafts.id, String(input.id)),
                  eq(drafts.ownerId, mixed.userId),
                  eq(fields.vocabularySlug, mixed.vocabularySlug)
                )
              )
            if (owned) return route.continue()
          }
        }
        blocked.push(`${request.method()} ${url.pathname}`)
        return route.abort()
      })
    }
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true
    })
    await guard(context)
    await rememberView(context, base, "advanced")
    await signInAs(context, base, ordinary.userId)
    page = await context.newPage()
    page.setDefaultNavigationTimeout(90000)
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    const navigation = () =>
      page!.getByRole("navigation", {
        name: "Community workspace",
        exact: true
      })
    const tabOrder = [
      "Quick start",
      "Browse",
      "Contributions",
      "Reviews",
      "My work",
      "People",
      "Manage community"
    ]
    const checkOrder = async (manager = true) => {
      await expect(navigation()).toBeVisible()
      assert.deepEqual(
        await navigation().getByRole("link").allTextContents(),
        manager ? tabOrder : tabOrder.slice(0, 6)
      )
    }
    await page.goto(
      `${base}/communities/${ordinary.communitySlug}?view=contributions`
    )
    await checkOrder()
    await expect(
      page.getByRole("heading", { name: "Contributions", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Ionic conductivity", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Propose field", exact: true })
    ).toHaveCount(0)
    pass(
      "ordinary community shows shared navigation and ordinary contribution actions"
    )
    await page
      .getByRole("checkbox", { name: /^Select Ionic conductivity,/ })
      .check()
    await page
      .getByRole("button", { name: "Export review packet", exact: true })
      .click()
    let dialog = page.getByRole("dialog", {
      name: "Review packet",
      exact: true
    })
    await expect(
      dialog.getByText("1 selected revision. Respondent names omitted.", {
        exact: true
      })
    ).toBeVisible()
    await expect(
      dialog.getByRole("checkbox", { name: "Include respondent names" })
    ).not.toBeChecked()
    await page.keyboard.press("Escape")
    await page
      .getByRole("link", { name: "Request feedback", exact: true })
      .click()
    await expect(page).toHaveURL(/view=review/)
    await expect(
      page.getByRole("heading", { name: "Request feedback", exact: true })
    ).toBeVisible()
    pass(
      "ordinary steward can prepare a review packet and request feedback on a selected definition"
    )

    await page
      .getByLabel("Review name", { exact: true })
      .fill("Conductivity definition feedback")
    await page
      .getByRole("button", { name: "Create review", exact: true })
      .click()
    await expect(
      page.getByRole("link", { name: "Open review", exact: true })
    ).toBeVisible()
    await page.getByRole("link", { name: "Open review", exact: true }).click()
    await expect(
      page.getByRole("radio", { name: "Needs revision", exact: true })
    ).toBeVisible()
    await page
      .getByRole("radio", { name: "Needs revision", exact: true })
      .check()
    await page
      .locator("summary")
      .filter({ hasText: "Comment (optional)" })
      .click()
    await page
      .getByRole("textbox", { name: "Comment (optional)", exact: true })
      .fill("Please state the temperature used for conductivity.")
    await page
      .getByRole("button", { name: "Save response", exact: true })
      .click()
    await expect(page.getByRole("status")).toContainText("Response saved")
    await page.reload()
    await page
      .getByRole("button", { name: "My responses", exact: true })
      .click()
    await expect(
      page.getByRole("radio", { name: "Needs revision", exact: true })
    ).toBeChecked()
    await page.goto(
      `${base}/communities/${ordinary.communitySlug}?view=contributions`
    )
    await page
      .getByRole("checkbox", { name: /^Select Ionic conductivity,/ })
      .check()
    const ordinaryPacketReady = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/api/communities/${ordinary.communitySlug}/review-packet`
          ) && response.url().includes("format=preview")
    )
    await page
      .getByRole("button", { name: "Export review packet", exact: true })
      .click()
    const ordinaryPacket = await (await ordinaryPacketReady).json()
    dialog = page.getByRole("dialog", { name: "Review packet", exact: true })
    await expect(dialog.getByText(/1 review response/)).toBeVisible()
    assert.equal(
      ordinaryPacket.items[0].target,
      `definition:${ordinaryDefinition.revision.id}`
    )
    assert.equal(
      ordinaryPacket.items[0].feedback[0].revisionId,
      String(ordinaryDefinition.revision.id)
    )
    assert.equal(ordinaryPacket.items[0].feedback[0].responseCount, 1)
    assert.equal(
      ordinaryPacket.items[0].feedback[0].comments[0].text,
      "Please state the temperature used for conductivity."
    )
    assert.equal(ordinaryPacket.items[0].feedback[0].respondents, undefined)
    await page.screenshot({
      path: resolve(output, "ordinary-review-feedback-packet.png"),
      fullPage: true,
      animations: "disabled"
    })
    const namedPacketReady = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/api/communities/${ordinary.communitySlug}/review-packet`
          ) && new URL(response.url()).searchParams.get("names") === "1"
    )
    await dialog
      .getByRole("checkbox", { name: "Include respondent names" })
      .check()
    const namedPacket = await (await namedPacketReady).json()
    assert.equal(
      namedPacket.items[0].feedback[0].respondents[0].name,
      ordinary.userName
    )
    await expect(
      dialog.getByText("1 selected revision. Respondent names included.", {
        exact: true
      })
    ).toBeVisible()
    await page.keyboard.press("Escape")
    pass(
      "ordinary steward creates a definition review, saves and reloads feedback, and exports the exact revision's response with optional names"
    )

    await signInAs(context, base, mixed.userId)
    await page.goto(base)
    await expect(
      page
        .getByRole("region", { name: "Quick start", exact: true })
        .getByRole("link", { name: "Propose field", exact: true })
    ).toHaveAttribute(
      "href",
      `/communities/${mixed.communitySlug}?view=contributions&action=new`
    )
    await expect(
      page
        .getByRole("region", { name: "Quick start", exact: true })
        .getByRole("link", { name: "Add term", exact: true })
    ).toHaveAttribute("href", `/add?vocabularySlug=${mixed.vocabularySlug}`)
    pass(
      "home quick start uses the active metadata community and retains an explicit Add term action"
    )
    const contributionContext = new URLSearchParams({
      view: "contributions",
      profile: "pf",
      release: source.releaseId,
      standard: "reference",
      layout: "hierarchy"
    })
    await page.goto(
      `${base}/communities/${mixed.communitySlug}?${contributionContext}`
    )
    await checkOrder()
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get("type") === "all" &&
        url.searchParams.get("status") === "all" &&
        [...contributionContext].every(
          ([key, value]) => url.searchParams.get(key) === value
        )
    )
    await expect(
      page.getByRole("heading", { name: "Contributions", exact: true })
    ).toBeVisible()
    const fieldAction = await page
      .getByRole("link", { name: "Propose field", exact: true })
      .getAttribute("href")
    assert.ok(fieldAction)
    const fieldActionUrl = new URL(fieldAction, base)
    assert.equal(fieldActionUrl.searchParams.get("release"), source.releaseId)
    assert.equal(fieldActionUrl.searchParams.get("profile"), "pf")
    assert.equal(fieldActionUrl.searchParams.get("action"), "new")
    await expect(
      page.getByRole("link", { name: "Solid electrolyte", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Mesh spacing", exact: true })
    ).toBeVisible()
    await page
      .getByRole("checkbox", { name: /^Select Solid electrolyte,/ })
      .check()
    await page.getByRole("checkbox", { name: /^Select Mesh spacing,/ }).check()
    await expect(
      page.getByRole("checkbox", { name: /^Select Solid electrolyte,/ })
    ).toBeChecked()
    await expect(
      page.getByRole("checkbox", { name: /^Select Mesh spacing,/ })
    ).toBeChecked()
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible()
    await page
      .getByRole("button", { name: "Export review packet", exact: true })
      .click()
    dialog = page.getByRole("dialog", { name: "Review packet", exact: true })
    await expect(
      dialog.getByText("2 selected revisions. Respondent names omitted.", {
        exact: true
      })
    ).toBeVisible()
    await expect(
      dialog.getByText("Mesh spacing", { exact: true })
    ).toBeVisible()
    await expect(
      dialog.getByText("Solid electrolyte", { exact: true })
    ).toBeVisible()
    await page.screenshot({
      path: resolve(output, "desktop-review-packet.png"),
      fullPage: true,
      animations: "disabled"
    })
    const downloadReady = page.waitForEvent("download")
    await dialog
      .getByRole("button", { name: "Download JSON", exact: true })
      .click()
    const download = await downloadReady
    const downloadPath = await download.path()
    assert.ok(downloadPath)
    const packet = JSON.parse(await readFile(downloadPath, "utf8"))
    assert.equal(packet.items.length, 2)
    assert.equal(packet.includeRespondentNames, false)
    assert.ok(
      packet.items.some((item: { kind: string }) => item.kind === "definition")
    )
    assert.ok(
      packet.items.some((item: { kind: string }) => item.kind === "proposal")
    )
    const exportedProposal = packet.items.find(
      (item: { kind: string }) => item.kind === "proposal"
    )
    assert.ok(
      exportedProposal.after.rules.some(
        (rule: { label: string; value: string }) =>
          rule.label === "Value form" && rule.value === "List"
      )
    )
    assert.ok(
      exportedProposal.after.rules.some(
        (rule: { label: string; value: string }) =>
          rule.label === "Data type" && rule.value === "Not recorded separately"
      )
    )
    const printReady = context.waitForEvent("page")
    await dialog
      .getByRole("button", { name: "Print / save PDF", exact: true })
      .click()
    const printable = await printReady
    const printErrors: string[] = []
    printable.on("console", (message) => {
      if (message.type() === "error") printErrors.push(message.text())
    })
    await expect(
      printable.getByRole("heading", {
        name: `${mixed.communityTitle} review packet`,
        exact: true
      })
    ).toBeVisible()
    await expect(
      printable.getByRole("heading", { name: "Mesh spacing", exact: true })
    ).toBeVisible()
    await expect(
      printable.getByRole("heading", { name: "Solid electrolyte", exact: true })
    ).toBeVisible()
    assert.equal(
      await printable
        .locator("body")
        .evaluate((node) => getComputedStyle(node).fontSize),
      "16px",
      "report styles are allowed by its CSP"
    )
    await printable.emulateMedia({ media: "print" })
    await expect(
      printable.getByText(
        "Use your browser’s Print command to print or save as PDF.",
        { exact: true }
      )
    ).toBeHidden()
    await printable.pdf({
      path: resolve(output, "review-packet.pdf"),
      format: "A4",
      printBackground: true
    })
    await printable.screenshot({
      path: resolve(output, "print-review-packet.png"),
      fullPage: true,
      animations: "disabled"
    })
    assert.deepEqual(
      printErrors,
      [],
      "printable report has no CSP or script errors"
    )
    await printable.close()
    await page.keyboard.press("Escape")
    pass(
      "mixed community exports one packet with definition and proposal revisions, with names omitted by default"
    )
    await page.getByRole("link", { name: "Mesh spacing", exact: true }).click()
    await expect(
      page.getByRole("tab", { name: "Definition", exact: true })
    ).toHaveAttribute("aria-selected", "true")
    assert.deepEqual(await page.getByRole("tab").allTextContents(), [
      "Definition",
      "Changes",
      "Discussion",
      "Sources & history"
    ])
    await expect(
      page.getByRole("heading", { name: "Field specification", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Record decision", exact: true })
    ).toBeVisible()
    await page
      .getByRole("tab", { name: "Sources & history", exact: true })
      .click()
    await expect(
      page.getByRole("link", { name: "Mesh specification", exact: true })
    ).toBeVisible()
    await page
      .getByRole("link", { name: "Back to contributions", exact: true })
      .click()
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `/communities/${mixed.communitySlug}` &&
        [...contributionContext].every(
          ([key, value]) => url.searchParams.get(key) === value
        )
    )
    assert.equal(
      new URL(page.url()).searchParams.get("release"),
      source.releaseId
    )
    pass(
      "published field opens Definition first, preserves full rules, visible decisions, sources and contribution return context"
    )

    await page.getByRole("link", { name: "Propose field", exact: true }).click()
    const create = page.getByRole("dialog", {
      name: "Propose a new field",
      exact: true
    })
    await create
      .getByLabel("Field name", { exact: true })
      .fill("Interface width")
    await create
      .getByRole("button", { name: "Create draft", exact: true })
      .click()
    await expect(page).toHaveURL(/\/metadata\/workspace\/[0-9a-f-]+/)
    const createdDraftId = new URL(page.url()).pathname.split("/").at(-1)!
    const [createdDraft] = await db
      .select({
        profileReleaseId: drafts.profileReleaseId,
        profileKey: drafts.profileKey
      })
      .from(drafts)
      .where(
        and(eq(drafts.id, createdDraftId), eq(drafts.ownerId, mixed.userId))
      )
    assert.equal(createdDraft?.profileReleaseId, source.releaseId)
    assert.equal(createdDraft?.profileKey, "pf")
    await expect(
      page.getByRole("tab", { name: "Definition", exact: true })
    ).toHaveAttribute("aria-selected", "true")
    await page
      .getByRole("textbox", { name: "Definition", exact: true })
      .fill(
        "Thickness of the diffuse interface represented by the phase field."
      )
    await page
      .getByLabel("Repeatable field", { exact: true })
      .selectOption("no")
    await expect(
      page.getByText("Draft saved to your account", { exact: true })
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole("textbox", { name: "Definition", exact: true })
    ).toHaveValue(
      "Thickness of the diffuse interface represented by the phase field."
    )
    await expect(
      page.getByLabel("Repeatable field", { exact: true })
    ).toHaveValue("no")
    await expect(
      page.getByRole("textbox", { name: "Definition", exact: true })
    ).toBeEnabled()
    await expect(
      page.getByText("Draft saved to your account", { exact: true })
    ).toBeVisible()
    await page.screenshot({
      path: resolve(output, "desktop-field-editor.png"),
      fullPage: true,
      animations: "disabled"
    })
    await page.getByRole("tab", { name: "Field rules", exact: true }).click()
    await expect(
      page.getByRole("heading", {
        name: "Specify the value rules",
        exact: true
      })
    ).toBeVisible()
    await page
      .getByRole("link", { name: "Back to contributions", exact: true })
      .click()
    await expect(page).toHaveURL(/view=contributions/)
    assert.equal(
      new URL(page.url()).searchParams.get("release"),
      source.releaseId
    )
    pass(
      "metadata creation starts at Definition and preserves selected release, field rules and writing through filters, save, reload and return"
    )
    await navigation()
      .getByRole("link", { name: "My work", exact: true })
      .click()
    const workOutline = page.getByRole("navigation", {
      name: "On this page",
      exact: true
    })
    await expect(workOutline).toBeVisible()
    await expect(workOutline.getByRole("link")).toHaveCount(2)
    assert.deepEqual(await workOutline.getByRole("link").allTextContents(), [
      "Term drafts",
      "Metadata drafts"
    ])
    await navigation()
      .getByRole("link", { name: "Contributions", exact: true })
      .click()
    pass(
      "My work keeps a stable section order when metadata drafts exist and term drafts are empty"
    )
    await expect(page).toHaveURL(/view=contributions/)
    await expect(
      page.getByRole("heading", { name: "Contributions", exact: true })
    ).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await checkOrder()
    await expect(
      navigation().getByRole("link", { name: "Manage community", exact: true })
    ).toBeVisible()
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      ),
      false
    )
    await navigation()
      .getByRole("link", { name: "Browse", exact: true })
      .click()
    await expect(page).toHaveURL(/view=vocabulary/)
    await expect(page).toHaveURL(/profile=pf/)
    await navigation()
      .getByRole("link", { name: "Contributions", exact: true })
      .click()
    await expect(page).toHaveURL(/view=contributions/)
    await expect(
      navigation().getByRole("link", { name: "Contributions", exact: true })
    ).toHaveAttribute("aria-current", "page")
    await expect(
      page.getByRole("heading", { name: "Contributions", exact: true })
    ).toBeVisible()
    await page.screenshot({
      path: resolve(output, "mobile-contributions.png"),
      fullPage: true,
      animations: "disabled"
    })
    pass(
      "mobile navigation keeps shared order, visible management and selected area without horizontal overflow"
    )

    await signInAs(context, base, ordinary.userId)
    await page.goto(
      `${base}/communities/${mixed.communitySlug}?view=contributions&profile=pf`
    )
    await checkOrder(false)
    await expect(
      page.getByRole("button", { name: "Export review packet", exact: true })
    ).toHaveCount(0)
    const target = `proposal:${publication.revisionId}`
    const deniedMember = await context.request.get(
      `${base}/api/communities/${mixed.communitySlug}/review-packet?target=${target}`
    )
    assert.ok([403, 404].includes(deniedMember.status()))
    await page.goto(
      `${base}/metadata/fields/${publication.fieldId}?revision=${publication.revisionId}`
    )
    await expect(
      page.getByRole("heading", { name: "Mesh spacing", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Record decision", exact: true })
    ).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "Export review packet", exact: true })
    ).toHaveCount(0)
    pass(
      "ordinary member can read contributions but cannot export the steward packet"
    )
    await signInAs(context, base, outsider.userId)
    await page.goto(
      `${base}/communities/${mixed.communitySlug}?view=contributions`
    )
    await expect(
      page.getByRole("link", { name: "Mesh spacing", exact: true })
    ).toHaveCount(0)
    await expect(
      page.getByRole("link", { name: "Solid electrolyte", exact: true })
    ).toHaveCount(0)
    const deniedOutsider = await context.request.get(
      `${base}/api/communities/${mixed.communitySlug}/review-packet?target=${target}`
    )
    assert.ok([403, 404].includes(deniedOutsider.status()))
    await context.clearCookies()
    await page.goto(
      `${base}/communities/${ordinary.communitySlug}?view=contributions`
    )
    await expect(
      page.getByRole("link", { name: "Ionic conductivity", exact: true })
    ).toBeVisible()
    await expect(
      navigation().getByRole("link", { name: "Manage community", exact: true })
    ).toHaveCount(0)
    pass(
      "private community content stays hidden from outsiders while public ordinary contributions remain readable"
    )
    assert.deepEqual(errors, [])
    assert.deepEqual(blocked, [])
  } catch (error) {
    failure = error
    if (page && !page.isClosed())
      await page
        .screenshot({
          path: resolve(output, "failure.png"),
          fullPage: true,
          animations: "disabled"
        })
        .catch(() => {})
  } finally {
    if (browser) await closeBrowserAfterRoutes(browser)
    const ordinary = fixtures[0]
    if (ordinary)
      await db.transaction(async (tx) => {
        const rounds = await tx
          .select({ id: reviewRounds.id })
          .from(reviewRounds)
          .where(eq(reviewRounds.communityId, ordinary.communityId))
        const ids = rounds.map((row) => row.id)
        if (ids.length) {
          const items = await tx
            .select({ id: reviewItems.id })
            .from(reviewItems)
            .where(inArray(reviewItems.roundId, ids))
          const itemIds = items.map((row) => row.id)
          if (itemIds.length) {
            await tx
              .delete(reviewEvents)
              .where(inArray(reviewEvents.itemId, itemIds))
            await tx
              .delete(reviewResponses)
              .where(inArray(reviewResponses.itemId, itemIds))
          }
          await tx.delete(reviewItems).where(inArray(reviewItems.roundId, ids))
          await tx.delete(reviewRounds).where(inArray(reviewRounds.id, ids))
        }
      })
    const mixed = fixtures[1]
    if (mixed) {
      await db.transaction(async (tx) => {
        const owned = await tx
          .select()
          .from(fields)
          .where(eq(fields.vocabularySlug, mixed.vocabularySlug))
        assert.ok(
          owned.every(
            (row) => row.createdById === mixed.userId && row.termId === null
          )
        )
        const ids = owned.map((row) => row.id)
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
              mixed.vocabularySlug
            )
          )
        if (fixtures[0])
          await tx
            .delete(communityMembersTable)
            .where(
              and(
                eq(communityMembersTable.communityId, mixed.communityId),
                eq(communityMembersTable.userId, fixtures[0].userId)
              )
            )
      })
      if (source)
        await removeSyntheticUiSource(mixed, source.created, source.releaseId)
    }
    for (const fixture of fixtures.reverse())
      await removeGuidedSetupFixture(fixture)
    assert.deepEqual(
      await reviewFingerprints(),
      before,
      "All pre-existing records are unchanged after fixture cleanup"
    )
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          passed,
          blocked,
          errors,
          preservation: "all retained tables unchanged",
          error: failure instanceof Error ? failure.message : (failure ?? null)
        },
        null,
        2
      )
    )
  }
  if (failure) throw failure
  console.log(`Shared community UI checks passed. Evidence: ${output}`)
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
