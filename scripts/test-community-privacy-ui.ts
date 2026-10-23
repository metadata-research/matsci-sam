// Local production HTTP tests with disposable, invented content. No AI or email.
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
  type BrowserContext
} from "@playwright/test"
import { and, eq, inArray, ne } from "drizzle-orm"
import {
  db,
  communitiesTable,
  communityMembersTable,
  communityAccessRequestsTable,
  contributionFilesTable,
  sourceExtractionsTable,
  termsTable,
  usersTable,
  termDraftsTable
} from "../drizzle"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import { emptyTermDraftPayload } from "../lib/term-draft-types"
import { termPath, definitionPath } from "../lib/public-identifiers"
import {
  createGuidedSetupFixture,
  removeGuidedSetupFixture,
  type GuidedSetupFixture
} from "./guided-setup-ui-fixture"
import {
  launchBrowser,
  localPreviewBase,
  signInAs,
  closeBrowserAfterRoutes
} from "./ui-test-harness"

const expect = baseExpect.configure({ timeout: 30000 })

async function main() {
  const base = localPreviewBase()
  const output = resolve(
    process.env.SAM_UI_TEST_OUTPUT_DIR ??
      `${tmpdir()}/community-privacy-${randomUUID()}`
  )
  await mkdir(output, { recursive: true })
  const fixtures: GuidedSetupFixture[] = []
  const passed: string[] = []
  const errors: string[] = []
  let browser: Browser | undefined
  let failure: unknown
  let cleanupFailure: unknown
  const record = (label: string) => {
    passed.push(label)
    console.log(`PASS ${label}`)
  }
  const query = async (
    context: BrowserContext,
    procedure: string,
    input: unknown
  ) => {
    const response = await context.request.get(
      `${base}/api/trpc/${procedure}`,
      { params: { input: JSON.stringify(input) } }
    )
    return { response, body: await response.json() }
  }
  try {
    for (let i = 0; i < 3; i++) fixtures.push(await createGuidedSetupFixture())
    const [owner, other, admin] = fixtures
    const marker = `restricted_${owner.token}`
    const publicTitle = `Permission test community ${owner.token}`
    const label = `Private field ${marker}`
    const definitionText = `Invented definition ${marker}.`
    const draftId = randomUUID()
    const openToken = randomUUID()
    const data = await db.transaction(async (tx) => {
      await tx
        .update(communitiesTable)
        .set({
          title: publicTitle,
          description: `Private description ${marker}`,
          visibility: "members",
          joinToken: openToken
        })
        .where(eq(communitiesTable.id, owner.communityId))
      await tx
        .update(communityMembersTable)
        .set({ role: "steward" })
        .where(
          and(
            eq(communityMembersTable.communityId, owner.communityId),
            eq(communityMembersTable.userId, owner.userId)
          )
        )
      await tx
        .update(usersTable)
        .set({ role: "admin" })
        .where(eq(usersTable.id, admin.userId))
      const [term] = await tx
        .insert(termsTable)
        .values({
          term: label.toLowerCase(),
          slug: marker,
          vocabularySlug: owner.vocabularySlug
        })
        .returning()
      const { definition } = await createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: owner.userId,
        definition: definitionText,
        example: "",
        changeNote: "Invented privacy fixture",
        source: "initial"
      })
      const text = `Pasted source ${marker}.`
      const [file] = await tx
        .insert(contributionFilesTable)
        .values({
          uploadedById: owner.userId,
          vocabularySlug: owner.vocabularySlug,
          termText: term.term,
          filename: "invented-source.txt",
          mediaType: "text/plain",
          byteSize: Buffer.byteLength(text),
          bytes: Buffer.from(text),
          contentHash: createHash("sha256").update(text).digest("hex"),
          role: "source",
          title: `Private source ${marker}`,
          caption: "Invented privacy test",
          citation: `Private citation ${marker}`,
          origin: "paste",
          createdAt: new Date(Date.now() - 1000).toISOString()
        })
        .returning()
      const [extraction] = await tx
        .insert(sourceExtractionsTable)
        .values({
          fileId: file.id,
          status: "ready",
          text,
          textHash: createHash("sha256").update(text).digest("hex"),
          pages: [
            {
              page: 1,
              start: 0,
              end: text.length,
              method: "text",
              label: "Page 1",
              confidence: null
            }
          ],
          completedAt: new Date().toISOString(),
          method: "text",
          parserVersion: "privacy-ui-fixture"
        })
        .returning()
      await tx
        .update(contributionFilesTable)
        .set({
          publishedRevisionId: definition.currentRevisionId,
          publishedAt: new Date().toISOString(),
          publishedExtractionId: extraction.id
        })
        .where(eq(contributionFilesTable.id, file.id))
      const payload = emptyTermDraftPayload()
      payload.vocabularySlug = owner.vocabularySlug
      payload.term = `Private draft ${marker}`
      payload.definition = `Private draft content ${marker}`
      await tx.insert(termDraftsTable).values({
        id: draftId,
        ownerId: owner.userId,
        payload,
        creationHash: createHash("sha256")
          .update(JSON.stringify(payload))
          .digest("hex")
      })
      return { term, definition, file, text }
    })
    browser = await launchBrowser()
    const anonymous = await browser.newContext()
    const outsider = await browser.newContext()
    const member = await browser.newContext()
    const administrator = await browser.newContext()
    await signInAs(outsider, base, other.userId)
    await signInAs(member, base, owner.userId)
    await signInAs(administrator, base, admin.userId)
    const path = `/communities/${owner.communitySlug}`
    const privateTermPath = termPath(data.term.slug, owner.vocabularySlug)
    const privateDefinitionPath = definitionPath(
      data.term.slug,
      data.definition.definitionNumber,
      owner.vocabularySlug
    )
    for (const context of [anonymous, outsider, member, administrator]) {
      context.on("page", (page) => {
        page.on("pageerror", (error) => errors.push(error.message))
      })
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== new URL(base).origin) {
          errors.push(`External request blocked: ${url.origin}`)
          return route.abort()
        }
        const request = route.request()
        if (request.method() === "GET" || request.method() === "HEAD")
          return route.continue()
        const permitted = [
          "communities.requestAccess",
          "communities.reviewAccessRequest",
          "communities.setVisibility"
        ]
        const paths = url.pathname.split("/api/trpc/")[1]?.split(",") ?? []
        if (paths.length && paths.every((p) => permitted.includes(p)))
          return route.continue()
        errors.push(
          `Unexpected write blocked: ${request.method()} ${url.pathname}`
        )
        return route.abort()
      })
    }
    const visitorPage = await anonymous.newPage()
    await visitorPage.goto(`${base}${path}?view=vocabulary`)
    await expect(
      visitorPage.getByRole("heading", { name: publicTitle })
    ).toBeVisible()
    await expect(
      visitorPage.getByRole("link", { name: "Sign in to request access" })
    ).toBeVisible()
    assert.ok(
      !(await visitorPage.content()).includes(marker),
      "Restricted description/content not serialized in HTML or RSC"
    )
    for (const width of [1280, 390, 320]) {
      await visitorPage.setViewportSize({ width, height: 900 })
      assert.equal(
        await visitorPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
    }
    await visitorPage.screenshot({
      path: resolve(output, "restricted-community-mobile.png"),
      fullPage: true
    })
    record(
      "Public name and sign-in affordance, no private content, desktop and mobile layouts"
    )
    await visitorPage.goto(`${base}/invite/${openToken}`)
    await expect(
      visitorPage.getByText(/This community requires approval/)
    ).toBeVisible()
    await expect(
      visitorPage.getByRole("link", { name: "Open community", exact: true })
    ).toHaveAttribute("href", path)
    record(
      "Old reusable join link explains approval and leads to the community request page"
    )
    for (const context of [anonymous, outsider]) {
      for (const view of [
        "overview",
        "vocabulary",
        "work",
        "collections",
        "people",
        "surveys"
      ]) {
        const response = await context.request.get(
          `${base}${path}?view=${view}`
        )
        assert.equal(response.status(), 200)
        assert.ok(
          !(await response.text()).includes(marker),
          `${view} does not serialize restricted text`
        )
      }
      for (const suffix of [
        privateTermPath,
        privateDefinitionPath,
        `/vocabulary/${owner.vocabularySlug}`,
        `/sources/${data.file.id}`,
        `/api/contribution-files/${data.file.id}`
      ]) {
        const response = await context.request.get(`${base}${suffix}`)
        assert.equal(response.status(), 404, suffix)
        const body = await response.text()
        for (const secret of [
          definitionText,
          data.text,
          data.term.term,
          `Private description ${marker}`
        ])
          assert.ok(!body.includes(secret), `${suffix} excludes private text`)
      }
      for (const [procedure, input] of [
        ["definitions.get", { definitionId: data.definition.id }],
        ["definitions.list", { termId: data.term.id }],
        ["definitions.currentVersion", data.definition.id],
        ["terms.provenance", data.term.id],
        ["termDrafts.get", { id: draftId }],
        ["matcoreWorkflow.workspace", { vocabularySlug: owner.vocabularySlug }],
        ["matcoreWorkflow.catalog", { vocabularySlug: owner.vocabularySlug }]
      ] as const) {
        const { response, body } = await query(context, procedure, input)
        assert.equal(
          response.status(),
          procedure === "terms.provenance"
            ? 200
            : procedure === "termDrafts.get" && context === anonymous
              ? 401
              : 404,
          procedure
        )
        assert.ok(!JSON.stringify(body).includes(marker), procedure)
        if (procedure === "terms.provenance")
          assert.equal(body.result.data, null)
      }
      const search = await query(context, "search.terms", {
        query: marker,
        limit: 10
      })
      assert.equal(search.response.status(), 200)
      assert.deepEqual(search.body.result.data, [])
      const batched = await context.request.get(
        `${base}/api/trpc/definitions.get,search.terms`,
        {
          params: {
            batch: "1",
            input: JSON.stringify({
              0: { definitionId: data.definition.id },
              1: { query: marker, limit: 10 }
            })
          }
        }
      )
      assert.ok(
        !(await batched.text()).includes(marker),
        "Batched queries cannot expose private content"
      )
      const directory = await context.request.get(`${base}/communities`)
      assert.ok(
        !(await directory.text()).includes(marker),
        "Community directory masks private description"
      )
    }
    record(
      "Anonymous and nonmember direct routes, tRPC batches, search, files and directory are restricted"
    )
    for (const context of [member, administrator]) {
      const response = await context.request.get(
        `${base}${privateDefinitionPath}`
      )
      assert.equal(response.status(), 200)
      assert.ok((await response.text()).includes(marker))
      const file = await context.request.get(
        `${base}/api/contribution-files/${data.file.id}`
      )
      assert.equal(file.status(), 200)
      assert.equal(await file.text(), data.text)
      assert.match(file.headers()["cache-control"], /private|no-store/)
      const result = await query(context, "definitions.get", {
        definitionId: data.definition.id
      })
      assert.equal(result.response.status(), 200)
      assert.ok(JSON.stringify(result.body).includes(marker))
    }
    assert.equal(
      (
        await query(member, "termDrafts.get", { id: draftId })
      ).response.status(),
      200
    )
    assert.equal(
      (
        await query(administrator, "termDrafts.get", { id: draftId })
      ).response.status(),
      404,
      "Admin cannot read someone else's personal draft"
    )
    record(
      "Members and administrators read shared content; drafts remain author-only"
    )
    for (const suffix of [
      "/",
      "/terms",
      "/dataset.ttl",
      "/vocabulary.ttl",
      "/graphs/vocabulary",
      "/graphs/kos",
      "/graphs/provenance",
      "/graphs/matcore",
      "/graphs/meta"
    ]) {
      const response = await anonymous.request.get(`${base}${suffix}`, {
        timeout: 60000
      })
      assert.equal(response.status(), 200, suffix)
      assert.ok(
        !(await response.text()).includes(marker),
        `${suffix} excludes private content`
      )
    }
    record(
      "Public homepage, browsing and all public graph exports omit restricted records"
    )
    const otherPage = await outsider.newPage()
    await otherPage.goto(`${base}${path}`)
    await otherPage
      .getByRole("button", { name: "Request access", exact: true })
      .click()
    await expect(otherPage.getByRole("status")).toContainText("awaiting review")
    await otherPage.reload()
    await expect(otherPage.getByRole("status")).toContainText("awaiting review")
    const stewardPage = await member.newPage()
    await stewardPage.goto(`${base}${path}?view=people`)
    const requests = stewardPage.getByRole("region", {
      name: "Access requests"
    })
    await expect(
      requests.getByText(other.userName, { exact: true })
    ).toBeVisible()
    await requests.getByRole("button", { name: "Approve", exact: true }).click()
    await expect(
      requests.getByText("No requests are awaiting review.")
    ).toBeVisible()
    await otherPage.reload()
    await expect(
      otherPage.getByRole("navigation", { name: "Community workspace" })
    ).toBeVisible()
    assert.equal(
      (await outsider.request.get(`${base}${privateDefinitionPath}`)).status(),
      200
    )
    assert.equal(
      (
        await query(outsider, "termDrafts.get", { id: draftId })
      ).response.status(),
      404
    )
    record(
      "Access request persists through reload, steward approval grants shared access without exposing drafts"
    )
    await db
      .update(communityMembersTable)
      .set({ removedAt: new Date().toISOString(), removedById: owner.userId })
      .where(
        and(
          eq(communityMembersTable.communityId, owner.communityId),
          eq(communityMembersTable.userId, other.userId)
        )
      )
    await otherPage.reload()
    await expect(
      otherPage.getByRole("heading", { name: "Members only", exact: true })
    ).toBeVisible()
    assert.equal(
      (
        await outsider.request.get(
          `${base}/api/contribution-files/${data.file.id}`
        )
      ).status(),
      404
    )
    assert.equal(
      (
        await query(outsider, "definitions.get", {
          definitionId: data.definition.id
        })
      ).response.status(),
      404
    )
    record(
      "Membership removal takes effect on the next page, API and source request"
    )
    await stewardPage.goto(`${base}${path}`)
    await stewardPage
      .getByRole("link", { name: "Settings", exact: true })
      .click()
    await stewardPage.getByLabel("Who can view content").selectOption("public")
    await stewardPage
      .getByRole("button", { name: "Save content access", exact: true })
      .click()
    await expect(stewardPage.getByLabel("Who can view content")).toHaveValue(
      "public"
    )
    await expect
      .poll(async () =>
        (
          await anonymous.request.get(`${base}${privateDefinitionPath}`)
        ).status()
      )
      .toBe(200)
    await stewardPage.getByLabel("Who can view content").selectOption("members")
    await stewardPage
      .getByRole("button", { name: "Save content access", exact: true })
      .click()
    await expect
      .poll(async () =>
        (
          await anonymous.request.get(`${base}${privateDefinitionPath}`)
        ).status()
      )
      .toBe(404)
    record("Steward can change generic community visibility in both directions")
    assert.deepEqual(errors, [])
  } catch (error) {
    failure = error
    console.error(error)
  } finally {
    if (browser) await closeBrowserAfterRoutes(browser)
    try {
      for (const fixture of fixtures) {
        await db
          .delete(communityAccessRequestsTable)
          .where(
            eq(communityAccessRequestsTable.communityId, fixture.communityId)
          )
        await db
          .delete(communityMembersTable)
          .where(
            and(
              eq(communityMembersTable.communityId, fixture.communityId),
              ne(communityMembersTable.userId, fixture.userId)
            )
          )
      }
      for (const fixture of [...fixtures].reverse())
        await removeGuidedSetupFixture(fixture)
      if (fixtures.length)
        assert.equal(
          (
            await db
              .select()
              .from(communitiesTable)
              .where(
                inArray(
                  communitiesTable.id,
                  fixtures.map((f) => f.communityId)
                )
              )
          ).length,
          0
        )
    } catch (error) {
      cleanupFailure = error
      console.error("Cleanup failed", error)
    }
    await writeFile(
      resolve(output, "results.json"),
      JSON.stringify(
        {
          passed,
          errors,
          fixtureCleanup: !cleanupFailure,
          failure: failure instanceof Error ? failure.message : failure,
          cleanupFailure:
            cleanupFailure instanceof Error
              ? cleanupFailure.message
              : cleanupFailure
        },
        null,
        2
      ) + "\n"
    )
  }
  if (failure || cleanupFailure) process.exitCode = 1
}
void main().finally(() => db.$client.end())
