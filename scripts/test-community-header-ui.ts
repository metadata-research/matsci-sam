// Local disposable fixtures only. Explicit switches and the seeded draft may
// update their owned records; publishing and provider requests are blocked.
import "dotenv/config"
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  expect as baseExpect,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test"
import { and, eq, inArray } from "drizzle-orm"
import {
  communityMembersTable,
  db,
  termDraftsTable,
  usersTable
} from "../drizzle"
import { DEFAULT_VOCABULARY_SLUG } from "../lib/public-identifiers"
import { emptyTermDraftPayload } from "../lib/term-draft-types"
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

const expect = baseExpect.configure({ timeout: 30000 })

async function main() {
  const base = localPreviewBase(),
    origin = new URL(base).origin
  const fixtures: GuidedSetupFixture[] = []
  const passed: string[] = [],
    blocked: string[] = [],
    errors: string[] = []
  const preferenceWrites: Array<number | null> = []
  const draftId = randomUUID()
  let allowPreferenceWrites = false
  let browser: Browser | undefined, failure: unknown, cleanupFailure: unknown
  let output = "",
    cleaned = false
  const record = (name: string) => {
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  const guard = async (context: BrowserContext) => {
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url())
      const paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? []
      if (
        url.origin !== origin ||
        paths.some((path) =>
          /^(aiAssist\.|termReferences\.retrieve|ontologyContext\.)/.test(path)
        )
      ) {
        blocked.push(`${request.method()} ${url.pathname}`)
        return route.abort("blockedbyclient")
      }
      if (request.method() !== "GET") {
        const input = request.postDataJSON() as Record<
          string,
          { id?: string; communityId?: number | null }
        >
        const selectedId = input[0]?.communityId
        const allowedSwitch =
          allowPreferenceWrites &&
          paths[0] === "communities.setActive" &&
          (selectedId === null ||
            fixtures
              .slice(0, 2)
              .some((item) => item.communityId === selectedId))
        const allowedDraft =
          paths[0] === "termDrafts.update" && input[0]?.id === draftId
        if (
          request.method() !== "POST" ||
          paths.length !== 1 ||
          (!allowedSwitch && !allowedDraft)
        ) {
          blocked.push(`${request.method()} ${url.pathname}`)
          return route.abort("blockedbyclient")
        }
        if (allowedSwitch) preferenceWrites.push(selectedId!)
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
  const checkWidth = async (page: Page) => {
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      )
      .toBe(true)
  }
  const checkLightAppearance = async (page: Page) => {
    await expect(page.locator("html")).toHaveClass(/\blight\b/)
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/)
    await expect
      .poll(() =>
        page.evaluate(
          () => getComputedStyle(document.documentElement).colorScheme
        )
      )
      .toBe("light")
    await expect(
      page.getByRole("button", { name: "Choose appearance", exact: true })
    ).toHaveCount(0)
    await expect(page.getByText("Appearance", { exact: true })).toHaveCount(0)
  }
  try {
    const member = await createGuidedSetupFixture()
    fixtures.push(member)
    output = resolve(
      process.env.SAM_UI_TEST_OUTPUT_DIR ??
        `${tmpdir()}/matsci-community-header-${member.token}`
    )
    await mkdir(output, { recursive: true })
    const saveFixtureReceipt = () =>
      writeFile(
        resolve(output, "fixtures.json"),
        JSON.stringify(fixtures, null, 2)
      )
    await saveFixtureReceipt()
    const second = await createGuidedSetupFixture()
    fixtures.push(second)
    await saveFixtureReceipt()
    const newcomer = await createGuidedSetupFixture()
    fixtures.push(newcomer)
    await saveFixtureReceipt()
    await db
      .update(usersTable)
      .set({ activeCommunityId: second.communityId })
      .where(eq(usersTable.id, member.userId))
    await db
      .delete(communityMembersTable)
      .where(
        and(
          eq(communityMembersTable.communityId, newcomer.communityId),
          eq(communityMembersTable.userId, newcomer.userId)
        )
      )
    const payload = emptyTermDraftPayload(member.vocabularySlug)
    payload.term = `grain boundary ${member.token}`
    payload.definition =
      "The interface separating two adjoining crystal grains with different orientations."
    payload.editorState = {
      step: "write",
      confirmed: {
        term: payload.term,
        vocabularySlug: member.vocabularySlug,
        vocabularyTitle: member.vocabularyTitle
      },
      references: [],
      preview: null,
      appliedDraft: null,
      undo: null,
      includeDefinition: false,
      includeExample: false
    }
    await db.insert(termDraftsTable).values({
      id: draftId,
      ownerId: member.userId,
      payload,
      creationHash: createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex")
    })
    browser = await launchBrowser()
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: "dark"
    })
    await context.addInitScript(() => {
      // An old stored choice and the operating system must not restore a
      // removed appearance option on reload or full community navigation.
      try {
        localStorage.setItem("theme", "dark")
      } catch {
        // Initial documents without an origin have no local storage.
      }
    })
    await guard(context)
    await rememberView(context, base, "simple")
    const page = await context.newPage()
    observe(page)
    await page.goto(base)
    assert.equal(
      await page.evaluate(
        () => matchMedia("(prefers-color-scheme: dark)").matches
      ),
      true,
      "The browser fixture requests a dark operating-system appearance"
    )
    assert.equal(
      await page.evaluate(() => localStorage.getItem("theme")),
      "dark"
    )
    await checkLightAppearance(page)
    const primary = page.getByRole("navigation", {
      name: "Primary",
      exact: true
    })
    await expect(
      primary.getByRole("link", { name: "Browse terms", exact: true })
    ).toHaveAttribute("href", "/terms")
    await expect(
      primary.getByRole("link", { name: "Communities", exact: true })
    ).toHaveAttribute("href", "/communities")
    await expect(
      primary.getByRole("link", { name: "Sign in", exact: true })
    ).toBeVisible()
    await expect(
      primary.getByRole("link", { name: "My work", exact: true })
    ).toHaveCount(0)
    const main = page.getByRole("main")
    const selectedCommunity = page.getByRole("region", {
      name: "Community selection",
      exact: true
    })
    const destination = page.getByRole("region", {
      name: "Contribution destination",
      exact: true
    })
    const defaultAddHref = `/add?vocabularySlug=${DEFAULT_VOCABULARY_SLUG}`
    await expect(
      selectedCommunity.getByText("All communities", { exact: true })
    ).toBeVisible()
    await expect(
      main.getByRole("link", { name: "Add a term", exact: true })
    ).toHaveAttribute("href", defaultAddHref)
    for (const label of [
      "Browse terms",
      "Add a term",
      "Create account",
      "Join a community"
    ])
      await expect(
        main.getByRole("link", { name: label, exact: true })
      ).toBeVisible()
    await expect(
      main.getByRole("combobox", {
        name: "Search terms and definitions",
        exact: true
      })
    ).toBeVisible()
    await expect(
      main.getByRole("region", { name: "My communities", exact: true })
    ).toHaveCount(0)
    for (const label of [
      "Create community",
      "Create vocabulary",
      "Create collection",
      "Recently added",
      "Recent discussion"
    ])
      await expect(main.getByText(label, { exact: true })).toHaveCount(0)
    await checkWidth(page)
    const footer = page.getByRole("contentinfo", {
      name: "Site footer",
      exact: true
    })
    await expect(
      footer.getByRole("link", { name: /^(About|Help)$/ })
    ).toHaveCount(0)
    await expect(
      footer.getByRole("img", { name: "Metadata Research Center", exact: true })
    ).toBeVisible()
    await expect(
      footer.getByRole("img", {
        name: "National Science Foundation",
        exact: true
      })
    ).toBeVisible()
    await expect(footer).toContainText("OAC #2118201")
    await expect(
      footer.getByRole("link", { name: "Metadata access", exact: true })
    ).toHaveAttribute("href", "/docs/metadata-access")
    await expect(
      primary.getByRole("link", { name: "About", exact: true })
    ).toHaveAttribute("href", "/about")
    await expect(
      primary.getByRole("link", { name: "Help", exact: true })
    ).toHaveAttribute("href", "/docs/guide")
    await expect(
      page.getByRole("button", { name: "Help", exact: true })
    ).toHaveCount(0)
    await page.screenshot({
      path: resolve(output, "home-visitor-desktop.png"),
      fullPage: true,
      animations: "disabled"
    })
    record(
      "Visitor home exposes term search and four entry actions without organization setup or activity panels"
    )
    await main.getByRole("link", { name: "Add a term", exact: true }).click()
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/login" &&
        Boolean(url.searchParams.get("returnTo")?.startsWith("/add"))
    )
    await expect(
      page.getByRole("link", { name: /Create.*account/i }).first()
    ).toBeVisible()
    record(
      "Anonymous Add a term preserves its destination through the authentication entry"
    )

    await signInAs(context, base, member.userId)
    await page.goto(base)
    await expect(
      primary.getByRole("link", { name: "Communities", exact: true })
    ).toHaveCount(0)
    await checkLightAppearance(page)
    await primary
      .getByRole("button", { name: member.userName, exact: true })
      .click()
    await expect(page.getByRole("menu")).toBeVisible()
    await checkLightAppearance(page)
    await expect(
      page.getByRole("menuitem", { name: "Appearance", exact: true })
    ).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menu")).toHaveCount(0)
    await expect(
      selectedCommunity.getByRole("button", {
        name: "Community: All communities",
        exact: true
      })
    ).toBeVisible()
    await expect(
      main.getByRole("link", { name: "Add a term", exact: true })
    ).toHaveAttribute("href", defaultAddHref)
    record(
      "Anonymous and stale membership selections show All communities and add to the default vocabulary"
    )
    const memberships = page.getByRole("region", {
      name: "My communities",
      exact: true
    })
    await expect(memberships).toBeVisible()
    await expect(
      memberships.getByRole("link", {
        name: member.communityTitle,
        exact: true
      })
    ).toHaveAttribute("href", `/communities/${member.communitySlug}`)
    await expect(
      memberships.getByRole("link", {
        name: second.communityTitle,
        exact: true
      })
    ).toHaveCount(0)
    allowPreferenceWrites = true
    await memberships
      .getByRole("link", { name: member.communityTitle, exact: true })
      .press("Enter")
    await expect(page).toHaveURL(`${base}/communities/${member.communitySlug}`)
    await expect(
      page
        .getByRole("navigation", { name: "Community workspace", exact: true })
        .getByRole("link", { name: "Vocabulary", exact: true })
    ).toHaveAttribute("aria-current", "page")
    await primary
      .getByRole("link", { name: "Browse terms", exact: true })
      .click()
    await expect(page).toHaveURL(`${base}/terms`)
    await expect(
      selectedCommunity.getByRole("button", {
        name: `Community: ${member.communityTitle}`,
        exact: true
      })
    ).toBeVisible()
    assert.deepEqual(
      preferenceWrites,
      [member.communityId],
      "Opening a joined community from Home selects it"
    )
    assert.equal(
      (
        await db
          .select({ activeCommunityId: usersTable.activeCommunityId })
          .from(usersTable)
          .where(eq(usersTable.id, member.userId))
      )[0].activeCommunityId,
      member.communityId
    )
    record(
      "Home membership links select the joined community so Browse terms uses the same scope"
    )
    allowPreferenceWrites = false
    preferenceWrites.length = 0

    await db.insert(communityMembersTable).values({
      communityId: second.communityId,
      userId: member.userId,
      role: "member",
      addedById: second.userId
    })
    await db
      .update(usersTable)
      .set({ activeCommunityId: second.communityId })
      .where(eq(usersTable.id, member.userId))
    await page.goto(base)
    await expect(
      selectedCommunity.getByRole("button", {
        name: `Community: ${second.communityTitle}`,
        exact: true
      })
    ).toBeVisible()
    await expect(
      main.getByRole("link", { name: "Add a term", exact: true })
    ).toHaveAttribute("href", `/add?vocabularySlug=${second.vocabularySlug}`)
    for (const fixture of [member, second])
      await expect(
        memberships.getByRole("link", {
          name: fixture.communityTitle,
          exact: true
        })
      ).toHaveAttribute("href", `/communities/${fixture.communitySlug}`)
    await main.getByRole("link", { name: "Add a term", exact: true }).click()
    await expect(destination).toContainText(second.vocabularyTitle)
    await expect(
      destination.getByText("Vocabulary", { exact: true })
    ).toBeVisible()
    await page.goto(`${base}/add?vocabularySlug=${member.vocabularySlug}`)
    await expect(destination).toContainText(member.vocabularyTitle)
    await expect(
      selectedCommunity.getByRole("button", {
        name: `Community: ${second.communityTitle}`,
        exact: true
      })
    ).toBeVisible()
    assert.deepEqual(preferenceWrites, [])
    record(
      "Home Add uses the selected community while an explicit vocabulary retains its own destination"
    )

    await page.goto(
      `${base}/add?draftId=${draftId}&vocabularySlug=${second.vocabularySlug}`
    )
    const writing = page.getByRole("textbox", {
      name: "Definition",
      exact: true
    })
    await expect(writing).toHaveValue(payload.definition)
    await expect(destination).toContainText(member.vocabularyTitle)
    await expect(destination).not.toContainText(second.vocabularyTitle)
    await page
      .getByRole("button", { name: "Review definition", exact: true })
      .click()
    await expect(
      page.getByRole("region", { name: "Review and publish", exact: true })
    ).toBeVisible()
    await expect(destination).toContainText(member.vocabularyTitle)
    await page.getByRole("button", { name: "Edit term", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Confirm your term", exact: true })
    ).toBeVisible()
    await expect(destination).toContainText(member.vocabularyTitle)
    record(
      "A restored draft keeps its original vocabulary through Write, Review and Confirm despite another selected community and URL vocabulary"
    )

    allowPreferenceWrites = true
    await selectedCommunity.getByRole("button", { name: /^Community:/ }).click()
    await page
      .getByRole("menuitemradio", { name: member.communityTitle, exact: true })
      .click()
    await expect(page).toHaveURL(`${base}/communities/${member.communitySlug}`)
    await expect(
      selectedCommunity.getByRole("button", {
        name: `Community: ${member.communityTitle}`,
        exact: true
      })
    ).toBeVisible()
    assert.deepEqual(preferenceWrites, [member.communityId])
    const saved = await db.query.termDraftsTable.findFirst({
      where: eq(termDraftsTable.id, draftId)
    })
    assert.equal(saved?.payload?.vocabularySlug, member.vocabularySlug)
    assert.equal(saved?.payload?.definition, payload.definition)
    await selectedCommunity.getByRole("button", { name: /^Community:/ }).click()
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page
        .getByRole("menuitemradio", {
          name: member.communityTitle,
          exact: true
        })
        .click()
    ])
    await expect(page).toHaveURL(`${base}/communities/${member.communitySlug}`)
    assert.deepEqual(
      preferenceWrites,
      [member.communityId],
      "Selecting the current community opens it without another preference write"
    )
    await selectedCommunity.getByRole("button", { name: /^Community:/ }).click()
    await page
      .getByRole("menuitemradio", { name: "All communities", exact: true })
      .click()
    await expect(page).toHaveURL(`${base}/`)
    await expect(
      main.getByRole("link", { name: "Add a term", exact: true })
    ).toHaveAttribute("href", defaultAddHref)
    await selectedCommunity.getByRole("button", { name: /^Community:/ }).click()
    await page
      .getByRole("menuitemradio", { name: second.communityTitle, exact: true })
      .click()
    await expect(page).toHaveURL(`${base}/communities/${second.communitySlug}`)
    assert.deepEqual(preferenceWrites, [
      member.communityId,
      null,
      second.communityId
    ])
    await page.goto(base)
    await memberships
      .getByRole("link", { name: member.communityTitle, exact: true })
      .click()
    await expect(page).toHaveURL(`${base}/communities/${member.communitySlug}`)
    await expect(
      selectedCommunity.getByRole("button", {
        name: `Community: ${member.communityTitle}`,
        exact: true
      })
    ).toBeVisible()
    assert.deepEqual(preferenceWrites, [
      member.communityId,
      null,
      second.communityId,
      member.communityId
    ])
    allowPreferenceWrites = false
    record(
      "Dropdown and Home community links share selection; All communities restores the default Add destination and saved work stays intact"
    )
    await expect(
      primary.getByRole("link", { name: "My work", exact: true })
    ).toHaveAttribute("href", "/profile/drafts")
    await primary.getByRole("link", { name: "My work", exact: true }).click()
    await expect(page).toHaveURL(`${base}/profile/drafts`)
    await expect(
      page.getByRole("heading", { name: "My work", exact: true })
    ).toBeVisible()
    record(
      "Multiple memberships remain distinct direct links and global My work opens personal work"
    )

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto(base)
      await checkWidth(page)
      const selectionButton = selectedCommunity.getByRole("button", {
        name: `Community: ${member.communityTitle}`,
        exact: true
      })
      await expect(selectionButton).toBeVisible()
      assert.equal(
        await selectionButton.evaluate(
          (element) => element.closest("details") === null
        ),
        true,
        "Community selection stays outside the collapsed mobile menu"
      )
      await page.screenshot({
        path: resolve(output, `home-member-community-${width}.png`),
        fullPage: true,
        animations: "disabled"
      })
    }
    record(
      "Selected community stays visible outside navigation at 320px and 390px without horizontal overflow"
    )
    await page.getByLabel("Open navigation menu", { exact: true }).click()
    await checkLightAppearance(page)
    const mobile = page.getByRole("navigation", { name: "Mobile", exact: true })
    await expect(
      page
        .getByRole("link", { name: "Help", exact: true })
        .filter({ visible: true })
    ).toBeVisible()
    assert.deepEqual(
      await mobile
        .locator(
          'a[href="/terms"], a[href="/communities"], a[href="/profile/drafts"], a[href="/about"]'
        )
        .allTextContents(),
      ["Browse terms", "My work", "About"]
    )
    await page.screenshot({
      path: resolve(output, "home-member-mobile-menu.png"),
      fullPage: true,
      animations: "disabled"
    })
    await expect(
      mobile.getByRole("link", { name: "Communities", exact: true })
    ).toHaveCount(0)
    await page.getByLabel("Close navigation menu", { exact: true }).click()
    await selectedCommunity.getByRole("button", { name: /^Community:/ }).click()
    await page
      .getByRole("menuitem", { name: "Find communities", exact: true })
      .click()
    await expect(page).toHaveURL(`${base}/communities`)
    await expect(
      page.getByLabel("Open navigation menu", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "Create community", exact: true })
    ).toHaveCount(0)
    record(
      "Mobile uses the desktop navigation order, fits the viewport and closes after following a link"
    )

    await signInAs(context, base, newcomer.userId)
    await page.goto(base)
    await expect(
      selectedCommunity.getByText("All communities", { exact: true })
    ).toBeVisible()
    await expect(
      main.getByRole("link", { name: "Add a term", exact: true })
    ).toHaveAttribute("href", defaultAddHref)
    await expect(
      memberships.getByRole("link", {
        name: newcomer.communityTitle,
        exact: true
      })
    ).toHaveCount(0)
    await expect(
      main.getByRole("link", { name: "Join a community", exact: true })
    ).toBeVisible()
    record(
      "An account without memberships receives a joining route instead of unrelated community links"
    )
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signInAs(context, base, member.userId)
    const denied = await context.request.get(`${base}/admin/communities`, {
      maxRedirects: 0
    })
    assert.ok(
      [303, 307, 308, 403, 404].includes(denied.status()),
      "Non-admin cannot enter community administration"
    )
    await db
      .update(usersTable)
      .set({ role: "admin" })
      .where(eq(usersTable.id, member.userId))
    await page.goto(`${base}/admin/communities`)
    await expect(
      page.getByRole("button", { name: "Create community", exact: true })
    ).toBeVisible()
    await page.goto(`${base}/communities`)
    await expect(
      page.getByRole("button", { name: "Create community", exact: true })
    ).toHaveCount(0)
    await page.goto(`${base}/setup?task=community`)
    await expect(page).toHaveURL(`${base}/admin/communities`)
    record(
      "Community creation is located in Admin and legacy setup URLs lead there without changing permissions"
    )
    await context.clearCookies()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(base)
    await checkWidth(page)
    await page.getByLabel("Open navigation menu", { exact: true }).click()
    await checkLightAppearance(page)
    await page.getByLabel("Close navigation menu", { exact: true }).click()
    record(
      "Light appearance remains active with stored and system dark preferences; visitor, account and mobile navigation expose no appearance controls"
    )
    await page.screenshot({
      path: resolve(output, "home-visitor-mobile.png"),
      fullPage: true,
      animations: "disabled"
    })
    assert.deepEqual(errors, [], "No browser runtime errors")
    assert.deepEqual(
      blocked,
      [],
      "No unrelated mutation, publication or provider request was attempted"
    )
  } catch (error) {
    failure = error
  } finally {
    if (browser) await closeBrowserAfterRoutes(browser)
    try {
      // The stale-scope regression intentionally points one fixture user at
      // another fixture community. Clear only these owned users before deleting
      // any community, rather than relying on individual cleanup order.
      if (fixtures.length)
        await db
          .update(usersTable)
          .set({ activeCommunityId: null })
          .where(
            inArray(
              usersTable.id,
              fixtures.map((fixture) => fixture.userId)
            )
          )
      if (fixtures[0] && fixtures[1])
        await db
          .delete(communityMembersTable)
          .where(
            and(
              eq(communityMembersTable.communityId, fixtures[1].communityId),
              eq(communityMembersTable.userId, fixtures[0].userId)
            )
          )
      for (const fixture of fixtures.reverse())
        await removeGuidedSetupFixture(fixture)
      cleaned = true
    } catch (error) {
      cleanupFailure = error
    }
    if (output)
      await writeFile(
        resolve(output, "results.json"),
        JSON.stringify(
          {
            passed,
            blocked,
            errors,
            cleaned,
            failure:
              failure instanceof Error ? failure.message : (failure ?? null),
            cleanupFailure:
              cleanupFailure instanceof Error
                ? cleanupFailure.message
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
    `PASS ${passed.length} home/header scenarios; fixtures removed. Evidence: ${output}`
  )
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
