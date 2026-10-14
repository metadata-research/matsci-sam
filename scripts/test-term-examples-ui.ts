// A local reader walkthrough with owned database fixtures. No publication or
// provider calls are allowed. The examples use the real public list query.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { eq, inArray } from "drizzle-orm"
import { expect } from "@playwright/test"
import {
  contributionFilesTable,
  db,
  definitionExamplesTable,
  definitionsTable,
  usersTable
} from "../drizzle"
import { createDefinitionExample } from "../lib/definition-examples"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import { deleteDefinitionRows } from "../lib/definition-purge"
import {
  createTermFixture,
  launchBrowser,
  localPreviewBase,
  rememberView,
  removeTermFixture,
  stubTrpc,
  type TermFixture
} from "./ui-test-harness"

const DEFINITION =
  "A controlled heat treatment changes a material's microstructure and properties."
const HUMAN = "Annealing cold-worked copper can restore ductility."
const PRIVATE =
  "A researcher may anneal a specimen before measuring its response."
const MODEL =
  "A model-supplied example describes controlled heating and cooling."
const LEGACY =
  "An imported example whose original contributor was not recorded."
const ATTACHED = "An owner-supplied example with a published file attachment."
const WITHDRAWN = "A withdrawn example that readers must not see."
const ALTERNATIVE =
  "An alternative definition used to check the expanded reader."
const RANKING =
  "Default definition. Shown first by net votes. Ties favor newer definitions."

