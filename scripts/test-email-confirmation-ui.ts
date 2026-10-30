// Real local HTTP handlers and browser cookies; synthetic accounts only.
// No email is sent and no external identity provider is contacted.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { eq, inArray } from "drizzle-orm"
import { expect as baseExpect } from "@playwright/test"
import { unsealData } from "iron-session"
import { db, usersTable, emailAuthTokensTable } from "../drizzle"
import { createOneTimeToken } from "../lib/auth-tokens"
import {
  hashEmailAuthToken,
  createEmailAuthLinkFragment
} from "../lib/email-auth-token"
import { launchBrowser, localPreviewBase, signInAs } from "./ui-test-harness"

const expect = baseExpect.configure({ timeout: 30000 })

async function main() {
  const base = localPreviewBase()
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /security|_ci|scratch/
  )
  const output = process.env.SAM_UI_TEST_SCREENSHOTS
  if (output) await mkdir(output, { recursive: true })
  const browser = await launchBrowser()
  const stamp = randomUUID()
  const accounts = await db
    .insert(usersTable)
    .values([
      { name: "Link recipient", email: `recipient-${stamp}@example.test` },
      { name: "Link owner", email: `owner-${stamp}@example.test` }
    ])
    .returning()
  const [recipient, owner] = accounts
  const unexpected: string[] = []
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 }
      })
      const page = await context.newPage()
      const posts: string[] = []
      page.on("pageerror", (error) => unexpected.push(error.message))
      page.on("requestfailed", (request) => {
        if (!request.failure()?.errorText.includes("ERR_ABORTED"))
          unexpected.push(
            `Request failed: ${new URL(request.url()).pathname} ${request.failure()?.errorText}`
          )
      })
      await context.route("**/*", async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        if (
          url.origin !== base ||
          (request.method() !== "GET" &&
            url.pathname !== "/api/auth/email/verify")
        ) {
          unexpected.push(`${request.method()} ${url.origin}${url.pathname}`)
          return route.abort()
        }
        if (request.method() === "POST") {
          posts.push(request.postDataJSON().action)
          assert.equal(
            request.headers().origin,
            base,
            "confirmation POST must retain its same-origin Origin header"
          )
        }
        return route.continue()
      })
      const identity = async () => {
        const cookie = (await context.cookies()).find(
          (c) => c.name === "matsci-sam-session"
        )
        return cookie
          ? (
              await unsealData<{ id?: number }>(cookie.value, {
                password: process.env.SESSION_PASSWORD!
              })
            ).id
          : undefined
      }
      const token = createOneTimeToken()
      await db.insert(emailAuthTokensTable).values({
        email: owner.email!,
        tokenHash: hashEmailAuthToken(token, "/profile"),
        expiresAt: new Date(Date.now() + 900000).toISOString()
      })
      const unused = async () =>
        !(
          await db.query.emailAuthTokensTable.findFirst({
            where: eq(
              emailAuthTokensTable.tokenHash,
              hashEmailAuthToken(token, "/profile")
            )
          })
        )?.usedAt
      const link =
        base +
        "/register/verify#" +
        createEmailAuthLinkFragment(token, "/profile")
      await signInAs(context, base, recipient.id)
      await page.goto(link)
      await expect(page.getByText(owner.email!, { exact: true })).toBeVisible()
      await expect(
        page.getByText(
          "You are signed in to another account. Continuing will switch accounts.",
          { exact: true }
        )
      ).toBeVisible()
      await expect(
        page.getByRole("button", {
          name: "Switch account and continue",
          exact: true
        })
      ).toBeEnabled()
      assert.equal(await identity(), recipient.id)
      assert.ok(await unused())
      assert.deepEqual(
        posts,
        ["prepare"],
        "opening a link must not confirm it, including StrictMode replay"
      )
      assert.equal(
        new URL(page.url()).hash,
        "",
        "token must be removed from the address bar"
      )
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
      if (output)
        await page.screenshot({
          path: `${output}/confirmation-${width}.png`,
          fullPage: true
        })
      await page.getByRole("link", { name: "Cancel", exact: true }).click()
      await expect(page).toHaveURL(base + "/")
      assert.equal(await identity(), recipient.id)
      assert.ok(await unused())
      await page.goto(link)
      const button = page.getByRole("button", {
        name: "Switch account and continue",
        exact: true
      })
      await expect(button).toBeEnabled()
      await button.evaluate((element) => {
        ;(element as HTMLButtonElement).click()
        ;(element as HTMLButtonElement).click()
      })
      await expect(page).toHaveURL(base + "/profile")
      assert.equal(await identity(), owner.id)
      assert.equal(
        posts.filter((action) => action === "confirm").length,
        1,
        "rapid clicks must submit once"
      )
      assert.equal(await unused(), false)
      await page.goto(link)
      await expect(
        page.getByRole("alert").filter({ hasText: "invalid or has expired" })
      ).toBeVisible()
      await expect(
        page.getByRole("button", { name: "Sign in and continue", exact: true })
      ).toHaveCount(0)
      assert.equal(await identity(), owner.id)
      if (output)
        await page.screenshot({
          path: `${output}/expired-link-${width}.png`,
          fullPage: true
        })
      await context.close()
      console.log(
        `PASS: ${width}px account preview, cancellation, explicit switch, rapid clicks, token scrubbing and replay`
      )
    }
    assert.deepEqual(unexpected, [])
  } finally {
    if (unexpected.length) console.error({ unexpected })
    await browser.close()
    await db.delete(emailAuthTokensTable).where(
      inArray(
        emailAuthTokensTable.email,
        accounts.map((a) => a.email!)
      )
    )
    await db.delete(usersTable).where(
      inArray(
        usersTable.id,
        accounts.map((a) => a.id)
      )
    )
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
