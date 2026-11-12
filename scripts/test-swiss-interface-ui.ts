// Browser plugin not available. Read-only checks of the permanent Swiss UI.
// No fixtures, community switches, review choices or votes are written.
import "dotenv/config"
import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  expect as baseExpect,
  type BrowserContext,
  type Page
} from "@playwright/test"
import { reviewFingerprints } from "./community-review-test-support"
import {
  closeBrowserAfterRoutes,
  launchBrowser,
  localPreviewBase,
  rememberView,
  signInAs
} from "./ui-test-harness"

const expect = baseExpect.configure({ timeout: 20000 })
const routes = [
  { name: "home", path: "/", heading: /Materials Science/ },
  { name: "terms", path: "/terms", heading: "Browse Terms" },
  {
    name: "quartz",
    path: "/vocabulary/materials_design_examples/quartz",
    heading: "Quartz"
  },
  {
    name: "catalog",
    path: "/communities/matcore_development",
    heading: "MatCore Development"
  },
  {
    name: "review",
    path: "/communities/matcore_development?view=review&round=9cd9294a-649d-4c1a-bc29-5dfcde2026cf&profile=pf",
    heading: "MatCore Development"
  }
] as const

async function presentation(page: Page) {
  await expect(
    page.getByRole("complementary", {
      name: "Local design options",
      exact: true
    })
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: /^(Swiss|Square controls|Current)$/ })
  ).toHaveCount(0)
  await expect(
    page.getByRole("link", { name: "Local mockup", exact: true })
  ).toHaveCount(0)
  for (const attribute of [
    "data-design-preview",
    "data-controls-preview",
    "data-type-preview"
  ])
    await expect(page.locator("html")).not.toHaveAttribute(attribute)
  await page.evaluate(() => document.fonts.ready)
  const fonts = await page.evaluate(() => {
    const heading = document.querySelector("main h1")!
    const paragraph = document.querySelector("main p")!
    const control = document.querySelector(
      "main input, main button, main select, main a[href]"
    )!
    return {
      body: getComputedStyle(document.body).fontFamily,
      heading: getComputedStyle(heading).fontFamily,
      paragraph: getComputedStyle(paragraph).fontFamily,
      control: getComputedStyle(control).fontFamily
    }
  })
  for (const [sample, font] of Object.entries(fonts))
    assert.equal(
      font.replace(/["'\s]/g, "").toLowerCase(),
      "helveticaneue,helvetica,arial,sans-serif",
      `${sample} uses the default local Swiss font stack`
    )
  const header = page.getByRole("banner"),
    mobile = page.viewportSize()!.width < 1151
  await expect(header).toHaveCSS("border-radius", mobile ? "28px" : "9999px")
  await expect(header).toHaveCSS("min-height", mobile ? "64px" : "72px")
  await expect(header).toHaveCSS("background-color", "rgb(255, 255, 255)")
  await expect(header).toHaveCSS("border-top-width", "1px")
  await expect(header).not.toHaveCSS("box-shadow", "none")
  const controls = page.locator(
    'main button:visible, main input:not([type="radio"]):not([type="checkbox"]):not([type="range"]):visible, main textarea:visible, main select:visible, main [data-slot="button"]:visible'
  )
  assert.ok((await controls.count()) > 0, "Representative page controls exist")
  for (const control of await controls.all())
    await expect(control).toHaveCSS("border-radius", "0px")
  const cards = page.locator(
    'main article:visible, main [data-slot="card"]:not(.rounded-full):visible, main :is(article,section,aside,nav,div,p,ul,ol,li,details,pre,a):is(.rounded-lg,.rounded-md):not(.rounded-full):visible, main [aria-label="Review session"] label:has(input[type="radio"]):visible'
  )
  for (const card of await cards.all())
    await expect(card).toHaveCSS("border-radius", "0px")
  const roundShapes = await page
    .locator(
      'main [data-slot="card"].rounded-full, main [data-slot="avatar"], main input[type="radio"]'
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        kind: node.matches('input[type="radio"]')
          ? "radio"
          : node.matches('[data-slot="avatar"]')
            ? "avatar"
            : "vote rail",
        radius: getComputedStyle(node).borderRadius,
        appearance: getComputedStyle(node).appearance
      }))
    )
  for (const shape of roundShapes) {
    if (shape.kind === "radio")
      assert.equal(
        shape.appearance,
        "auto",
        "Native radio appearance preserved"
      )
    else
      assert.ok(parseFloat(shape.radius) >= 50, `${shape.kind} stays rounded`)
  }
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    )
    .toBe(true)
  return {
    fonts,
    controls: await controls.count(),
    cards: await cards.count(),
    roundShapes
  }
}

async function footer(page: Page) {
  const footer = page.getByRole("contentinfo", {
    name: "Site footer",
    exact: true
  })
  await footer.scrollIntoViewIfNeeded()
  await expect(footer).toContainText("OAC #2118201")
  await expect(
    footer.getByRole("link", { name: "Metadata access", exact: true })
  ).toHaveAttribute("href", "/docs/metadata-access")
  for (const name of [
    "Metadata Research Center",
    "National Science Foundation"
  ]) {
    const logo = footer.getByRole("img", { name, exact: true })
    await expect(logo).toHaveCount(1)
    await expect
      .poll(() =>
        logo.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0
        )
      )
      .toBe(true)
  }
  await expect(
    footer.getByRole("link", { name: "Metadata Research Center", exact: true })
  ).toHaveAttribute("href", "https://mrc.cci.drexel.edu/")
}

