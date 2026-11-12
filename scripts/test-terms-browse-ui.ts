// Disposable local fixtures only; the browser is read-only throughout.
import "dotenv/config"
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  expect as baseExpect,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test"
import { and, eq, inArray } from "drizzle-orm"
import {
  communitiesTable,
  communityMembersTable,
  db,
  termsTable,
  usersTable
} from "../drizzle"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import { termPath } from "../lib/public-identifiers"
import { reviewFingerprints } from "./community-review-test-support"
import {
  createGuidedSetupFixture,
  removeGuidedSetupFixture,
  type GuidedSetupFixture
} from "./guided-setup-ui-fixture"
import {
  closeBrowserAfterRoutes,
  launchBrowser,
  localPreviewBase,
  rememberView,
  signInAs
} from "./ui-test-harness"

const expect = baseExpect.configure({ timeout: 20000 })

async function main() {
  const base = localPreviewBase(),
    origin = new URL(base).origin
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /_(?:qa|test|ci|scratch)(?:_|$)/
  )
  assert.equal(process.env.GRAPH_PROJECTION_ENABLED, "false")
  const output = resolve(
    process.env.SAM_TERMS_UI_OUTPUT_DIR ?? "/tmp/terms-browse-ui-20261111"
  )
  await mkdir(output, { recursive: true })
  const before = await reviewFingerprints()
  await writeFile(
    resolve(output, "database-before.json"),
    JSON.stringify(before, null, 2)
  )
  const fixtures: GuidedSetupFixture[] = [],
    passed: string[] = [],
    blocked: string[] = [],
    errors: string[] = [],
    screenshots: string[] = []
  let browser: Browser | undefined,
    failure: unknown,
    cleanupFailure: unknown,
    cleaned = false
  const record = (name: string) => {
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  const guard = async (context: BrowserContext) => {
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url())
      if (request.method() !== "GET" || url.origin !== origin) {
        blocked.push(`${request.method()} ${url.pathname}`)
        return route.abort("blockedbyclient")
      }
      await route.continue()
    })
  }
  const observe = (page: Page) => {
    page.setDefaultNavigationTimeout(90000)
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text())
    })
  }
  const snapshot = async (page: Page, name: string) => {
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      )
      .toBe(true)
    await expect(page.locator("nextjs-portal")).toHaveCount(0)
    await page.screenshot({ path: resolve(output, name), fullPage: true })
    screenshots.push(name)
  }
  const setActive = async (communityId: number | null) => {
    assert.ok(
      communityId === null ||
        fixtures.some((fixture) => fixture.communityId === communityId)
    )
    await db
      .update(usersTable)
      .set({ activeCommunityId: communityId })
      .where(eq(usersTable.id, fixtures[0].userId))
  }
  try {
    for (let i = 0; i < 3; i++) {
      fixtures.push(await createGuidedSetupFixture())
      await writeFile(
        resolve(output, "fixtures.json"),
        JSON.stringify(fixtures, null, 2)
      )
    }
    const [publicScope, privateScope, emptyScope] = fixtures
    await db
      .update(communitiesTable)
      .set({ visibility: "members" })
      .where(eq(communitiesTable.id, privateScope.communityId))
    await db.insert(communityMembersTable).values(
      [privateScope, emptyScope].map((fixture) => ({
        communityId: fixture.communityId,
        userId: publicScope.userId,
        role: "member" as const,
        addedById: fixture.userId
      }))
    )
    const marker = `browse${publicScope.token.slice(0, 12)}`
    const query = `query${publicScope.token}`
    const privateQuery = `secret${privateScope.token}`
    const paths: string[] = []
    for (const [fixture, label, slug, text] of [
      [
        publicScope,
        `alpha crystal ${marker}`,
        "alpha_crystal",
        `A crystal for the local browse test. ${query}`
      ],
      [
        publicScope,
        `beta grain ${marker}`,
        "beta_grain",
        "A grain for the local browse test."
      ],
      [
        privateScope,
        `private lattice ${marker}`,
        "private_lattice",
        `A private local browse example. ${privateQuery}`
      ]
    ] as const) {
      await db.transaction(async (tx) => {
        const [term] = await tx
          .insert(termsTable)
          .values({ term: label, slug, vocabularySlug: fixture.vocabularySlug })
          .returning()
        await createDefinitionWithInitialRevision(tx, {
          termId: term.id,
          authorId: fixture.userId,
          definition: text,
          example: "",
          changeNote: "Disposable browse UI fixture",
          source: "initial"
        })
        paths.push(termPath(term.slug, term.vocabularySlug))
      })
    }
    browser = await launchBrowser()
    for (const [size, viewport] of [
      ["desktop", { width: 1440, height: 1000 }],
      ["mobile", { width: 390, height: 844 }]
    ] as const) {
      const context = await browser.newContext({ viewport })
      await guard(context)
      await rememberView(context, base, "simple")
      await signInAs(context, base, publicScope.userId)
      const page = await context.newPage()
      observe(page)
      const goto = async (suffix = "?scope=all") => {
        await page.goto(`${base}/terms${suffix}`)
        await expect(page).toHaveTitle(/Browse Terms/)
        await expect(
          page.getByRole("heading", { name: "Browse Terms", exact: true })
        ).toBeVisible()
        await expect(
          page.getByRole("searchbox", { name: "Filter terms", exact: true })
        ).toBeVisible()
        await expect(
          page.getByRole("navigation", { name: "Browse options", exact: true })
        ).toHaveCount(0)
        await expect(
          page.getByRole("link", { name: "Show everything", exact: true })
        ).toHaveCount(0)
      }
      const term = (index: number) =>
        page.locator(`main a[href="${paths[index]}"]`)
      const checkTerms = async (present: number[]) => {
        for (let i = 0; i < paths.length; i++)
          await expect(term(i)).toHaveCount(present.includes(i) ? 1 : 0)
      }
      await setActive(publicScope.communityId)
      await goto()
      await expect(
        page.getByText(`Terms in ${publicScope.communityTitle}.`, {
          exact: true
        })
      ).toBeVisible()
      await checkTerms([0, 1])
      await page
        .getByRole("button", {
          name: `Community: ${publicScope.communityTitle}`,
          exact: true
        })
        .click()
      await expect(
        page.getByRole("menuitemradio", {
          name: publicScope.communityTitle,
          exact: true
        })
      ).toHaveAttribute("aria-checked", "true")
      await expect(
        page.getByText(
          "Sets the community for new terms. Saved drafts keep their destination.",
          { exact: true }
        )
      ).toHaveCount(0)
      await page.keyboard.press("Escape")
      const filter = page.getByRole("searchbox", {
        name: "Filter terms",
        exact: true
      })
      await filter.fill("alpha")
      await checkTerms([0])
      await filter.press("Escape")
      await expect(filter).toHaveValue("")
      await checkTerms([0, 1])
      await filter.fill("no-matching-browse-term")
      await checkTerms([])
      await expect(
        page.getByRole("navigation", { name: "Letter index" })
      ).toHaveCount(0)
      await expect(page.getByText(/No terms match/)).toBeVisible()
      await page
        .getByRole("button", { name: "Clear filter", exact: true })
        .click()
      await checkTerms([0, 1])
      await snapshot(page, `${size}-public-community.png`)
      record(
        `${size}: selected public community governs legacy scope=all; filter, Escape and clear work; selector hint removed`
      )

      await goto(`?scope=all&q=${query}`)
      await checkTerms([0])
      await expect(
        page.getByRole("link", { name: "Show all terms", exact: true })
      ).toHaveAttribute("href", "/terms")
      await filter.fill("beta")
      await checkTerms([])
      await page
        .getByRole("button", { name: "Clear filter", exact: true })
        .click()
      await checkTerms([0])
      await page
        .getByRole("link", { name: "Show all terms", exact: true })
        .click()
      await expect(page).toHaveURL(`${base}/terms`)
      await checkTerms([0, 1])
      record(
        `${size}: server search finds definition text; local filter narrows results; clearing q retains community`
      )

      await setActive(privateScope.communityId)
      await goto()
      await expect(
        page.getByText(`Terms in ${privateScope.communityTitle}.`, {
          exact: true
        })
      ).toBeVisible()
      await checkTerms([2])
      await snapshot(page, `${size}-private-community.png`)
      await goto(`?scope=all&q=${query}`)
      await checkTerms([])
      await expect(
        page.getByText(
          `No term in the ${privateScope.communityTitle} vocabulary matches "${query}".`,
          { exact: true }
        )
      ).toBeVisible()
      record(
        `${size}: second community and legacy scope=all stay scoped, including a search with no results`
      )

      await setActive(null)
      await goto()
      await expect(
        page.getByText("Terms from all communities.", { exact: true })
      ).toBeVisible()
      await filter.fill(marker)
      await checkTerms([0, 1, 2])
      await expect(term(2)).toContainText(
        `Defined in ${privateScope.vocabularyTitle}`
      )
      await snapshot(page, `${size}-everything.png`)
      record(
        `${size}: All communities includes public and member-visible private terms with vocabulary labels`
      )

      await setActive(emptyScope.communityId)
      await goto()
      await checkTerms([])
      await expect(
        page.getByText(
          `No terms have been published in the ${emptyScope.communityTitle} vocabulary yet.`,
          { exact: true }
        )
      ).toBeVisible()
      await filter.fill("empty")
      await page
        .getByRole("button", { name: "Clear filter", exact: true })
        .click()
      await expect(filter).toHaveValue("")
      await expect(
        page.getByRole("navigation", { name: "Letter index" })
      ).toHaveCount(0)
      await snapshot(page, `${size}-empty-community.png`)
      record(
        `${size}: empty community keeps an operable filter and omits empty letter navigation`
      )

      await setActive(publicScope.communityId)
      await page.goto(`${base}/`)
      const browse = page
        .getByRole("navigation", { name: "Get started", exact: true })
        .getByRole("link", { name: "Browse terms", exact: true })
      await expect(browse).toHaveAttribute("href", "/terms")
      const headerLinks = await page
        .locator('header a[href^="/terms"]')
        .evaluateAll((links) => links.map((link) => link.getAttribute("href")))
      assert.ok(headerLinks.length > 0)
      assert.ok(headerLinks.every((href) => href === "/terms"))
      await browse.click()
      await expect(page).toHaveURL(`${base}/terms`)
      await checkTerms([0, 1])
      record(
        `${size}: Home and header use /terms; Home navigation retains selected community`
      )
      await context.close()

      const anonymous = await browser.newContext({ viewport })
      await guard(anonymous)
      const anonPage = await anonymous.newPage()
      observe(anonPage)
      await anonPage.goto(`${base}/terms?scope=all`)
      await anonPage
        .getByRole("searchbox", { name: "Filter terms", exact: true })
        .fill(marker)
      await expect(anonPage.locator(`main a[href="${paths[0]}"]`)).toBeVisible()
      await expect(anonPage.locator(`main a[href="${paths[1]}"]`)).toBeVisible()
      await expect(anonPage.locator(`main a[href="${paths[2]}"]`)).toHaveCount(
        0
      )
      await snapshot(anonPage, `${size}-anonymous-everything.png`)
      await anonPage.goto(`${base}/terms?q=${privateQuery}`)
      await expect(anonPage.locator(`main a[href="${paths[2]}"]`)).toHaveCount(
        0
      )
      await expect(
        anonPage.getByRole("searchbox", { name: "Filter terms", exact: true })
      ).toBeVisible()
      await anonymous.close()
      record(
        `${size}: anonymous All communities and definition search do not reveal private terms`
      )
    }
    assert.deepEqual(
      blocked,
      [],
      "No browser writes or external requests attempted"
    )
    assert.deepEqual(errors, [], "No browser runtime or console errors")
    record("Read-only browser requests and healthy console")
  } catch (error) {
    failure = error
    const page = browser?.contexts().flatMap((context) => context.pages())[0]
    if (page)
      await page
        .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
        .catch(() => {})
  } finally {
    if (browser) await closeBrowserAfterRoutes(browser)
    try {
      if (fixtures.length) {
        await setActive(null)
        const otherIds = fixtures.slice(1).map((fixture) => fixture.communityId)
        if (otherIds.length)
          await db
            .delete(communityMembersTable)
            .where(
              and(
                eq(communityMembersTable.userId, fixtures[0].userId),
                inArray(communityMembersTable.communityId, otherIds)
              )
            )
      }
      for (const fixture of [...fixtures].reverse())
        await removeGuidedSetupFixture(fixture)
      const after = await reviewFingerprints()
      await writeFile(
        resolve(output, "database-after.json"),
        JSON.stringify(after, null, 2)
      )
      assert.deepEqual(
        after,
        before,
        "All original table rows are unchanged after fixture cleanup"
      )
      cleaned = true
    } catch (error) {
      cleanupFailure = error
    }
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          base,
          browser: "Playwright Chromium (Browser plugin not available)",
          viewports: ["1440x1000", "390x844"],
          passed,
          blocked,
          errors,
          screenshots,
          tableCount: Object.keys(before).length,
          cleaned,
          failure: failure instanceof Error ? failure.stack : (failure ?? null),
          cleanupFailure:
            cleanupFailure instanceof Error
              ? cleanupFailure.stack
              : (cleanupFailure ?? null)
        },
        null,
        2
      )
    )
  }
  if (cleanupFailure) throw cleanupFailure
  if (failure) throw failure
  console.log(
    `PASS ${passed.length} focused browse checks; ${Object.keys(before).length} table fingerprints unchanged. Evidence: ${output}`
  )
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
