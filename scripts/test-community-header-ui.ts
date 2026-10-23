// Local HTTP regression. Only a disposable fixture's community preference may
// be changed through the UI; provider calls and all other writes are blocked.
import "dotenv/config"
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  expect as baseExpect,
  type Browser,
  type Locator
} from "@playwright/test"
import { eq } from "drizzle-orm"
import { db, usersTable } from "../drizzle"
import {
  createGuidedSetupFixture,
  removeGuidedSetupFixture
} from "./guided-setup-ui-fixture"
import {
  closeBrowserAfterRoutes,
  launchBrowser,
  localPreviewBase,
  signInAs
} from "./ui-test-harness"

const expect = baseExpect.configure({ timeout: 30000 })
const links = (locator: Locator) =>
  locator.locator("a[href]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: node.textContent?.trim() ?? "",
      href: node.getAttribute("href")!
    }))
  )

async function main() {
  const base = localPreviewBase()
  const origin = new URL(base).origin
  const fixture = await createGuidedSetupFixture()
  const output = resolve(
    process.env.SAM_UI_TEST_OUTPUT_DIR ??
      `${tmpdir()}/matsci-community-header-${fixture.token}`
  )
  const passed: string[] = []
  const blocked: string[] = []
  const errors: string[] = []
  const checkedLinks: Array<{ href: string; status: number }> = []
  let browser: Browser | undefined
  let failure: unknown
  let cleanupFailure: unknown
  let cleaned = false
  const record = (name: string) => {
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  const workspacePath = `/communities/${fixture.communitySlug}?view=work`
  const workspace = `${base}${workspacePath}`
  try {
    await mkdir(output, { recursive: true })
    await db
      .update(usersTable)
      .set({ activeCommunityId: fixture.communityId })
      .where(eq(usersTable.id, fixture.userId))
    browser = await launchBrowser()
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 }
    })
    await signInAs(context, base, fixture.userId)
    const guard = async (current: typeof context) => {
      await current.route("**/*", async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        const paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? []
        let allowed =
          url.origin === origin &&
          !paths.some((path) =>
            /^(aiAssist\.|termReferences\.retrieve|ontologyContext\.)/.test(
              path
            )
          )
        if (request.method() !== "GET") {
          const inputs = request.postDataJSON() as Record<
            string,
            { communityId?: number | null }
          >
          allowed &&=
            paths.length === 1 &&
            paths[0] === "communities.setActive" &&
            (inputs[0]?.communityId === null ||
              inputs[0]?.communityId === fixture.communityId)
        }
        if (!allowed) {
          blocked.push(`${request.method()} ${url.pathname}`)
          return route.abort("blockedbyclient")
        }
        return route.continue()
      })
    }
    await guard(context)
    const page = await context.newPage()
    page.setDefaultNavigationTimeout(90000)
    page.on("pageerror", (error) => errors.push(error.message))
    const primary = page.getByRole("navigation", {
      name: "Primary",
      exact: true
    })
    const menu = () => page.getByRole("menu")
    const open = async (name: string) => {
      await primary.getByRole("button", { name, exact: true }).click()
      await expect(menu()).toBeVisible()
    }
    const close = () => page.keyboard.press("Escape")
    await page.goto(workspace)
    await expect(primary.locator('button[data-active="true"]')).toHaveCount(1)
    await expect(
      primary.getByRole("button", { name: "Participate", exact: true })
    ).toHaveAttribute("data-active", "true")
    await open("Vocabulary")
    const vocabularyLinks = await links(menu())
    assert.equal(
      vocabularyLinks.some((link) => link.label === "Develop a metadata field"),
      false
    )
    assert.equal(
      vocabularyLinks.find((link) => link.label === "Metadata field catalog")
        ?.href,
      "/metadata/fields"
    )
    assert.equal(
      vocabularyLinks.find((link) => link.label === "Add term")?.href,
      `/add?vocabularySlug=${fixture.vocabularySlug}`
    )
    for (const link of vocabularyLinks.filter((link) =>
      link.href.startsWith("/setup")
    )) {
      const query = new URL(link.href, base).searchParams
      assert.equal(query.get("communityId"), String(fixture.communityId))
      assert.equal(query.get("vocabularySlug"), fixture.vocabularySlug)
    }
    await close()
    await open("Participate")
    const participateLinks = await links(menu())
    assert.deepEqual(
      participateLinks.filter((link) => link.href === "/communities"),
      [{ label: "Community workspaces", href: "/communities" }]
    )
    await close()
    await open(`Working in ${fixture.communityTitle}`)
    await expect(
      menu().getByText("Community context", { exact: true })
    ).toBeVisible()
    await expect(
      menu().getByText("Default for browsing and new contributions.", {
        exact: true
      })
    ).toBeVisible()
    assert.deepEqual(await links(menu()), [
      { label: "Open workspace", href: workspacePath }
    ])
    await menu()
      .getByRole("menuitem", { name: "Open workspace", exact: true })
      .click()
    await expect(page).toHaveURL(workspace)
    await expect(
      page.getByRole("heading", { name: "My work", exact: true })
    ).toBeVisible()
    record(
      "Desktop header has one community directory, one scoped workspace link, and scoped creation actions"
    )

    await open(fixture.userName)
    const accountLinks = await links(menu())
    await expect(
      menu().getByRole("menuitem", { name: "My term drafts", exact: true })
    ).toHaveAttribute("href", "/profile/drafts")
    await menu()
      .getByRole("menuitem", { name: "My term drafts", exact: true })
      .click()
    await expect(page).toHaveURL(`${base}/profile/drafts`)
    await expect(
      page.getByRole("heading", { name: "My drafts", exact: true })
    ).toBeVisible()
    record("Account draft link opens the term draft list on the first click")

    const allLinks = [
      ...vocabularyLinks,
      ...participateLinks,
      ...accountLinks,
      { href: workspacePath },
      { href: "/docs" },
      { href: "/about" }
    ]
    const safePaths = new Set([
      "/terms",
      "/search",
      "/vocabularies",
      "/collections",
      "/tags",
      "/metadata/fields",
      "/add",
      "/setup",
      "/communities",
      "/discussion",
      "/studies",
      "/models",
      "/profile",
      "/profile/drafts",
      "/docs",
      "/about",
      `/communities/${fixture.communitySlug}`
    ])
    for (const href of new Set(allLinks.map((link) => link.href))) {
      const url = new URL(href, base)
      assert.equal(url.origin, origin)
      assert.ok(
        safePaths.has(url.pathname),
        `Unexpected header destination: ${href}`
      )
      url.hash = ""
      const response = await context.request.get(url.href, {
        timeout: 60000,
        maxRedirects: 0
      })
      checkedLinks.push({ href, status: response.status() })
      assert.equal(response.status(), 200, `Header link failed: ${href}`)
    }
    record(
      "All signed-in header destinations respond to bounded local GET requests"
    )

    await page.goto(workspace)
    await open(`Working in ${fixture.communityTitle}`)
    await menu()
      .getByRole("menuitemradio", { name: "Everything", exact: true })
      .click()
    await expect(
      primary.getByRole("button", {
        name: "Working in every community",
        exact: true
      })
    ).toBeVisible()
    await expect(page).toHaveURL(workspace)
    await open("Working in every community")
    await expect(
      menu().getByRole("menuitem", { name: "Open workspace", exact: true })
    ).toHaveCount(0)
    await menu()
      .getByRole("menuitemradio", { name: fixture.communityTitle, exact: true })
      .click()
    await expect(
      primary.getByRole("button", {
        name: `Working in ${fixture.communityTitle}`,
        exact: true
      })
    ).toBeVisible()
    await expect(page).toHaveURL(workspace)
    const [updatedUser] = await db
      .select({ activeCommunityId: usersTable.activeCommunityId })
      .from(usersTable)
      .where(eq(usersTable.id, fixture.userId))
    assert.equal(updatedUser.activeCommunityId, fixture.communityId)
    record(
      "Community context persists and reloads the current route without navigating away"
    )

    await page.goto(`${base}/metadata/fields`)
    await expect(primary.locator('button[data-active="true"]')).toHaveCount(1)
    await expect(
      primary.getByRole("button", { name: "Vocabulary", exact: true })
    ).toHaveAttribute("data-active", "true")
    await page.goto(
      `${base}/metadata/workspace?vocabularySlug=${fixture.vocabularySlug}`
    )
    await expect(page).toHaveURL(workspace)
    await expect(primary.locator('button[data-active="true"]')).toHaveCount(1)
    await expect(
      primary.getByRole("button", { name: "Participate", exact: true })
    ).toHaveAttribute("data-active", "true")
    record(
      "Catalog and community work highlight only their own primary category"
    )

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByLabel("Open navigation menu", { exact: true }).click()
    const mobile = page.getByRole("navigation", { name: "Mobile", exact: true })
    await mobile
      .locator("summary")
      .filter({ hasText: /^Vocabulary$/ })
      .click()
    await mobile
      .locator("summary")
      .filter({ hasText: /^Participate$/ })
      .click()
    const mobileLinks = await links(mobile)
    for (const expected of [...vocabularyLinks, ...participateLinks])
      assert.equal(
        mobileLinks.filter(
          (link) => link.href === expected.href && link.label === expected.label
        ).length,
        1
      )
    await expect(
      mobile.getByRole("link", { name: "Community workspaces", exact: true })
    ).toHaveCount(1)
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      )
      .toBe(true)
    await page.screenshot({
      path: resolve(output, "mobile-navigation.png"),
      fullPage: true,
      animations: "disabled"
    })
    await page
      .getByRole("button", {
        name: `Working in ${fixture.communityTitle}`,
        exact: true
      })
      .click()
    assert.deepEqual(await links(menu()), [
      { label: "Open workspace", href: workspacePath }
    ])
    await menu()
      .getByRole("menuitem", { name: "Open workspace", exact: true })
      .click()
    await expect(page).toHaveURL(workspace)
    await expect(
      page.getByLabel("Open navigation menu", { exact: true })
    ).toBeVisible()
    await page.getByLabel("Open navigation menu", { exact: true }).click()
    await page
      .getByRole("button", { name: fixture.userName, exact: true })
      .click()
    await menu()
      .getByRole("menuitem", { name: "My term drafts", exact: true })
      .click()
    await expect(page).toHaveURL(`${base}/profile/drafts`)
    await expect(
      page.getByLabel("Open navigation menu", { exact: true })
    ).toBeVisible()
    record(
      "Mobile menus retain desktop destinations and close after workspace or draft navigation"
    )

    const anonymous = await browser.newContext({
      viewport: { width: 1440, height: 1000 }
    })
    await guard(anonymous)
    const visitor = await anonymous.newPage()
    visitor.on("pageerror", (error) => errors.push(error.message))
    await visitor.goto(`${base}/communities`)
    const anonymousPrimary = visitor.getByRole("navigation", {
      name: "Primary",
      exact: true
    })
    await expect(
      anonymousPrimary.getByRole("link", { name: "Login", exact: true })
    ).toBeVisible()
    await expect(
      anonymousPrimary.getByRole("button", { name: /^Working in/ })
    ).toHaveCount(0)
    await anonymousPrimary
      .getByRole("button", { name: "Participate", exact: true })
      .click()
    await expect(
      visitor.getByRole("menuitem", {
        name: "Community workspaces",
        exact: true
      })
    ).toHaveAttribute("href", "/communities")
    await visitor.keyboard.press("Escape")
    await anonymousPrimary
      .getByRole("button", { name: "Vocabulary", exact: true })
      .click()
    await expect(
      visitor.getByRole("menuitem", { name: "Add term", exact: true })
    ).toHaveAttribute("href", "/add")
    record(
      "Anonymous navigation offers the community directory and login without a private workspace shortcut"
    )
    assert.deepEqual(
      blocked,
      [],
      "No provider, external, or unapproved write requests"
    )
    assert.deepEqual(errors, [], "No uncaught browser errors")
  } catch (error) {
    failure = error
  } finally {
    if (browser) await closeBrowserAfterRoutes(browser)
    try {
      await removeGuidedSetupFixture(fixture)
      cleaned = true
    } catch (error) {
      cleanupFailure = error
    }
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          passed,
          checkedLinks,
          blocked,
          errors,
          cleaned,
          fixture,
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
  if (failure) throw failure
  if (cleanupFailure) throw cleanupFailure
  console.log(`Community header UI evidence: ${output}`)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
