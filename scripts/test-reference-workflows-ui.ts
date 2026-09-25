// Requires a running local SAM preview and its local database. Provider and
// publication mutations are intercepted. Only the owned fixtures touch the DB.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { chromium, expect, type Locator } from "@playwright/test"
import { sealData } from "iron-session"
import { eq } from "drizzle-orm"
import { db, termsTable, usersTable } from "../drizzle"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import { deleteDefinitionRows } from "../lib/definition-purge"
import {
  DEFAULT_VOCABULARY_SLUG,
  definitionPath
} from "../lib/public-identifiers"

async function main() {
  const base = process.env.SAM_UI_TEST_URL ?? "http://localhost:3000"
  const local = new Set(["localhost", "127.0.0.1", "[::1]"])
  assert.ok(
    local.has(new URL(base).hostname),
    "UI tests require a local preview"
  )
  assert.ok(
    local.has(new URL(process.env.DATABASE_URL!).hostname),
    "UI tests require a local database"
  )
  const stamp = randomUUID()
  const sourceText = "A source definition supplied by the test fixture."
  const original = "A contributor's own draft."
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--js-flags=--max-old-space-size=384"]
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 }
  })
  const page = await context.newPage()
  const unexpected: string[] = []
  const errors: string[] = []
  let lookups = 0
  let fixture:
    | { userId: number; termId: number; definitionId: number; path: string }
    | undefined
  page.on("pageerror", (error) => errors.push(error.message))
  await context.route("**/api/trpc/**", async (route) => {
    if (route.request().method() === "GET") return route.continue()
    const paths = new URL(route.request().url()).pathname
      .split("/api/trpc/")[1]
      .split(",")
    const inputs = route.request().postDataJSON() as Record<
      string,
      { term?: string }
    >
    const responses = paths.map((path, index) => {
      if (path === "termReferences.recordAction")
        return { result: { data: null } }
      if (path !== "termReferences.retrieveChebi") {
        unexpected.push(path)
        return {
          error: { message: "Mutation blocked by UI test", code: -32600 }
        }
      }
      lookups += 1
      const lookupId = randomUUID()
      return {
        result: {
          data: {
            lookupId,
            term: inputs[index].term!.trim().toLowerCase(),
            retrievedAt: new Date().toISOString(),
            references: [
              {
                id: randomUUID(),
                lookupId,
                term: "Reference test material",
                definition: sourceText,
                source: "ChEBI CORE",
                sourceKey: "chebi",
                sourceIri: "http://purl.obolibrary.org/obo/CHEBI_15377",
                version: "test",
                license: "CC-BY-4.0",
                kind: "definition",
                usageStatus: "open",
                contentHash: "a".repeat(64),
                copiedAt: null,
                addedToDraftAt: null
              }
            ]
          }
        }
      }
    })
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responses)
    })
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
    fixture = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(usersTable)
        .values({ name: `Reference UI test ${stamp}`, role: "user" })
        .returning()
      const [term] = await tx
        .insert(termsTable)
        .values({
          term: `reference ui ${stamp}`,
          slug: `reference_ui_${stamp}`,
          vocabularySlug: DEFAULT_VOCABULARY_SLUG
        })
        .returning()
      const { definition } = await createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: user.id,
        definition: original,
        example: "",
        changeNote: "UI test fixture",
        source: "initial"
      })
      return {
        userId: user.id,
        termId: term.id,
        definitionId: definition.id,
        path: definitionPath(
          term.slug,
          definition.definitionNumber,
          term.vocabularySlug
        )
      }
    })
    await context.addCookies([
      {
        name: "matsci-sam-session",
        value: await sealData(
          { id: fixture.userId },
          { password: process.env.SESSION_PASSWORD! }
        ),
        url: base,
        httpOnly: true,
        sameSite: "Lax"
      }
    ])
    await page.goto(`${base}/discussion`, { waitUntil: "networkidle" })
    assert.equal(lookups, 0, "signed-in reading must not start lookups")
    await page
      .getByRole("button", { name: "Start an alternative", exact: true })
      .first()
      .click()
    await expect.poll(() => lookups).toBe(1)
    await page.goto(`${base}/add?term=undo%20test%20${stamp}`)
    await page
      .getByRole("button", {
        name: "Confirm term and find references",
        exact: true
      })
      .click()
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
    await browser.close()
    try {
      if (fixture) {
        const owned = fixture
        await db.transaction(async (tx) => {
          const user = await tx.query.usersTable.findFirst({
            where: eq(usersTable.id, owned.userId)
          })
          assert.equal(user?.name, `Reference UI test ${stamp}`)
          await deleteDefinitionRows(tx, owned.definitionId)
          await tx.delete(termsTable).where(eq(termsTable.id, owned.termId))
          await tx.delete(usersTable).where(eq(usersTable.id, owned.userId))
        })
      }
    } finally {
      await db.$client.end()
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