async function main() {
  const base = localPreviewBase()
  const stamp = randomUUID()
  const browser = await launchBrowser()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 }
  })
  const page = await context.newPage()
  const errors: string[] = []
  const unexpected: string[] = []
  const extraUsers: number[] = []
  const extraDefinitions: number[] = []
  const exampleRequests: string[] = []
  let fixture: TermFixture | undefined
  page.on("pageerror", (error) => errors.push(error.message))
  context.on("request", (request) => {
    if (request.url().includes("examples.list"))
      exampleRequests.push(request.url())
  })
  await stubTrpc(context, {
    unexpected,
    mutations: {},
    queries: {
      "ontologyContext.candidates": (input) => ({
        query: input.term,
        mode: input.mode,
        sources: []
      })
    }
  })
  const tab = (name: "Simple" | "Advanced") =>
    page.getByRole("tab", { name, exact: true })
  const output = process.env.SAM_UI_TEST_SCREENSHOTS
  if (output) await mkdir(output, { recursive: true })

  try {
    fixture = await createTermFixture({
      userName: `Example reader owner ${stamp}`,
      term: "Example reader review",
      slug: `example_reader_${stamp}`,
      definition: DEFINITION
    })
    const definition = await db.query.definitionsTable.findFirst({
      where: eq(definitionsTable.id, fixture.definitionId)
    })
    assert.ok(definition?.currentRevisionId)
    const revisionId = definition.currentRevisionId
    const card = page.locator(
      `section[aria-labelledby="default-definition-${fixture.definitionId}"]`
    )
    const exampleSection = card.getByRole("region", { name: /^Examples?$/ })

    await rememberView(context, base, "simple")
    await page.goto(`${base}${fixture.termPath}`, { waitUntil: "networkidle" })
    await expect(card.getByText(DEFINITION, { exact: true })).toBeVisible()
    await expect(exampleSection).toHaveCount(0)
    await expect(card.getByText(/Featured/)).toHaveCount(0)

    const [publicAuthor, privateAuthor, modelAuthor] = await db
      .insert(usersTable)
      .values([
        { name: `Public example contributor ${stamp}`, isProfilePublic: true },
        {
          name: `Private example contributor ${stamp}`,
          isProfilePublic: false
        },
        { name: `Example model ${stamp}`, isAi: true }
      ])
      .returning()
    extraUsers.push(publicAuthor.id, privateAuthor.id, modelAuthor.id)
    const createExample = (
      text: string,
      authorId = publicAuthor.id,
      targetId = fixture!.definitionId,
      targetRevision = revisionId
    ) =>
      db.transaction((tx) =>
        createDefinitionExample(tx, {
          definitionId: targetId,
          sourceRevisionId: targetRevision,
          text,
          authorId,
          actorKind: "human"
        })
      )
    await createExample(HUMAN)
    await page.reload({ waitUntil: "networkidle" })
    await expect(
      exampleSection.getByRole("heading", { name: "Example", exact: true })
    ).toBeVisible()
    await expect(exampleSection.getByText(HUMAN, { exact: true })).toBeVisible()
    await expect(
      exampleSection.getByRole("link", {
        name: publicAuthor.name!,
        exact: true
      })
    ).toHaveAttribute("href", `/people/${publicAuthor.id}`)
    await expect(card.getByText(/Featured/)).toHaveCount(0)

    await createExample(PRIVATE, privateAuthor.id)
    await db.transaction((tx) =>
      createDefinitionExample(tx, {
        definitionId: fixture!.definitionId,
        sourceRevisionId: revisionId,
        text: MODEL,
        authorId: modelAuthor.id,
        actorKind: "model",
        generation: {
          promptKey: null,
          promptHash: "example-render-test",
          promptText: "Supply an example.",
          model: "test-model:1"
        }
      })
    )
    const withdrawn = await createExample(WITHDRAWN)
    await db
      .update(definitionExamplesTable)
      .set({ withdrawnAt: new Date().toISOString() })
      .where(eq(definitionExamplesTable.id, withdrawn.example.id))
    await db.insert(definitionExamplesTable).values({
      definitionId: fixture.definitionId,
      sourceRevisionId: revisionId,
      exampleNumber: 1000,
      text: LEGACY,
      legacyBackfill: true
    })
    const attachedExample = await createExample(ATTACHED, fixture.userId)
    const fileDate = new Date().toISOString()
    const [attachment] = await db
      .insert(contributionFilesTable)
      .values({
        uploadedById: fixture.userId,
        termText: "example reader review",
        vocabularySlug: "matsci-sam",
        filename: "annealing-example.png",
        mediaType: "image/png",
        byteSize: 1,
        bytes: Buffer.from([0]),
        contentHash: "a".repeat(64),
        role: "example",
        title: "Annealing example attachment",
        caption: ATTACHED,
        createdAt: fileDate
      })
      .returning({ id: contributionFilesTable.id })
    await db
      .update(contributionFilesTable)
      .set({
        publishedAt: fileDate,
        publishedRevisionId: revisionId,
        exampleId: attachedExample.example.id
      })
      .where(eq(contributionFilesTable.id, attachment.id))
    await db
      .update(definitionsTable)
      .set({ score: 10 })
      .where(eq(definitionsTable.id, fixture.definitionId))
    const alternative = await db.transaction((tx) =>
      createDefinitionWithInitialRevision(tx, {
        termId: fixture!.termId,
        authorId: privateAuthor.id,
        definition: ALTERNATIVE,
        example: "",
        initialExample: "The first example of the alternative.",
        changeNote: "UI example reader fixture",
        source: "initial"
      })
    )
    extraDefinitions.push(alternative.definition.id)
    await createExample(
      "The second example of the alternative.",
      privateAuthor.id,
      alternative.definition.id,
      alternative.revision.id
    )

    for (const view of ["Simple", "Advanced"] as const) {
      for (const viewport of [
        { width: 1280, height: 1000 },
        { width: 390, height: 844 }
      ]) {
        await page.setViewportSize(viewport)
        await rememberView(
          context,
          base,
          view === "Simple" ? "simple" : "advanced"
        )
        await page.goto(`${base}${fixture.termPath}`, {
          waitUntil: "networkidle"
        })
        await expect(tab(view)).toHaveAttribute("aria-selected", "true")
        await expect(
          exampleSection.getByRole("heading", { name: "Examples", exact: true })
        ).toBeVisible()
        for (const text of [HUMAN, PRIVATE, MODEL, LEGACY, ATTACHED])
          await expect(
            exampleSection.getByText(text, { exact: true })
          ).toBeVisible()
        await expect(card.getByText(WITHDRAWN, { exact: true })).toHaveCount(0)
        await expect(card.getByText(/Featured/)).toHaveCount(0)
        await expect(
          card.getByRole("link", { name: /View all examples/ })
        ).toHaveCount(0)
        await expect(
          exampleSection.getByRole("link", {
            name: "Annealing example attachment",
            exact: true
          })
        ).toHaveAttribute("href", `/api/contribution-files/${attachment.id}`)
        const privateItem = exampleSection
          .locator("li")
          .filter({ has: page.getByText(PRIVATE, { exact: true }) })
        await expect(
          privateItem.getByText(privateAuthor.name!, { exact: true })
        ).toBeVisible()
        await expect(
          privateItem.getByRole("link", {
            name: privateAuthor.name!,
            exact: true
          })
        ).toHaveCount(0)
        const modelItem = exampleSection
          .locator("li")
          .filter({ has: page.getByText(MODEL, { exact: true }) })
        await expect(
          modelItem.getByText(modelAuthor.name!, { exact: true })
        ).toBeVisible()
        const legacyItem = exampleSection
          .locator("li")
          .filter({ has: page.getByText(LEGACY, { exact: true }) })
        await expect(legacyItem.getByText(/Added by/)).toHaveCount(0)
        if (view === "Advanced") {
          await expect(
            modelItem.getByText("test-model:1", { exact: true })
          ).toBeVisible()
          await expect(
            legacyItem.getByText("Origin and contribution date not recorded", {
              exact: true
            })
          ).toBeVisible()
        } else {
          await expect(
            modelItem.getByText("test-model:1", { exact: true })
          ).toBeHidden()
          await expect(
            legacyItem.getByText("Origin and contribution date not recorded", {
              exact: true
            })
          ).toBeHidden()
        }
        const text = card.getByText(DEFINITION, { exact: true })
        const ranking = card.getByText(RANKING, { exact: true })
        await expect(ranking).toBeVisible()
        const rankingNode = await ranking.elementHandle()
        assert.ok(rankingNode)
        assert.ok(
          await text.evaluate(
            (node, later) =>
              !!(
                node.compareDocumentPosition(later!) &
                Node.DOCUMENT_POSITION_FOLLOWING
              ),
            rankingNode
          )
        )
        const textBox = await text.boundingBox()
        const rankBox = await ranking.boundingBox()
        assert.ok(textBox && rankBox && textBox.y + textBox.height < rankBox.y)
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
          ),
          false
        )
        if (output)
          await card.screenshot({
            path: `${output}/term-examples-${view.toLowerCase()}-${viewport.width}.png`,
            animations: "disabled"
          })
        const alternativeCard = page
          .getByRole("article")
          .filter({ hasText: ALTERNATIVE })
        const beforeExpand = exampleRequests.length
        await alternativeCard
          .getByRole("button", { name: "Show definition", exact: true })
          .click()
        await expect(
          alternativeCard.getByRole("heading", {
            name: "Examples",
            exact: true
          })
        ).toBeVisible()
        for (const value of [
          "The first example of the alternative.",
          "The second example of the alternative."
        ])
          await expect(
            alternativeCard.getByText(value, { exact: true })
          ).toBeVisible()
        assert.ok(
          exampleRequests.length > beforeExpand,
          "expanded alternative loads its examples"
        )
        await expect(alternativeCard.getByText(/Featured/)).toHaveCount(0)
        await alternativeCard
          .getByRole("button", { name: "Hide definition", exact: true })
          .click()
        await expect(
          alternativeCard.getByText("The first example of the alternative.", {
            exact: true
          })
        ).toBeHidden()
        const beforeReopen = exampleRequests.length
        await alternativeCard
          .getByRole("button", { name: "Show definition", exact: true })
          .click()
        await expect(
          alternativeCard.getByText("The second example of the alternative.", {
            exact: true
          })
        ).toBeVisible()
        assert.equal(
          exampleRequests.length,
          beforeReopen,
          "reopening reuses the example list"
        )
        if (output && viewport.width === 390)
          await alternativeCard.screenshot({
            path: `${output}/term-alternative-examples-${view.toLowerCase()}-390.png`,
            animations: "disabled"
          })
      }
    }
    assert.deepEqual(errors, [], "no page errors")
    assert.deepEqual(unexpected, [], "no publication or other writes")
    console.log(
      "Term example UI checks passed: zero/one/many, all active examples, withdrawn omission, separate public/private/model/legacy credit, attachment links, definition-before-ranking, lazy alternatives and Simple/Advanced at desktop/narrow widths."
    )
  } finally {
    await browser.close()
    const fileOwners = [...extraUsers, ...(fixture ? [fixture.userId] : [])]
    if (fileOwners.length)
      await db
        .delete(contributionFilesTable)
        .where(inArray(contributionFilesTable.uploadedById, fileOwners))
    if (fixture) {
      if (extraDefinitions.length)
        await db.transaction(async (tx) => {
          for (const id of extraDefinitions) await deleteDefinitionRows(tx, id)
        })
      await removeTermFixture(fixture)
    }
    if (extraUsers.length)
      await db.delete(usersTable).where(inArray(usersTable.id, extraUsers))
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