async function main() {
  const base = localPreviewBase(),
    origin = new URL(base).origin
  const database = new URL(process.env.DATABASE_URL!)
  assert.equal(database.hostname, "127.0.0.1")
  assert.equal(database.port, "55447")
  assert.equal(database.pathname, "/matsci_shared_review_preview_20261110")
  assert.notEqual(
    process.env.SAM_LOCAL_DESIGN_PREVIEW,
    "1",
    "Validate the permanent UI without the old preview flag"
  )
  const output = resolve(
    process.env.SAM_SWISS_UI_OUTPUT_DIR ??
      "/home/chris/dev/matsci/.matsci-stage/design-options-20261111/swiss-default-ui"
  )
  await mkdir(output, { recursive: true })
  const before = await reviewFingerprints()
  await writeFile(
    resolve(output, "database-before.json"),
    JSON.stringify(before, null, 2)
  )
  const errors: string[] = [],
    blocked: string[] = [],
    passed: string[] = [],
    screenshots: string[] = [],
    samples: unknown[] = []
  let failure: unknown,
    unchanged = false
  const browser = await launchBrowser()
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
      if (message.type() === "error")
        errors.push(`${message.text()} ${message.location().url}`)
    })
  }
  const capture = async (page: Page, name: string) => {
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      path: resolve(output, name),
      fullPage: true,
      animations: "disabled"
    })
    screenshots.push(name)
  }
  const pass = (name: string) => {
    passed.push(name)
    console.log(`PASS ${name}`)
  }
  try {
    for (const [size, viewport] of [
      ["desktop", { width: 1440, height: 1000 }],
      ["mobile", { width: 390, height: 844 }]
    ] as const) {
      const context = await browser.newContext({
        viewport,
        reducedMotion: "reduce"
      })
      await signInAs(context, base, 6)
      await rememberView(context, base, "simple")
      await context.addInitScript(() =>
        sessionStorage.setItem("matsci-local-design", "current")
      )
      await guard(context)
      const page = await context.newPage()
      observe(page)
      for (const route of routes) {
        await page.goto(base + route.path)
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: route.heading,
            exact: typeof route.heading === "string"
          })
        ).toBeVisible()
        await expect(page.locator("nextjs-portal")).toHaveCount(0)
        if (route.name === "catalog")
          await expect(
            page.getByRole("navigation", {
              name: "Field hierarchy",
              exact: true
            })
          ).toBeVisible()
        if (route.name === "review") {
          const review = page.getByRole("region", {
            name: "Review session",
            exact: true
          })
          await expect(review.getByRole("article")).toBeVisible()
          const dataset = review
            .getByRole("region", { name: "Dataset example", exact: true })
            .locator(":scope > details")
          if ((await dataset.getAttribute("open")) !== null)
            await dataset.locator(":scope > summary").click()
        }
        const sample = await presentation(page)
        if (["quartz", "catalog", "review"].includes(route.name))
          assert.ok(sample.cards > 0, "Content-card samples exist")
        if (route.name === "quartz")
          assert.ok(
            sample.roundShapes.some((shape) => shape.kind === "vote rail"),
            "Actual vote rail sampled"
          )
        if (route.name === "review")
          assert.ok(
            sample.roundShapes.some((shape) => shape.kind === "radio"),
            "Actual native review radios sampled"
          )
        samples.push({ page: `${size} ${route.name}`, ...sample })
        await footer(page)
        await capture(page, `${size}-${route.name}.png`)
        pass(
          `${size} ${route.name}: default Swiss typography, square controls/cards, rounded header and applicable indicators, footer, no choices or overflow`
        )
      }
      await page.goto(`${base}/?design=current`)
      await presentation(page)
      assert.equal(
        await page.evaluate(() =>
          sessionStorage.getItem("matsci-local-design")
        ),
        "current"
      )
      if (size === "mobile") {
        await page.getByLabel("Open navigation menu", { exact: true }).click()
        await expect(
          page.getByRole("navigation", { name: "Mobile", exact: true })
        ).toBeVisible()
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            )
          )
          .toBe(true)
        await page
          .getByLabel("Close navigation menu", { exact: true })
          .press("Escape")
      }
      pass(
        `${size}: old design=current URL and stale session preference have no effect`
      )
      await context.close()

      const anonymous = await browser.newContext({
        viewport,
        javaScriptEnabled: false
      })
      await guard(anonymous)
      const staticPage = await anonymous.newPage()
      observe(staticPage)
      await staticPage.goto(`${base}/?design=current`)
      await expect(staticPage.getByRole("heading", { level: 1 })).toBeVisible()
      await presentation(staticPage)
      await footer(staticPage)
      await capture(staticPage, `${size}-anonymous-no-javascript.png`)
      await anonymous.close()
      pass(
        `${size}: anonymous server-rendered page has Swiss styles before JavaScript`
      )
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(blocked, [])
  } catch (error) {
    failure = error
    const page = browser.contexts().flatMap((context) => context.pages())[0]
    if (page)
      await page
        .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
        .catch(() => {})
  } finally {
    await closeBrowserAfterRoutes(browser)
    const after = await reviewFingerprints()
    await writeFile(
      resolve(output, "database-after.json"),
      JSON.stringify(after, null, 2)
    )
    unchanged = JSON.stringify(after) === JSON.stringify(before)
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          base,
          browser: "Playwright Chromium; Browser plugin not available",
          passed,
          errors,
          blocked,
          screenshots,
          samples,
          tableCount: Object.keys(before).length,
          unchanged,
          failure: failure instanceof Error ? failure.stack : (failure ?? null)
        },
        null,
        2
      )
    )
  }
  assert.ok(unchanged, "All database rows remain unchanged")
  if (failure) throw failure
  console.log(
    `PASS ${passed.length} focused checks; ${Object.keys(before).length} table fingerprints unchanged. ${output}`
  )
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
