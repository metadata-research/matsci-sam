// Local production preview, real private drafts, no publication or AI calls.
import "dotenv/config"
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { tmpdir } from "node:os"
import { expect, type Browser, type Page } from "@playwright/test"
import { eq } from "drizzle-orm"
import {
  db,
  termDraftsTable,
  termReferenceLookupsTable,
  usersTable
} from "../drizzle"
import {
  createGuidedSetupFixture,
  removeGuidedSetupFixture
} from "./guided-setup-ui-fixture"
import {
  closeBrowserAfterRoutes,
  launchBrowser,
  localPreviewBase,
  referenceLookup,
  rememberView,
  signInAs
} from "./ui-test-harness"

const deferred = () => {
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { wait, release }
}

async function main() {
  const base = localPreviewBase()
  const fixture = await createGuidedSetupFixture()
  const output = resolve(
    process.env.SAM_UI_TEST_OUTPUT_DIR ??
      `${tmpdir()}/matsci-term-confirmation-${fixture.token}`
  )
  const cases = [
    {
      name: "simple-pointer",
      view: "simple",
      explicit: true,
      width: 1280,
      keyboard: false
    },
    {
      name: "advanced-pointer",
      view: "advanced",
      explicit: true,
      width: 1280,
      keyboard: false
    },
    {
      name: "mobile-active-community",
      view: "simple",
      explicit: false,
      width: 390,
      keyboard: false
    },
    {
      name: "simple-enter",
      view: "simple",
      explicit: true,
      width: 1280,
      keyboard: true
    }
  ] as const
  const events: unknown[] = []
  const errors: string[] = []
  const passed: string[] = []
  const draftIds = new Set<string>()
  const holds: ReturnType<typeof deferred>[] = []
  let browser: Browser | undefined
  let page: Page | undefined
  let failure: unknown
  let cleaned = false
  try {
    await mkdir(output, { recursive: true })
    // The unscoped Add route must resolve to this fixture's vocabulary.
    await db
      .update(usersTable)
      .set({ activeCommunityId: fixture.communityId })
      .where(eq(usersTable.id, fixture.userId))
    browser = await launchBrowser()
    for (const scenario of cases) {
      const context = await browser.newContext({
        viewport: { width: scenario.width, height: 1000 }
      })
      const createHeld = deferred()
      const listHeld = deferred()
      holds.push(createHeld, listHeld)
      let createResponded = false
      let holdList = true
      let creations = 0
      let lookups = 0
      const lists: string[] = []
      const term = `${scenario.name} confirmation ${fixture.token}`
      const definition = `Private writing retained after ${scenario.name} confirmation.`
      const references = new Map<string, ReturnType<typeof referenceLookup>>()
      await signInAs(context, base, fixture.userId)
      await rememberView(context, base, scenario.view)
      await context.route("**/*", async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        const paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? []
        try {
          const inputs = JSON.parse(
            request.method() === "GET"
              ? (url.searchParams.get("input") ?? "{}")
              : (request.postData() ?? "{}")
          )
          assert.equal(
            url.origin,
            new URL(base).origin,
            "Only the local preview may be contacted"
          )
          if (request.method() === "GET") {
            if (paths.includes("terms.list")) {
              lists.push(url.searchParams.get("input") ?? "")
              // A newly allocated draft ID used to clear the destination and
              // disable/move the button between pointerdown and pointerup.
              // Hold that query if it occurs so this race is deterministic.
              if (holdList && lists.at(-1)!.includes("draftId"))
                await listHeld.wait
            }
            const substitutes: Record<
              string,
              (input: Record<string, string>) => unknown
            > = {
              "ontologyContext.candidates": (input) => ({
                query: input.term,
                mode: input.mode,
                sources: []
              }),
              "termReferences.getLookup": (input) => {
                const lookup = references.get(input.lookupId)
                assert(lookup, "Only a locally stubbed lookup may be restored")
                return lookup
              }
            }
            assert(!paths.some((path) => /^(aiAssist\.|agentOne\.)/.test(path)))
            assert(
              paths.every(
                (path) =>
                  !/^(ontologyContext\.|termReferences\.)/.test(path) ||
                  path in substitutes
              )
            )
            if (!paths.some((path) => path in substitutes))
              return route.continue()
            const original = paths.every((path) => path in substitutes)
              ? []
              : await (await route.fetch()).json()
            return route.fulfill({
              json: paths.map((path, index) =>
                path in substitutes
                  ? { result: { data: substitutes[path](inputs[index] ?? {}) } }
                  : original[index]
              )
            })
          }
          assert.equal(request.method(), "POST")
          assert.equal(paths.length, 1)
          const path = paths[0]
          const input = inputs[0]
          if (path === "termReferences.retrieveChebi") {
            assert.equal(scenario.view, "advanced")
            assert.equal(input.term, term)
            lookups += 1
            const lookup = referenceLookup(term, [])
            // Real draft saves validate ownership of even an empty lookup.
            // Store the invented receipt without contacting a provider.
            await db.insert(termReferenceLookupsTable).values({
              id: lookup.lookupId,
              requestedById: fixture.userId,
              termText: lookup.term,
              retrievedAt: lookup.retrievedAt
            })
            references.set(lookup.lookupId, lookup)
            return route.fulfill({ json: [{ result: { data: lookup } }] })
          }
          assert(
            ["termDrafts.create", "termDrafts.update"].includes(path),
            `Unexpected mutation: ${path}`
          )
          assert.equal(input.payload.vocabularySlug, fixture.vocabularySlug)
          assert.equal(input.payload.term, term)
          assert.equal(input.payload.aiSuggestionId, null)
          assert.deepEqual(input.payload.files, [])
          assert.deepEqual(input.payload.sources, [])
          if (path === "termDrafts.create") {
            assert.equal(input.expectedOwnerId, fixture.userId)
            draftIds.add(input.id)
            creations += 1
          } else assert(draftIds.has(input.id))
          const response = await route.fetch()
          assert.equal(response.status(), 200)
          if (path === "termDrafts.create") {
            createResponded = true
            await createHeld.wait
          }
          return route.fulfill({ response })
        } catch (error) {
          errors.push(String(error))
          await route.abort("blockedbyclient")
        }
      })
      page = await context.newPage()
      page.on("pageerror", (error) => errors.push(error.message))
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text())
      })
      const route = scenario.explicit
        ? `/add?vocabularySlug=${fixture.vocabularySlug}`
        : "/add"
      await page.goto(`${base}${route}`, { waitUntil: "networkidle" })
      const termInput = page.getByRole("textbox", { name: "Term", exact: true })
      const confirm = page.getByRole("button", { name: /^Confirm term/ })
      const savedStatus = page.getByRole("status").filter({
        hasText: /^Draft saved to your account$/
      })
      await expect(confirm).toBeDisabled()
      await termInput.fill(term)
      await expect.poll(() => creations, { timeout: 10000 }).toBe(1)
      await expect.poll(() => createResponded, { timeout: 10000 }).toBe(true)
      await expect(confirm).toBeEnabled()
      if (scenario.keyboard) {
        // Free-text Enter must confirm while the first save is still pending.
        await termInput.press("Enter")
        createHeld.release()
      } else {
        await confirm.scrollIntoViewIfNeeded()
        const box = await confirm.boundingBox()
        assert(box)
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        createHeld.release()
        await expect(savedStatus).toBeVisible()
        events.push({
          scenario: scenario.name,
          disabledAtPointerUp: !(await confirm.isEnabled())
        })
        await page.mouse.up()
      }
      holdList = false
      listHeld.release()
      const editor = page.getByRole("textbox", {
        name: "Definition",
        exact: true
      })
      await expect(editor).toBeVisible()
      await editor.fill(definition)
      await expect(savedStatus).toBeVisible()
      const id = new URL(page.url()).searchParams.get("draftId")
      assert(id && draftIds.has(id))
      await page.reload()
      await expect(editor).toHaveValue(definition)
      await expect(savedStatus).toBeVisible()
      await expect(
        page.getByRole("heading", { name: "Application error" })
      ).toHaveCount(0)
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        ),
        "The editor must fit the desktop or mobile viewport"
      )
      assert(
        lists.some((input) => input.includes(id)),
        "Restored drafts retain draft-scoped vocabulary access"
      )
      const [saved] = await db
        .select()
        .from(termDraftsTable)
        .where(eq(termDraftsTable.id, id))
      assert.equal(saved.payload?.editorState?.step, "write")
      assert.equal(saved.payload?.definition, definition)
      assert.equal(saved.payload?.vocabularySlug, fixture.vocabularySlug)
      assert.equal(creations, 1, "One stable draft, including through reload")
      assert.equal(lookups, scenario.view === "advanced" ? 1 : 0)
      await page.screenshot({
        path: resolve(output, `${scenario.name}.png`),
        fullPage: true
      })
      passed.push(scenario.name)
      console.log(`PASS ${scenario.name}`)
      await page.close()
      await context.unrouteAll({ behavior: "wait" })
      await context.close()
    }
    assert.equal(
      (
        await db
          .select()
          .from(termDraftsTable)
          .where(eq(termDraftsTable.ownerId, fixture.userId))
      ).length,
      cases.length
    )
    assert.deepEqual(errors, [])
  } catch (error) {
    failure = error
    if (page && !page.isClosed()) {
      await page
        .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
        .catch(() => {})
      await writeFile(
        resolve(output, "failure.txt"),
        await page.locator("body").innerText()
      ).catch(() => {})
    }
  } finally {
    holds.forEach((control) => control.release())
    try {
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
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          passed,
          events,
          errors,
          cleaned,
          realProviderCalls: 0,
          failure:
            failure instanceof Error ? failure.message : (failure ?? null)
        },
        null,
        2
      )
    )
  }
  if (failure) throw failure
  console.log(
    "First-click term confirmation and reload passed. Fixtures removed."
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$client.end())
