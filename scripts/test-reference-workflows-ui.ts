// Requires a running local SAM preview and its local database. Provider and
// publication mutations are intercepted. Only the owned fixtures touch the DB.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { expect, type Locator } from "@playwright/test"
import { db } from "../drizzle"
import {
  chebiLookup,
  createTermFixture,
  launchBrowser,
  localPreviewBase,
  removeTermFixture,
  signInAs,
  stubTrpc,
  type TermFixture
} from "./ui-test-harness"

async function main() {
  const base = localPreviewBase()
  const stamp = randomUUID()
  const sourceText = "A source definition supplied by the test fixture."
  const original = "A contributor's own draft."
  const browser = await launchBrowser()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 }
  })
  const page = await context.newPage()
  const unexpected: string[] = []
  const errors: string[] = []
  let lookups = 0
  let fixture: TermFixture | undefined
  page.on("pageerror", (error) => errors.push(error.message))
  await stubTrpc(context, {
    unexpected,
    mutations: {
      "termReferences.recordAction": () => null,
      "termReferences.retrieveChebi": (input) => {
        lookups += 1
        return chebiLookup(String(input.term), sourceText)
      }
    }
  })

  type EditorKind = "add" | "revision"
  const sourceAddedNotice =
    "Added to your definition with a citation. You can remove the citation during review."

  async function showReferences(scope: Locator, kind: EditorKind) {
    if (kind === "add") {
      await scope.getByRole("tab", { name: "Advanced", exact: true }).click()
      await expect(
        scope.getByText("ChEBI matching terms", { exact: true })
      ).toBeVisible()
    } else {
      await scope
        .getByRole("button", { name: "View references", exact: true })
        .click()
    }
    const references = scope.locator('[aria-label="ChEBI reference resources"]')
    await expect(references).toBeVisible()
    await expect(
      references.getByText("Reference test material", { exact: true })
    ).toBeVisible()
    return references
  }

  async function addSource(scope: Locator, kind: EditorKind) {
    const references = await showReferences(scope, kind)
    // Add reveals its first match automatically. Revision editing keeps the
    // deliberate reveal action. Scope the action to ChEBI, not adjacent tools.
    if (kind === "revision") {
      const reveal = references.getByRole("button", {
        name: "Show definition",
        exact: true
      })
      if (await reveal.count()) await reveal.click()
    }
    await references
      .getByRole("button", { name: "Add to definition", exact: true })
      .click()
    // Insertion selects the added text in a later frame. Wait for that focus
    // so a following fill replaces the whole value.
    await expect(
      scope.getByRole("textbox", { name: "Definition", exact: true })
    ).toBeFocused()
  }

  async function checkUndo(
    scope: Locator,
    undoName: string,
    reviewName: string,
    backName: string,
    kind: EditorKind
  ) {
    const editor = scope.getByRole("textbox", {
      name: "Definition",
      exact: true
    })
    const undo = scope.getByRole("button", { name: undoName, exact: true })
    await editor.fill(original)
    await addSource(scope, kind)
    await expect(editor).toHaveValue(`${original}\n\n${sourceText}`)
    await expect(undo).toBeVisible()
    if (kind === "add") {
      const beforeToggle = lookups
      await scope.getByRole("tab", { name: "Simple", exact: true }).click()
      await expect(editor).toHaveValue(`${original}\n\n${sourceText}`)
      await expect(undo).toBeVisible()
      await expect(
        scope.locator('[aria-label="ChEBI reference resources"]')
      ).toBeHidden()
      await scope.getByRole("tab", { name: "Advanced", exact: true }).click()
      await expect(editor).toHaveValue(`${original}\n\n${sourceText}`)
      assert.equal(
        lookups,
        beforeToggle,
        "changing views must reuse the source lookup"
      )
    }
    await undo.click()
    await expect(editor).toHaveValue(original)
    const references = await showReferences(scope, kind)
    await expect(
      references.getByText(sourceAddedNotice, { exact: true })
    ).toHaveCount(0)
    await expect(
      references.getByRole("button", {
        name: "Cite without inserting",
        exact: true
      })
    ).toBeEnabled()
    await addSource(scope, kind)
    const later = `${original}\n\n${sourceText}\nA sentence written afterward.`
    await editor.fill(later)
    await expect(undo).toHaveCount(0)
    await expect(editor).toHaveValue(later)
    await addSource(scope, kind)
    await expect(undo).toBeVisible()
    const withSecondSource = await editor.inputValue()
    await scope.getByRole("button", { name: reviewName, exact: true }).click()
    await scope
      .getByRole("button", {
        name: "Remove citation: Reference test material",
        exact: true
      })
      .click()
    await scope.getByRole("button", { name: backName, exact: true }).click()
    await expect(undo).toHaveCount(0)
    await expect(editor).toHaveValue(withSecondSource)
  }

  try {
    await page.goto(`${base}/discussion`, { waitUntil: "networkidle" })
    await expect(
      page.getByRole("heading", { name: "Discussion", exact: true })
    ).toBeVisible()
    assert.equal(lookups, 0, "anonymous reading must not start lookups")
    fixture = await createTermFixture({
      userName: `Reference UI test ${stamp}`,
      term: `reference ui ${stamp}`,
      slug: `reference_ui_${stamp}`,
      definition: original
    })
    await signInAs(context, base, fixture.userId)
    await page.goto(`${base}/discussion`, { waitUntil: "networkidle" })
    assert.equal(lookups, 0, "signed-in reading must not start lookups")
    await page
      .getByRole("button", { name: "Start an alternative", exact: true })
      .first()
      .click()
    await expect.poll(() => lookups).toBe(1)
    await page.goto(`${base}/add?term=undo%20test%20${stamp}`)
    // The label differs by view, and the view is a remembered choice.
    await page.getByRole("button", { name: /^Confirm term/ }).click()
    await checkUndo(
      page.locator("main"),
      "Undo source insertion",
      "Review definition",
      "Back to writing",
      "add"
    )
    await page.goto(`${base}${fixture.path}`)
    await page
      .getByRole("button", { name: "Create a new version", exact: true })
      .click()
    const dialog = page.getByRole("dialog")
    await dialog
      .getByRole("textbox", { name: "Change note", exact: true })
      .fill("Test an insertion and subsequent editing")
    await checkUndo(
      dialog,
      "Undo",
      "Review new version",
      "Back to editing",
      "revision"
    )
    assert.deepEqual(
      unexpected,
      [],
      "no publication or other mutation should be attempted"
    )
    assert.deepEqual(errors, [])
    console.log(
      "Reference UI tests passed: deliberate discussion lookup, immediate insertion Undo, preservation of later writing and citation choices in both editors."
    )
  } finally {
    try {
      await browser.close()
    } catch (error) {
      console.error(error)
    }
    try {
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
