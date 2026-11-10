// Browser plugin not available. Exercise the local rendered app with Playwright.
// All writes are confined to disposable fixtures and all external calls are blocked.
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
  usersTable as users,
  communityMembersTable as members,
  vocabularyWorkspaceSettingsTable as settings,
  termsTable as terms,
  communityReviewRoundsTable as rounds,
  communityReviewItemsTable as items,
  communityReviewResponsesTable as responses,
  communityReviewEventsTable as events,
  communityReviewExercisesTable as exercises,
  communityReviewExerciseEventsTable as exerciseEvents
} from "../drizzle"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import {
  createGuidedSetupFixture,
  removeGuidedSetupFixture,
  type GuidedSetupFixture
} from "./guided-setup-ui-fixture"
import {
  installSyntheticUiSource,
  removeSyntheticUiSource
} from "./fixtures/matcore-source-db-fixture"
import { reviewFingerprints } from "./community-review-test-support"
import {
  launchBrowser,
  localPreviewBase,
  signInAs,
  closeBrowserAfterRoutes
} from "./ui-test-harness"
import { communityReviewHref } from "../lib/community-review-types"

const expect = baseExpect.configure({ timeout: 30000 })
async function main() {
  const base = localPreviewBase(),
    origin = new URL(base).origin
  const output = resolve(
    process.env.SAM_UI_TEST_OUTPUT_DIR ?? "/tmp",
    "community-review-exercise"
  )
  await mkdir(output, { recursive: true })
  const before = await reviewFingerprints(),
    fixtures: GuidedSetupFixture[] = [],
    passed: string[] = [],
    blocked: string[] = [],
    errors: string[] = []
  const allowedRoundIds = new Set<string>(),
    allowedItemIds = new Set<string>()
  let browser: Browser | undefined,
    source: Awaited<ReturnType<typeof installSyntheticUiSource>> | undefined,
    failure: unknown
  let loseNextSaveResponse = false
  const pass = (name: string) => {
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  try {
    const member = await createGuidedSetupFixture(),
      steward = await createGuidedSetupFixture(),
      other = await createGuidedSetupFixture()
    fixtures.push(member, steward, other)
    source = await installSyntheticUiSource(
      member,
      "dataset-ui-" + randomUUID()
    )
    await db.insert(settings).values({
      vocabularySlug: member.vocabularySlug,
      metadataEnabled: true,
      matcoreEnabled: true,
      updatedById: member.userId
    })
    await db.insert(members).values({
      communityId: member.communityId,
      userId: steward.userId,
      role: "steward",
      addedById: member.userId
    })
    await db
      .update(members)
      .set({ role: "steward" })
      .where(
        and(
          eq(members.communityId, steward.communityId),
          eq(members.userId, steward.userId)
        )
      )
    await db.transaction(async (tx) => {
      const [term] = await tx
        .insert(terms)
        .values({
          term: "Ionic conductivity",
          slug: "ionic_conductivity",
          vocabularySlug: steward.vocabularySlug
        })
        .returning()
      await createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: steward.userId,
        definition:
          "A material's ability to conduct current through the movement of ions.",
        example: "",
        source: "initial",
        changeNote: "Initial definition"
      })
    })
    const guard = async (context: BrowserContext) => {
      await context.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url())
        if (
          url.origin !== origin ||
          /\/(aiAssist|termReferences|ontologyContext)\./.test(url.pathname)
        ) {
          blocked.push(url.pathname)
          return route.abort()
        }
        if (request.method() === "GET") return route.continue()
        const paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? [],
          input = request.postDataJSON()?.[0]
        if (paths.length === 1 && input) {
          const path = paths[0]
          const allowed =
            (path === "communityReviews.create" &&
              [member.communityId, steward.communityId].includes(
                input.communityId
              )) ||
            (path === "communityReviews.saveExercise" &&
              allowedRoundIds.has(input.roundId)) ||
            (path === "communityReviews.save" &&
              allowedItemIds.has(input.itemId))
          if (allowed) {
            if (
              path === "communityReviews.saveExercise" &&
              loseNextSaveResponse
            ) {
              loseNextSaveResponse = false
              const result = await route.fetch()
              assert.equal(result.status(), 200)
              return route.abort("failed")
            }
            return route.continue()
          }
        }
        blocked.push(url.pathname)
        return route.abort()
      })
    }
    browser = await launchBrowser()
    const staffContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 }
    })
    await signInAs(staffContext, base, steward.userId)
    await guard(staffContext)
    const staff = await staffContext.newPage()
    const monitor = (page: Page) => {
      page.setDefaultTimeout(30000)
      page.on("pageerror", (error) => errors.push(error.message))
    }
    monitor(staff)
    // Old and ordinary review rounds keep the compact field-only workflow.
    await staff.goto(
      `${base}/communities/${steward.communitySlug}?view=review&manage=1`,
      { timeout: 120000 }
    )
    await expect(
      staff.getByLabel("Include a dataset exercise", { exact: true })
    ).toHaveCount(0)
    await staff
      .getByLabel("Review name", { exact: true })
      .fill("Ionic transport definitions")
    await staff
      .getByRole("button", { name: "Create review", exact: true })
      .click()
    await expect(
      staff.getByRole("link", { name: "Open review", exact: true })
    ).toBeVisible()
    const [ordinaryRound] = await db
      .select()
      .from(rounds)
      .where(eq(rounds.communityId, steward.communityId))
    const [ordinaryItem] = await db
      .select()
      .from(items)
      .where(eq(items.roundId, ordinaryRound.id))
    allowedRoundIds.add(ordinaryRound.id)
    allowedItemIds.add(ordinaryItem.id)
    await staff.getByRole("link", { name: "Open review", exact: true }).click()
    await expect(
      staff.getByRole("region", { name: "Dataset example", exact: true })
    ).toHaveCount(0)
    await staff
      .locator("summary")
      .filter({ hasText: "Comment (optional)" })
      .click()
    await staff
      .getByLabel("Comment (optional)")
      .fill("Please specify the measurement temperature.")
    await staff
      .getByRole("button", { name: "Save response", exact: true })
      .click()
    await expect(staff.getByRole("status")).toContainText("Comment saved")
    await expect(
      staff.getByText("1 of 1 reviewed", { exact: true })
    ).toBeVisible()
    await staff.reload()
    await expect(
      staff.getByText("Review complete", { exact: true })
    ).toBeVisible()
    await staff
      .getByRole("button", { name: "My responses", exact: true })
      .click()
    await expect(staff.getByLabel("Comment (optional)")).toHaveValue(
      "Please specify the measurement temperature."
    )
    assert.equal(
      (
        await db
          .select()
          .from(responses)
          .where(eq(responses.itemId, ordinaryItem.id))
      )[0].response,
      null
    )
    pass(
      "Ordinary reviews retain field-only layout and count comment-only feedback after reload"
    )

    await staff.goto(
      `${base}/communities/${member.communitySlug}?view=review&manage=1&profile=pf`,
      { timeout: 120000 }
    )
    await staff
      .getByLabel("Review name", { exact: true })
      .fill("Phase Field dataset review")
    await staff
      .getByLabel("Include a dataset exercise", { exact: true })
      .check()
    await expect(
      staff.getByRole("button", { name: "Create review", exact: true })
    ).toBeDisabled()
    await staff
      .getByLabel("Reference version", { exact: true })
      .selectOption(source.releaseId)
    await staff
      .getByLabel("Review guide link (optional)", { exact: true })
      .fill("https://example.invalid/review-guide")
    await staff
      .getByRole("button", { name: "Create review", exact: true })
      .click()
    await expect(
      staff.getByRole("link", { name: "Open review", exact: true })
    ).toBeVisible()
    const [round] = await db
      .select()
      .from(rounds)
      .where(eq(rounds.communityId, member.communityId))
    const [item] = await db
      .select()
      .from(items)
      .where(eq(items.roundId, round.id))
    allowedRoundIds.add(round.id)
    allowedItemIds.add(item.id)
    assert.equal(round.datasetExercise?.referenceReleaseId, source.releaseId)
    assert.equal(round.datasetExercise?.profile, "pf")
    pass(
      "Steward creates a dataset exercise pinned to the selected reference and area"
    )
    const href =
      base + communityReviewHref(member.communitySlug, round.id, "pf", item.id)
    const participantContext = await browser.newContext({
      viewport: { width: 1280, height: 900 }
    })
    await signInAs(participantContext, base, member.userId)
    await guard(participantContext)
    const a = await participantContext.newPage()
    monitor(a)
    await a.goto(href, { timeout: 120000 })
    const editor = a.getByRole("region", {
      name: "Dataset example",
      exact: true
    })
    await expect(
      editor.getByLabel("Dataset title", { exact: true })
    ).toBeVisible()
    await expect(
      editor.getByRole("link", { name: "Review guide" })
    ).toHaveAttribute("href", "https://example.invalid/review-guide")
    await editor
      .getByRole("button", { name: "Download XML template", exact: true })
      .click()
    await expect(a.getByLabel("Section", { exact: true })).toHaveValue("pf")
    const downloadPromise = a.waitForEvent("download")
    await a.getByRole("button", { name: "Download", exact: true }).click()
    const download = await downloadPromise,
      template = await readFile((await download.path())!, "utf8")
    assert.ok(template.includes("FILL"))
    assert.ok(template.includes("pf"))
    await expect(
      a.getByRole("link", { name: "Propose a missing field", exact: true })
    ).toHaveAttribute("href", /view=contributions.*profile=pf.*action=new/)
    pass(
      "Participant downloads the pinned XML template and can open the review guide"
    )
    // A dataset example remains optional, including for comment-only feedback.
    await editor
      .getByRole("button", { name: "Review fields", exact: true })
      .click()
    await a.locator("summary").filter({ hasText: "Comment (optional)" }).click()
    await a
      .getByLabel("Comment (optional)")
      .fill("Spatial units need clarification.")
    await a.getByRole("button", { name: "Save response", exact: true }).click()
    await expect(a.getByRole("article").getByRole("status")).toContainText(
      "Comment saved"
    )
    assert.equal(
      (
        await db.select().from(responses).where(eq(responses.itemId, item.id))
      )[0].datasetExerciseRevisionId,
      null
    )
    pass("Field feedback does not require an assessment or a dataset example")
    await editor.locator("summary").first().click()
    await editor
      .getByLabel("Dataset title", { exact: true })
      .fill("Dendrite growth simulation")
    await editor
      .getByRole("textbox", { name: "Dataset source", exact: true })
      .fill(
        "A local phase-field simulation of a binary alloy, with a documented spatial grid."
      )
    await editor
      .getByRole("textbox", { name: "Completed metadata XML", exact: true })
      .fill("<metadata><pf><mesh>uniform grid</mesh></pf></metadata>")
    await editor
      .getByRole("textbox", { name: "Dataset notes (optional)", exact: true })
      .fill("The grid spacing is recorded in micrometres.")
    await editor
      .getByRole("button", { name: "Save dataset example", exact: true })
      .click()
    await expect(editor.getByRole("status")).toContainText(
      "Dataset example saved"
    )
    await a.reload()
    await expect(
      editor.getByLabel("Dataset title", { exact: true })
    ).toBeHidden()
    await editor.locator("summary").first().click()
    await expect(
      editor.getByRole("textbox", {
        name: "Completed metadata XML",
        exact: true
      })
    ).toHaveValue("<metadata><pf><mesh>uniform grid</mesh></pf></metadata>")
    await expect(
      editor.getByRole("textbox", {
        name: "Dataset notes (optional)",
        exact: true
      })
    ).toHaveValue("The grid spacing is recorded in micrometres.")
    pass(
      "Dataset XML and notes save, reload, and collapse after a saved example"
    )
    await a
      .getByLabel("Comment (optional)")
      .fill(
        "The dataset uses a uniform grid. Please document its spatial units."
      )
    await a.getByRole("button", { name: "Save response", exact: true }).click()
    await expect(a.getByRole("article").getByRole("status")).toContainText(
      "Comment saved"
    )
    const pinned = (
      await db.select().from(responses).where(eq(responses.itemId, item.id))
    )[0].datasetExerciseRevisionId
    assert.ok(pinned)
    // Server rejects malformed XML but the local editor remains correctable.
    await editor
      .getByRole("textbox", { name: "Completed metadata XML", exact: true })
      .fill("<metadata><pf></metadata>")
    await editor
      .getByRole("button", { name: "Save dataset example", exact: true })
      .click()
    await expect(editor.getByRole("alert")).toBeVisible()
    await expect(
      editor.getByRole("textbox", {
        name: "Completed metadata XML",
        exact: true
      })
    ).toBeEnabled()
    await editor
      .getByRole("textbox", { name: "Completed metadata XML", exact: true })
      .fill("<metadata><pf>FILL</pf></metadata>")
    await editor
      .getByRole("button", { name: "Save dataset example", exact: true })
      .click()
    await expect(editor.getByRole("status")).toContainText("FILL placeholders")
    assert.equal(
      (
        await db.select().from(responses).where(eq(responses.itemId, item.id))
      )[0].datasetExerciseRevisionId,
      pinned
    )
    pass(
      "Malformed XML remains editable; placeholders are explicit; saved feedback keeps its earlier dataset revision"
    )

    const b = await participantContext.newPage()
    monitor(b)
    await b.goto(href, { timeout: 120000 })
    const secondEditor = b.getByRole("region", {
      name: "Dataset example",
      exact: true
    })
    await secondEditor.locator("summary").first().click()
    await editor
      .getByRole("textbox", { name: "Dataset notes (optional)", exact: true })
      .fill("Revision saved from the first tab.")
    await editor
      .getByRole("button", { name: "Save dataset example", exact: true })
      .click()
    await expect(editor.getByRole("status")).toContainText(
      "Dataset example saved"
    )
    await b
      .getByLabel("Comment (optional)")
      .fill("This comment refers to the dataset currently shown in this tab.")
    await b.getByRole("button", { name: "Save response", exact: true }).click()
    await expect(b.getByRole("article").getByRole("alert")).toContainText(
      "The dataset example changed"
    )
    await expect(b.getByLabel("Comment (optional)")).toHaveValue(
      "This comment refers to the dataset currently shown in this tab."
    )
    await secondEditor
      .getByRole("button", {
        name: "Reload saved dataset example",
        exact: true
      })
      .click()
    await expect(
      secondEditor.getByRole("textbox", {
        name: "Dataset notes (optional)",
        exact: true
      })
    ).toHaveValue("Revision saved from the first tab.")
    await b.getByRole("button", { name: "Save response", exact: true }).click()
    await expect(b.getByRole("article").getByRole("status")).toContainText(
      "Comment saved"
    )
    const latestExample = (
      await db
        .select()
        .from(exercises)
        .where(
          and(
            eq(exercises.roundId, round.id),
            eq(exercises.userId, member.userId)
          )
        )
    )[0]
    assert.equal(
      (
        await db.select().from(responses).where(eq(responses.itemId, item.id))
      )[0].datasetExerciseRevisionId,
      latestExample.revisionId
    )
    pass(
      "Another tab's dataset change cannot silently attach unseen evidence to a comment"
    )
    await editor
      .getByRole("textbox", { name: "Dataset notes (optional)", exact: true })
      .fill("Another saved revision from the first tab.")
    await editor
      .getByRole("button", { name: "Save dataset example", exact: true })
      .click()
    await expect(editor.getByRole("status")).toContainText(
      "Dataset example saved"
    )
    await secondEditor
      .getByRole("textbox", { name: "Dataset notes (optional)", exact: true })
      .fill("Unsaved second-tab explanation.")
    await secondEditor
      .getByRole("button", { name: "Save dataset example", exact: true })
      .click()
    await expect(
      secondEditor.getByRole("button", { name: "Reload saved dataset example" })
    ).toBeVisible()
    await expect(
      secondEditor.getByRole("textbox", {
        name: "Dataset notes (optional)",
        exact: true
      })
    ).toHaveValue("Unsaved second-tab explanation.")
    await secondEditor
      .getByRole("button", { name: "Reload saved dataset example" })
      .click()
    await expect(
      secondEditor.getByRole("textbox", {
        name: "Dataset notes (optional)",
        exact: true
      })
    ).toHaveValue("Another saved revision from the first tab.")
    pass(
      "Two-tab conflict preserves unsaved text and explicitly reloads the saved dataset"
    )
    await b.close()
    const revisionCount = async () =>
      (
        await db
          .select()
          .from(exerciseEvents)
          .where(eq(exerciseEvents.roundId, round.id))
      ).length
    const countBefore = await revisionCount()
    loseNextSaveResponse = true
    await editor
      .getByRole("textbox", { name: "Dataset notes (optional)", exact: true })
      .fill("Recovered after a lost save response.")
    await editor
      .getByRole("button", { name: "Save dataset example", exact: true })
      .click()
    await expect(editor.getByRole("alert")).toBeVisible()
    a.once("dialog", (dialog) => dialog.accept())
    await a.reload()
    await expect(
      editor.getByRole("textbox", {
        name: "Dataset notes (optional)",
        exact: true
      })
    ).toHaveValue("Recovered after a lost save response.")
    await editor
      .getByRole("button", { name: "Save dataset example", exact: true })
      .click()
    await expect(editor.getByRole("status")).toContainText(
      "Dataset example saved"
    )
    assert.equal(await revisionCount(), countBefore + 1)
    pass(
      "Interrupted save survives reload and retries without duplicate dataset revisions"
    )
    await a.setViewportSize({ width: 320, height: 844 })
    assert.ok(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    )
    for (const [label, filename] of [
      ["Completed metadata XML", "dataset-mobile-xml.png"],
      ["Your name", "dataset-mobile-identity.png"]
    ]) {
      const input = editor.getByRole("textbox", { name: label, exact: true })
      await input.scrollIntoViewIfNeeded()
      await expect(input).toBeInViewport()
      assert.equal(
        await input.evaluate((element) => getComputedStyle(element).visibility),
        "visible"
      )
      await a.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done()))
          )
      )
      await a.screenshot({ path: resolve(output, filename), fullPage: false })
    }
    await a.evaluate(() => window.scrollTo(0, 0))
    await a.screenshot({
      path: resolve(output, "dataset-mobile.png"),
      fullPage: true
    })
    await editor
      .getByRole("textbox", { name: "Dataset notes (optional)", exact: true })
      .fill("Saved while returning to the community.")
    await a
      .getByRole("navigation", { name: "Community workspace", exact: true })
      .getByRole("link", { name: "Quick start", exact: true })
      .click()
    await expect(a).toHaveURL(/view=quickstart/)
    await a.goto(href)
    await editor.locator("summary").first().click()
    await expect(
      editor.getByRole("textbox", {
        name: "Dataset notes (optional)",
        exact: true
      })
    ).toHaveValue("Saved while returning to the community.")
    pass("Mobile form fits and community navigation waits for the dataset save")

    await staff.goto(
      base +
        communityReviewHref(member.communitySlug, round.id, "pf") +
        "&manage=1"
    )
    await expect(
      staff.getByRole("cell", { name: "Comment only", exact: true })
    ).toBeVisible()
    await staff
      .locator("summary")
      .filter({ hasText: "Dataset examples (1)" })
      .click()
    await staff
      .locator("summary")
      .filter({ hasText: "Dendrite growth simulation" })
      .click()
    await expect(
      staff.getByText("Saved while returning to the community.", {
        exact: false
      })
    ).toBeVisible()
    await staff.screenshot({
      path: resolve(output, "steward-dataset-results.png"),
      fullPage: true
    })
    await staff
      .getByRole("button", { name: "Export review packet", exact: true })
      .click()
    const packetDialog = staff.getByRole("dialog", {
      name: "Review packet",
      exact: true
    })
    await expect(
      packetDialog.getByRole("checkbox", {
        name: "Include respondent names",
        exact: true
      })
    ).not.toBeChecked()
    await expect(
      packetDialog.getByRole("checkbox", { name: /^Include dataset examples/ })
    ).not.toBeChecked()
    await packetDialog
      .getByRole("checkbox", { name: /^Include dataset examples/ })
      .check()
    await expect(
      packetDialog.getByText(/1 dataset example revisions included/)
    ).toBeVisible()
    const packetDownloadPromise = staff.waitForEvent("download")
    await packetDialog
      .getByRole("button", { name: "Download JSON", exact: true })
      .click()
    const packetDownload = await packetDownloadPromise
    const packet = JSON.parse(
      await readFile((await packetDownload.path())!, "utf8")
    )
    assert.equal(packet.includeDatasetExamples, true)
    assert.equal(packet.includeRespondentNames, false)
    assert.equal(packet.datasetExamples.length, 1)
    const packetExample = packet.datasetExamples[0]
    assert.equal(packetExample.revisionId, latestExample.revisionId)
    assert.equal(packetExample.notes, "Revision saved from the first tab.")
    assert.equal(
      packetExample.completedXml,
      "<metadata><pf>FILL</pf></metadata>"
    )
    assert.equal(packetExample.referenceReleaseId, source.releaseId)
    assert.equal(packetExample.profile, "pf")
    assert.equal("reviewerName" in packetExample, false)
    assert.equal("reviewerAffiliation" in packetExample, false)
    assert.deepEqual(packet.items[0].feedback[0].datasetExerciseRevisionIds, [
      latestExample.revisionId
    ])
    await staff.keyboard.press("Escape")
    pass(
      "Steward exports the exact feedback-linked dataset XML with examples opted in and respondent identity omitted"
    )
    const queryInput = encodeURIComponent(
      JSON.stringify({ 0: { id: round.id } })
    )
    const deniedResults = await participantContext.request.get(
      `${base}/api/trpc/communityReviews.exerciseResults?batch=1&input=${queryInput}`
    )
    assert.equal(deniedResults.status(), 403)
    pass(
      "Stewards see attributed examples and comment-only results; members cannot query others' examples"
    )
    const otherContext = await browser.newContext()
    await signInAs(otherContext, base, other.userId)
    await guard(otherContext)
    const outsider = await otherContext.newPage()
    monitor(outsider)
    await outsider.goto(href)
    await expect(
      outsider.getByRole("region", { name: "Dataset example", exact: true })
    ).toHaveCount(0)
    await db.insert(members).values({
      communityId: member.communityId,
      userId: other.userId,
      role: "member",
      addedById: steward.userId
    })
    await outsider.reload()
    await expect(
      outsider.getByLabel("Dataset title", { exact: true })
    ).toHaveValue("")
    await expect(
      outsider.getByText("Dendrite growth simulation", { exact: true })
    ).toHaveCount(0)
    pass(
      "Private community blocks outsiders and a second member sees only their own blank example"
    )
    assert.deepEqual(blocked, [])
    assert.deepEqual(errors, [])
  } catch (error) {
    failure = error
    if (browser)
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
  } finally {
    if (browser) await closeBrowserAfterRoutes(browser)
    for (const fixture of fixtures)
      await db.transaction(async (tx) => {
        const ids = (
          await tx
            .select()
            .from(rounds)
            .where(eq(rounds.communityId, fixture.communityId))
        ).map((row) => row.id)
        if (ids.length) {
          const itemIds = (
            await tx.select().from(items).where(inArray(items.roundId, ids))
          ).map((row) => row.id)
          if (itemIds.length) {
            await tx.delete(events).where(inArray(events.itemId, itemIds))
            await tx.delete(responses).where(inArray(responses.itemId, itemIds))
          }
          await tx.delete(exercises).where(inArray(exercises.roundId, ids))
          await tx
            .delete(exerciseEvents)
            .where(inArray(exerciseEvents.roundId, ids))
          await tx.delete(items).where(inArray(items.roundId, ids))
          await tx.delete(rounds).where(inArray(rounds.id, ids))
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
        await tx.delete(members).where(
          and(
            eq(members.communityId, fixture.communityId),
            inArray(
              members.userId,
              fixtures
                .filter((other) => other.userId !== fixture.userId)
                .map((row) => row.userId)
            )
          )
        )
      })
    if (source && fixtures[0])
      await removeSyntheticUiSource(
        fixtures[0],
        source.created,
        source.releaseId
      )
    for (const fixture of fixtures.reverse())
      await removeGuidedSetupFixture(fixture)
    assert.deepEqual(
      await reviewFingerprints(),
      before,
      "All original records remain unchanged"
    )
    pass(
      "Disposable fixtures removed and every original table fingerprint preserved"
    )
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
  console.log(`Dataset exercise UI tests passed (${passed.length} checks)`)
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
