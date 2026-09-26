// Requires a running local SAM preview and its local database. Provider,
// assistant catalog and publication calls are answered locally. Only the owned
// fixtures touch the DB.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { expect } from "@playwright/test"
import { db } from "../drizzle"
import { eq } from "drizzle-orm"
import { studiesTable } from "../drizzle"
import {
  chebiLookup,
  createStudyFixture,
  createTermFixture,
  launchBrowser,
  localPreviewBase,
  rememberView,
  removeStudyFixture,
  removeTermFixture,
  signInAs,
  stubTrpc,
  type StudyFixture,
  type TermFixture
} from "./ui-test-harness"

async function main() {
  const base = localPreviewBase()
  const stamp = randomUUID()
  const assistantLabel = "Test assistant"
  const modelDraft = "A model draft returned by the Simple view test."
  const browser = await launchBrowser()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 }
  })
  const page = await context.newPage()
  const unexpected: string[] = []
  const errors: string[] = []
  let lookups = 0
  let suggestions = 0
  let fixture: TermFixture | undefined
  let study: StudyFixture | undefined
  page.on("pageerror", (error) => errors.push(error.message))
  await stubTrpc(context, {
    unexpected,
    queries: {
      // The helper names the assistant, so the catalog is fixed here.
      "definitionAssistants.catalog": () => ({
        profiles: [
          {
            id: "default",
            label: assistantLabel,
            available: true,
            reason: null
          }
        ],
        defaultProfile: "default",
        preferredProfile: null,
        agentOne: {
          configured: false,
          enabled: false,
          validated: false,
          validatedAt: null
        }
      })
    },
    mutations: {
      "termReferences.recordAction": () => null,
      "termReferences.retrieveChebi": (input) => {
        lookups += 1
        return chebiLookup(
          String(input.term),
          "A source definition supplied by the test fixture."
        )
      },
      "aiAssist.suggestNewTerm": (input) => {
        suggestions += 1
        return {
          suggestionId: 900000 + suggestions,
          definition: modelDraft,
          model: "test-model",
          assistantProfile: "default",
          assistantLabel,
          inference: null,
          referenceCount: 0,
          referenceInputs: [],
          requestInputs: {
            userPrompt: "Stubbed by the UI test",
            definition: input.context ?? null,
            example: null
          }
        }
      }
    }
  })

  const tab = (name: "Simple" | "Advanced") =>
    page.getByRole("tab", { name, exact: true })
  const hiddenText = (text: string) =>
    expect(page.getByText(text, { exact: true })).toBeHidden()
  const history = page.getByRole("heading", { name: "Revision history" })

  try {
    fixture = await createTermFixture({
      userName: `Simple view test ${stamp}`,
      term: `simple view ${stamp}`,
      slug: `simple_view_${stamp}`,
      definition: "A fixture definition for the Simple view test."
    })

    // A first visit opens in Simple, which reports what exists only.
    await page.goto(`${base}${fixture.termPath}`, { waitUntil: "networkidle" })
    await expect(tab("Simple")).toHaveAttribute("aria-selected", "true")
    await hiddenText("No citations attached")
    for (const name of ["Revision history", "Definition 1 · revision 1"])
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0)
    for (const name of ["Discussion", "Open definition", "Propose a change"])
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible()

    await tab("Advanced").click()
    await expect(
      page.getByText("No citations attached", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Revision history", exact: true })
    ).toBeVisible()

    // The server renders the remembered choice on the next load.
    await page.reload({ waitUntil: "networkidle" })
    await expect(tab("Advanced")).toHaveAttribute("aria-selected", "true")
    await expect(
      page.getByText("No citations attached", { exact: true })
    ).toBeVisible()
    await tab("Simple").click()
    await page.reload({ waitUntil: "networkidle" })
    await expect(tab("Simple")).toHaveAttribute("aria-selected", "true")

    // The definition page offers the same views.
    await page.goto(`${base}${fixture.path}`, { waitUntil: "networkidle" })
    await expect(tab("Simple")).toHaveAttribute("aria-selected", "true")
    await expect(page.getByText(/its metadata record/)).toBeHidden()
    await hiddenText("Initial publication")
    await expect(history).toHaveCount(0)
    const exampleInput = page.getByRole("textbox", { name: "Add example" })
    await expect(exampleInput).toHaveCount(0)
    await page
      .getByRole("button", { name: "Add an example", exact: true })
      .click()
    await expect(exampleInput).toBeFocused()
    await expect(page.locator("#tags-heading")).toHaveCount(0)
    await tab("Advanced").click()
    await expect(history).toBeVisible()
    await expect(page.getByText(/its metadata record/)).toBeVisible()
    await expect(
      page.getByText("No tags assigned", { exact: true })
    ).toBeVisible()
    await tab("Simple").click()

    // A link to Advanced-only detail opens Advanced for that visit only.
    await page.goto(`${base}${fixture.path}#revision-history-heading`, {
      waitUntil: "networkidle"
    })
    await expect(tab("Advanced")).toHaveAttribute("aria-selected", "true")
    await expect(history).toBeInViewport()
    await tab("Simple").click()
    await expect(history).toHaveCount(0)
    await page.evaluate(() => {
      window.location.hash = "discussion"
      window.location.hash = "revision-history-heading"
    })
    await expect(tab("Advanced")).toHaveAttribute("aria-selected", "true")
    await expect(history).toBeInViewport()
    await page.goto(`${base}${fixture.termPath}`, { waitUntil: "networkidle" })
    await expect(tab("Simple")).toHaveAttribute("aria-selected", "true")

    // Choosing the tab that a link opened keeps that view.
    await page.goto(`${base}${fixture.path}#revision-history-heading`, {
      waitUntil: "networkidle"
    })
    await expect(tab("Advanced")).toHaveAttribute("aria-selected", "true")
    await tab("Advanced").click()
    await page.goto(`${base}${fixture.termPath}`, { waitUntil: "networkidle" })
    await expect(tab("Advanced")).toHaveAttribute("aria-selected", "true")

    await signInAs(context, base, fixture.userId)

    // Simple metadata describes the whole term, without scope or source.
    await rememberView(context, base, "simple")
    await page.goto(`${base}/terms/${fixture.termId}/metadata`, {
      waitUntil: "networkidle"
    })
    await expect(
      page.getByRole("heading", { name: "Add metadata" })
    ).toBeVisible()
    await expect(page.getByLabel("What does this describe?")).toHaveCount(0)
    await expect(page.getByText("Source (optional)")).toHaveCount(0)
    await hiddenText("No additional metadata has been published.")
    await expect(
      page.getByRole("heading", { name: "Already recorded" })
    ).toHaveCount(0)
    const submit = page.getByRole("button", { name: "Submit for review" })
    await expect(submit).toBeDisabled()
    await page
      .getByLabel("Usage guidance")
      .fill("A usage note typed by the Simple view test.")
    await expect(submit).toBeEnabled()
    await tab("Advanced").click()
    const scope = page.getByLabel("What does this describe?")
    await expect(scope).toHaveValue("term")
    await expect(page.getByText("Source (optional)")).toBeVisible()
    await scope.selectOption({ label: "Definition 1 · Revision 1" })
    await page.getByText("Source (optional)").click()
    await page.getByLabel("Source link").fill("not a link")
    await tab("Simple").click()
    await expect(
      page.getByText("Also included from Advanced: Definition 1, a source.", {
        exact: true
      })
    ).toBeVisible()
    // A value only Advanced shows is checked here and named here.
    await submit.click()
    await expect(
      page.getByRole("alert").filter({ hasText: "Open Advanced to change it." })
    ).toHaveText(
      "Enter a complete http or https source identifier. Open Advanced to change it."
    )
    assert.ok(
      !unexpected.includes("termMetadata.add"),
      "an invalid source must not reach the server"
    )

    // Simple Add keeps example files and a cut-down assistant.
    await page.goto(
      `${base}/add?term=${encodeURIComponent(`simple add ${stamp}`)}`,
      { waitUntil: "networkidle" }
    )
    await page
      .getByRole("button", { name: "Confirm term", exact: true })
      .click()
    await expect(
      page.getByRole("button", { name: "Review definition" })
    ).toBeVisible()
    await page.waitForTimeout(500)
    assert.equal(lookups, 0, "Simple starts no lookup")
    await expect(
      page.getByRole("button", { name: "Add a citation" })
    ).toHaveCount(0)
    const exampleFile = page.getByRole("button", {
      name: "Attach an example file",
      exact: true
    })
    await exampleFile.click()
    const filePanel = page.getByRole("region", {
      name: "Attach an example file"
    })
    await expect(
      filePanel.getByRole("button", { name: "Attach example", exact: true })
    ).toBeVisible()
    await expect(page.getByLabel("Use as")).toBeHidden()
    await page
      .locator("[data-definition-toolbox]")
      .getByRole("button", { name: "Close tool" })
      .click()
    await expect(exampleFile).toBeFocused()
    await expect(exampleFile).toHaveAttribute("aria-expanded", "false")
    await page
      .getByRole("button", { name: "Help me write", exact: true })
      .click()
    const helper = page.getByRole("region", { name: "Help me write" })
    await expect(
      helper.getByText(`Sends the term to ${assistantLabel}.`, { exact: true })
    ).toBeVisible()
    await expect(
      helper.getByRole("button", { name: "Suggest a definition" })
    ).toBeVisible()
    await expect(page.getByLabel("Definition assistant")).toHaveCount(0)
    await expect(page.getByText("Inspect input text")).toHaveCount(0)
    await helper.getByRole("button", { name: "Close" }).click()
    await expect(
      page.getByRole("button", { name: "Help me write", exact: true })
    ).toBeFocused()
    const editor = page.getByRole("textbox", {
      name: "Definition",
      exact: true
    })
    await editor.fill("A definition typed by the Simple view test.")
    await page.getByRole("button", { name: "Review definition" }).click()
    const review = page.locator('section[aria-label="Review and publish"]')
    await expect(review).toBeVisible()
    for (const text of [
      "No example added.",
      "No model draft is applied to this contribution.",
      "No citations attached.",
      "Citations already attached"
    ])
      await expect(review.getByText(text, { exact: true })).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "Publish new term" })
    ).toBeVisible()
    await tab("Advanced").click()
    await expect(
      review.getByText("No citations attached.", { exact: true })
    ).toBeVisible()
    await expect(
      review.getByText("No model draft is applied to this contribution.", {
        exact: true
      })
    ).toBeVisible()

    // A citation added in Advanced stays visible at Simple review. The lookup
    // started when Advanced opened.
    await expect.poll(() => lookups).toBe(1)
    await page.getByRole("button", { name: "Back to writing" }).click()
    const references = page.locator('[aria-label="ChEBI reference resources"]')
    await expect(references).toBeVisible()
    await references
      .getByRole("button", { name: "Add to definition", exact: true })
      .click()
    await tab("Simple").click()
    await page.getByRole("button", { name: "Review definition" }).click()
    const removeCitation = review.getByRole("button", {
      name: "Remove citation: Reference test material",
      exact: true
    })
    await expect(removeCitation).toBeVisible()
    await expect(
      review.getByRole("button", { name: "Add a citation" })
    ).toHaveCount(0)
    await removeCitation.click()
    await expect(
      page.getByRole("heading", { name: "Review your contribution" })
    ).toBeFocused()
    await expect(review.getByText("Citations", { exact: true })).toHaveCount(0)
    assert.equal(lookups, 1, "a view change starts no second lookup")

    // The cut-down assistant previews, applies and credits a model draft.
    await page.goto(
      `${base}/add?term=${encodeURIComponent(`simple assist ${stamp}`)}`,
      { waitUntil: "networkidle" }
    )
    await page
      .getByRole("button", { name: "Confirm term", exact: true })
      .click()
    await editor.fill("My own starting sentence.")
    const help = page.getByRole("button", {
      name: "Help me write",
      exact: true
    })
    await help.click()
    await expect(help).toHaveAttribute("aria-expanded", "true")
    await expect(
      helper.getByText(
        `Sends the term and your definition draft to ${assistantLabel}.`,
        { exact: true }
      )
    ).toBeVisible()
    await helper.getByRole("button", { name: "Suggest a definition" }).click()
    await expect(
      helper.getByText(
        "Use this draft replaces your writing. Undo restores it.",
        { exact: true }
      )
    ).toBeVisible()
    await expect(
      helper.getByText(`Drafted by ${assistantLabel}.`, { exact: true })
    ).toBeVisible()
    await expect(page.getByText("Inspect input text")).toHaveCount(0)
    await helper.getByRole("button", { name: "Use this draft" }).click()
    await expect(editor).toHaveValue(modelDraft)
    await expect(help).toBeDisabled()
    await expect(help).toHaveAttribute("aria-expanded", "false")
    await expect(helper).toHaveCount(0)
    await expect(page.getByText(/references? (was|were) included/)).toHaveCount(
      0
    )
    await page.getByRole("button", { name: "Review definition" }).click()
    await expect(
      review.getByText(
        `Drafted with ${assistantLabel}. Model attribution stays with this contribution.`,
        { exact: true }
      )
    ).toBeVisible()
    await expect(review.getByText("Context for this request")).toHaveCount(0)
    await tab("Advanced").click()
    await expect(
      review.getByText(/These model inputs are recorded separately/)
    ).toBeVisible()
    await tab("Simple").click()
    assert.equal(suggestions, 1, "one model request should be made")

    // The change forms follow the page's view. Simple shows no source tools
    // and starts no lookup. Advanced shows them and starts one.
    await page.goto(`${base}${fixture.path}`, { waitUntil: "networkidle" })
    await expect(tab("Simple")).toHaveAttribute("aria-selected", "true")
    const beforeReplacement = lookups
    await page
      .getByRole("button", { name: "Propose a replacement", exact: true })
      .click()
    const viewReferences = page.getByRole("button", {
      name: "View references",
      exact: true
    })
    const reviewDefinition = page.getByRole("button", {
      name: "Review definition",
      exact: true
    })
    await expect(reviewDefinition).toBeVisible()
    await expect(viewReferences).toHaveCount(0)
    await page.waitForTimeout(500)
    assert.equal(
      lookups,
      beforeReplacement,
      "a Simple change form starts no lookup"
    )
    await tab("Advanced").click()
    await expect(viewReferences).toBeVisible()
    await expect.poll(() => lookups).toBe(beforeReplacement + 1)
    await tab("Simple").click()

    // A study fixes its interface. This one uses the Simple view.
    study = await createStudyFixture({ stamp, presentation: "simple" })
    await signInAs(context, base, study.userId)
    const beforeStudy = lookups
    await page.goto(`${base}/studies/${study.studySlug}/run`, {
      waitUntil: "networkidle"
    })
    await expect(page.getByRole("tab", { name: "Advanced" })).toHaveCount(0)
    await page
      .getByRole("button", { name: "Propose a new definition", exact: true })
      .click()
    await expect(reviewDefinition).toBeVisible()
    await expect(viewReferences).toHaveCount(0)
    await page
      .getByRole("button", { name: "Back to definitions", exact: true })
      .click()
    await page
      .getByRole("button", { name: "Suggest an alternative, option 1" })
      .click()
    await expect(
      page.getByText(
        `Sends the source definition and your feedback to ${assistantLabel}.`,
        { exact: true }
      )
    ).toBeVisible()
    await expect(page.getByLabel("Definition assistant")).toHaveCount(0)
    await expect(viewReferences).toHaveCount(0)
    await page.waitForTimeout(500)
    assert.equal(lookups, beforeStudy, "a Simple study starts no lookup")

    // The legacy interface keeps the full forms of the first studies.
    await db
      .update(studiesTable)
      .set({ presentation: "legacy" })
      .where(eq(studiesTable.id, study.studyId))
    await page.reload({ waitUntil: "networkidle" })
    await page
      .getByRole("button", { name: "Suggest an alternative, option 1" })
      .click()
    await expect(page.getByLabel("Definition assistant")).toBeVisible()
    await expect(viewReferences).toBeVisible()
    await expect.poll(() => lookups).toBe(beforeStudy + 1)

    assert.deepEqual(
      unexpected,
      [],
      "no publication or other mutation should be attempted"
    )
    assert.deepEqual(errors, [])
    console.log(
      "Simple view UI tests passed: remembered view, absent-state text, Advanced details, deep links, whole-term metadata and its checks, example files, cut-down assistant, citation review, change forms by view and a study's fixed interface."
    )
  } finally {
    try {
      await browser.close()
    } catch (error) {
      console.error(error)
    }
    try {
      if (study) await removeStudyFixture(study)
      if (fixture) await removeTermFixture(fixture)
    } finally {
      await db.$client.end()
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
