// Focused rendered regressions against an already-running local preview.
// Browser plugin not available: use the project's bounded Playwright harness.
// Only uniquely owned disposable fixtures and their private draft updates are
// real writes. Creation acknowledgements and every provider response are local.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  expect as playwrightExpect,
  type Browser,
  type Page
} from "@playwright/test"
import { eq } from "drizzle-orm"
import {
  aiContributionSuggestionsTable,
  db,
  termDraftsTable,
  termReferenceEntriesTable,
  termReferenceLookupsTable,
  usersTable
} from "../drizzle"
import { emptyTermDraftPayload } from "../lib/term-draft-types"
import {
  createGuidedSetupFixture,
  removeGuidedSetupFixture
} from "./guided-setup-ui-fixture"
import {
  closeBrowserAfterRoutes,
  launchBrowser,
  localPreviewBase,
  rememberView,
  signInAs,
  stubTrpc
} from "./ui-test-harness"

const expect = playwrightExpect.configure({ timeout: 20000 })

async function main() {
  const base = localPreviewBase()
  assert.ok(process.env.SESSION_PASSWORD)
  const fixture = await createGuidedSetupFixture()
  const output = resolve(
    process.env.SAM_UI_TEST_OUTPUT_DIR ??
      `${tmpdir()}/matsci-display-regressions-${fixture.token}`
  )
  const gemmaDraftId = randomUUID()
  const referenceDraftId = randomUUID()
  const term = `display regression ${fixture.token}`
  const original = "A contributor's original definition."
  const generated = "A model suggestion stored as owned test evidence."
  const wolframText = [
    "Input interpretation:",
    "silicon (element)",
    "",
    "General properties:",
    "atomic number | 14",
    "crystal structure | diamond cubic",
    "Image:",
    "",
    "Periodic table location:",
    "Image:"
  ].join("\n")
  const results: string[] = []
  const errors: string[] = []
  const unexpected: string[] = []
  const screenshots: string[] = []
  let browser: Browser | undefined
  let failurePage: Page | undefined
  let releaseOptions: (() => void) | undefined
  let optionsHeld = false
  let optionsGate: Promise<void> | undefined
  let holdNextOptions = false
  let failure: unknown
  let cleaned = false

  try {
    await mkdir(output, { recursive: true })
    const receipts = await db.transaction(async (tx) => {
      // Setup hydrates fresh server data for 30 seconds. Grant creation rights
      // to this disposable account on the server, rather than relying on an
      // initial client query that may not run. Browser admin writes stay mocked.
      await tx
        .update(usersTable)
        .set({ role: "admin" })
        .where(eq(usersTable.id, fixture.userId))
      const [suggestion] = await tx
        .insert(aiContributionSuggestionsTable)
        .values({
          intent: "new_term",
          requestedById: fixture.userId,
          vocabularySlug: fixture.vocabularySlug,
          termText: term,
          suggestedDefinition: generated,
          promptKey: "display-ui-fixture",
          promptHash: "a".repeat(64),
          promptText: "A synthetic saved suggestion; no model was called.",
          model: "gemma4:26b",
          inputDefinition: original,
          userPrompt: "Synthetic UI evidence"
        })
        .returning()
      const payload = {
        ...emptyTermDraftPayload(fixture.vocabularySlug),
        term,
        definition: original,
        editorState: {
          step: "write" as const,
          confirmed: { term, vocabularySlug: fixture.vocabularySlug },
          references: [],
          preview: {
            suggestionId: suggestion.id,
            term,
            contextKey: `${term}:${fixture.vocabularySlug}:::`,
            // This intentionally stale label must be replaced by server evidence.
            assistantLabel: "gemma4:26b",
            baseline: { definition: original, references: [] },
            promptInputs: []
          },
          appliedDraft: null,
          undo: null,
          includeDefinition: true,
          includeExample: false,
          assistantOpen: true,
          assistantProfile: "default" as const
        }
      }
      await tx.insert(termDraftsTable).values([
        {
          id: gemmaDraftId,
          ownerId: fixture.userId,
          creationHash: "a".repeat(64),
          payload
        },
        {
          id: referenceDraftId,
          ownerId: fixture.userId,
          creationHash: "b".repeat(64),
          payload: {
            ...payload,
            editorState: {
              ...payload.editorState,
              preview: null,
              assistantOpen: false
            }
          }
        }
      ])
      const [emptyReferenceReceipt] = await tx
        .insert(termReferenceLookupsTable)
        .values({ requestedById: fixture.userId, termText: term })
        .returning()
      const [receipt] = await tx
        .insert(termReferenceLookupsTable)
        .values({
          requestedById: fixture.userId,
          termText: term,
          provider: "wolfram"
        })
        .returning()
      const [reference] = await tx
        .insert(termReferenceEntriesTable)
        .values({
          lookupId: receipt.id,
          term,
          definition: wolframText,
          source: "Wolfram|Alpha",
          sourceKey: "wolfram",
          sourceIri: "https://www.wolframalpha.com/input?i=silicon",
          kind: "context",
          usageStatus: "prototype",
          version: "UI fixture",
          contentHash: "c".repeat(64)
        })
        .returning()
      return {
        chebi: {
          lookupId: emptyReferenceReceipt.id,
          term,
          retrievedAt: emptyReferenceReceipt.retrievedAt,
          references: []
        },
        wolfram: {
          lookupId: receipt.id,
          term,
          retrievedAt: receipt.retrievedAt,
          references: [{ ...reference, copiedAt: null, addedToDraftAt: null }]
        }
      }
    })
    browser = await launchBrowser()
    const context = await browser.newContext({
      viewport: { width: 1365, height: 1000 }
    })
    await signInAs(context, base, fixture.userId)
    await rememberView(context, base, "simple")
    const community = {
      id: 900000001,
      slug: `created_community_${fixture.token}`,
      title: "New test community",
      vocabularySlug: `created_community_${fixture.token}`,
      canContribute: true,
      canManageWorklist: false
    }
    const communityVocabulary = {
      slug: community.slug,
      title: community.title,
      communityId: community.id,
      canContribute: true
    }
    const vocabulary = {
      slug: `created_vocabulary_${fixture.token}`,
      title: "New test vocabulary",
      communityId: null,
      canContribute: true
    }
    const collection = {
      id: 900000002,
      slug: `created_collection_${fixture.token}`,
      title: "New test collection",
      communityIds: [] as number[]
    }
    const options = {
      userId: fixture.userId,
      signedIn: true,
      profileComplete: true,
      canCreateCommunity: true,
      canCreateVocabulary: true,
      canCreateCollection: true,
      defaultVocabularySlug: fixture.vocabularySlug,
      communities: [] as (typeof community)[],
      vocabularies: [
        {
          slug: fixture.vocabularySlug,
          title: fixture.vocabularyTitle,
          communityId: null as number | null,
          canContribute: true
        }
      ],
      collections: [] as (typeof collection)[],
      importLimits: {
        maxRows: 100,
        newDefinitionsPerWindow: 5,
        windowMinutes: 10
      }
    }
    function holdOptions() {
      optionsHeld = false
      holdNextOptions = true
      optionsGate = new Promise<void>((resolveGate) => {
        releaseOptions = resolveGate
      })
    }
    await stubTrpc(context, {
      unexpected,
      queries: {
        "setup.options": () => options,
        "ontologyContext.candidates": (input) => ({
          query: input.term,
          mode: input.mode,
          sources: []
        }),
        "definitionAssistants.catalog": () => ({
          defaultProfile: "default",
          preferredProfile: "default",
          profiles: [{ id: "default", label: "Gemma 4", available: true }]
        })
      },
      mutations: {
        "communities.create": () => {
          holdOptions()
          return community
        },
        "setup.createVocabulary": () => {
          holdOptions()
          return vocabulary
        },
        "collections.create": () => {
          holdOptions()
          return collection
        },
        "termReferences.retrieveChebi": () => receipts.chebi,
        "termReferences.retrieveWolfram": () => receipts.wolfram,
        "termReferences.recordAction": () => null
      }
    })
    // This guard runs before stubTrpc. Only this test's existing drafts can be
    // updated for real. No publication, unrelated writes or external requests.
    await context.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin !== new URL(base).origin) {
        unexpected.push(`External request: ${url.origin}${url.pathname}`)
        return route.abort("blockedbyclient")
      }
      const paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? []
      if (request.method() === "GET") {
        if (paths.includes("setup.options") && holdNextOptions) {
          optionsHeld = true
          await optionsGate
        }
        return route.fallback()
      }
      if (paths.length === 1 && paths[0] === "termDrafts.update") {
        const input = request.postDataJSON()["0"] as { id?: string }
        assert.ok(input.id === gemmaDraftId || input.id === referenceDraftId)
        const response = await route.fetch({ timeout: 30000 })
        return route.fulfill({ response })
      }
      if (paths.length) return route.fallback()
      unexpected.push(`Blocked write: ${request.method()} ${url.pathname}`)
      return route.abort("blockedbyclient")
    })
    const page = await context.newPage()
    failurePage = page
    page.setDefaultTimeout(20000)
    page.setDefaultNavigationTimeout(60000)
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true })
    const heading = (name: string) =>
      page.getByRole("heading", { name, exact: true })
    const warnings = [
      "The selected community is unavailable",
      "Choose an available vocabulary",
      "The saved collection is unavailable"
    ]
    async function screenshot(name: string) {
      await expect(page.locator("main")).not.toBeEmpty()
      await expect(page.locator("nextjs-portal")).not.toContainText(
        /Build Error|Runtime Error|Unhandled Runtime/
      )
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        ),
        "The viewport must not overflow horizontally"
      )
      await page.screenshot({
        path: resolve(output, `${name}.png`),
        fullPage: true,
        animations: "disabled"
      })
      screenshots.push(`${name}.png`)
    }
    async function pending(kind: string) {
      await expect.poll(() => optionsHeld).toBe(true)
      await expect(
        page.getByRole("status").filter({
          hasText: "Updating available destinations"
        })
      ).toBeVisible()
      for (const warning of warnings)
        await expect(page.getByText(warning, { exact: true })).toHaveCount(0)
      await screenshot(`${kind}-refresh-pending`)
    }
    async function release() {
      holdNextOptions = false
      releaseOptions?.()
      await expect(
        page.getByText("Updating available destinations…", { exact: true })
      ).toHaveCount(0)
    }
    async function saved() {
      await expect(
        page.getByText("Draft saved to your account", { exact: true })
      ).toBeVisible()
    }
    async function settledMissing(warning: string) {
      // A second tab restores the acknowledged local selection, but receives
      // authoritative server options without the mocked entity. This proves a
      // settled missing destination still warns, without changing the first
      // tab's successfully refreshed options or waiting out its stale timer.
      const missingPage = await context.newPage()
      failurePage = missingPage
      missingPage.on("pageerror", (error) => errors.push(error.message))
      await missingPage.goto(page.url(), { waitUntil: "domcontentloaded" })
      await expect(
        missingPage.getByText(warning, { exact: true })
      ).toBeVisible()
      await missingPage.close()
      failurePage = page
    }
    async function pass(name: string, action: () => Promise<void>) {
      await action()
      results.push(name)
      console.log(`PASS ${name}`)
    }

    await page.goto(`${base}/setup?vocabularySlug=${fixture.vocabularySlug}`)
    await expect(page).toHaveTitle(/Quick start & guided setup/)
    await page
      .getByRole("navigation", { name: "Setup progress" })
      .getByRole("button", { name: "Community", exact: true })
      .click()
    await expect(heading("Choose a community")).toBeVisible()
    await pass(
      "Community acknowledgement waits for refreshed destinations",
      async () => {
        await page.getByText("Create a new community", { exact: true }).click()
        await page
          .getByLabel("Community name", { exact: true })
          .fill(community.title)
        await button("Create community and continue").click()
        await pending("community")
        await expect(
          page.getByText("This vocabulary is independent of a community.", {
            exact: false
          })
        ).toHaveCount(0)
        options.communities.push(community)
        options.vocabularies.push(communityVocabulary)
        await release()
        await expect(page.getByLabel("Vocabulary for your terms")).toHaveValue(
          community.slug
        )
        await expect(
          page.getByText(`Owned by ${community.title}.`, { exact: false })
        ).toBeVisible()
        await settledMissing(warnings[0])
      }
    )
    await pass(
      "Vocabulary acknowledgement waits for refreshed destinations",
      async () => {
        await page
          .getByText("Create a standalone vocabulary", { exact: true })
          .click()
        await page
          .getByLabel("Vocabulary name", { exact: true })
          .fill(vocabulary.title)
        await button("Create vocabulary and continue").click()
        await pending("vocabulary")
        options.vocabularies.push(vocabulary)
        await release()
        await expect(heading("Choose a collection")).toBeVisible()
        await button("Back").click()
        await expect(page.getByLabel("Vocabulary for your terms")).toHaveValue(
          vocabulary.slug
        )
        await settledMissing(warnings[1])
        await button("Continue").click()
      }
    )
    await pass(
      "Collection acknowledgement waits for refreshed destinations",
      async () => {
        await page.getByText("Create a new collection", { exact: true }).click()
        await page
          .getByLabel("Collection name", { exact: true })
          .fill(collection.title)
        await button("Create collection and continue").click()
        await pending("collection")
        options.collections.push(collection)
        await release()
        await expect(heading("Add your terms")).toBeVisible()
        await button("Back").click()
        await expect(
          page.getByLabel("Group these terms in a collection")
        ).toHaveValue(String(collection.id))
        await settledMissing(warnings[2])
      }
    )
    await pass(
      "Gemma retains its friendly name in restored preview and applied draft",
      async () => {
        await page.goto(`${base}/add?draftId=${gemmaDraftId}`)
        const preview = page.getByRole("region", {
          name: "Model draft preview"
        })
        await expect(
          preview.getByText("Drafted by Gemma 4.", { exact: true })
        ).toBeVisible()
        await expect(
          page.getByRole("textbox", {
            name: "Proposed definition",
            exact: true
          })
        ).toHaveValue(generated)
        await screenshot("gemma-restored-preview")
        await button("Use this draft").click()
        await expect(
          page.getByRole("textbox", { name: "Definition", exact: true })
        ).toHaveValue(generated)
        await expect(
          page.getByText(/Model draft applied from Gemma 4\./)
        ).toBeVisible()
        await saved()
        await page.reload()
        await expect(
          page.getByText(/Model draft applied from Gemma 4\./)
        ).toBeVisible()
        await expect(
          page.getByRole("textbox", { name: "Definition", exact: true })
        ).toHaveValue(generated)
        await button("Review definition").click()
        await expect(page.getByText(/Drafted with Gemma 4\./)).toBeVisible()
        await screenshot("gemma-restored-review")
        await saved()
      }
    )
    await pass(
      "Wolfram graphics have no empty marker or insert action; properties remain usable",
      async () => {
        await page.goto(`${base}/add?draftId=${referenceDraftId}`)
        await expect(
          page.getByRole("textbox", { name: "Definition", exact: true })
        ).toHaveValue(original)
        await page.getByRole("tab", { name: "Advanced", exact: true }).click()
        await button("Wolfram lookup").click()
        await button("Retrieve Wolfram resources").click()
        const result = page.locator("[data-wolfram-reading-view]")
        await expect(
          result.getByText("Available on Wolfram|Alpha:", { exact: false })
        ).toContainText("Periodic table location")
        await expect(result.getByText("Image:", { exact: true })).toHaveCount(0)
        await expect(
          button("Insert text and cite: Periodic table location")
        ).toHaveCount(0)
        await expect(
          result.getByRole("table", { name: "General properties" })
        ).toContainText("atomic number")
        await button("Insert text and cite: General properties").click()
        const editor = page.getByRole("textbox", {
          name: "Definition",
          exact: true
        })
        await expect(editor).toHaveValue(/atomic number: 14/)
        assert.ok(!(await editor.inputValue()).includes("Image:"))
        await button("Undo source insertion").click()
        await expect(editor).toHaveValue(original)
        await saved()
        await screenshot("wolfram-desktop")
        await page.setViewportSize({ width: 390, height: 844 })
        await screenshot("wolfram-mobile")
      }
    )
    assert.deepEqual(
      unexpected,
      [],
      "No unapproved writes or provider requests"
    )
    assert.deepEqual(errors, [], "No browser runtime or console errors")
  } catch (error) {
    failure = error
    if (failurePage && !failurePage.isClosed()) {
      try {
        await writeFile(
          resolve(output, "failure-visible-dom.txt"),
          `URL: ${failurePage.url()}\nTitle: ${await failurePage.title()}\n\n${await failurePage.locator("body").innerText({ timeout: 5000 })}`
        )
        await failurePage.screenshot({
          path: resolve(output, "failure.png"),
          fullPage: true,
          animations: "disabled",
          timeout: 5000
        })
        screenshots.push("failure.png")
      } catch (captureError) {
        errors.push(
          `Failure evidence unavailable: ${captureError instanceof Error ? captureError.message : String(captureError)}`
        )
      }
    }
  } finally {
    holdNextOptions = false
    releaseOptions?.()
    try {
      if (browser) await closeBrowserAfterRoutes(browser)
    } finally {
      try {
        await removeGuidedSetupFixture(fixture)
        cleaned = true
      } finally {
        await db.$client.end()
        await writeFile(
          resolve(output, "results.json"),
          JSON.stringify(
            {
              base,
              results,
              errors,
              unexpected,
              screenshots,
              cleaned,
              failure: failure instanceof Error ? failure.message : failure
            },
            null,
            2
          )
        )
      }
    }
  }
  if (failure) throw failure
  console.log(`Display regression UI tests passed; evidence: ${output}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
