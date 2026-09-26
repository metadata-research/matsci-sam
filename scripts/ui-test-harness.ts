// Shared setup for the browser scripts. Each script runs against a local
// preview and its local database, answers provider calls locally, blocks every
// other write, and removes the fixtures it created.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { chromium, type BrowserContext } from "@playwright/test"
import { sealData } from "iron-session"
import { eq } from "drizzle-orm"
import { db, termsTable, usersTable } from "../drizzle"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import { deleteDefinitionRows } from "../lib/definition-purge"
import {
  INTERFACE_VIEW_COOKIE,
  type InterfaceView
} from "../lib/interface-view"
import {
  DEFAULT_VOCABULARY_SLUG,
  definitionPath,
  termPath
} from "../lib/public-identifiers"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/** The preview address, after checking that it and the database are local. */
export function localPreviewBase() {
  const base = process.env.SAM_UI_TEST_URL ?? "http://localhost:3000"
  assert.ok(
    LOCAL_HOSTS.has(new URL(base).hostname),
    "UI tests require a local preview"
  )
  assert.ok(
    LOCAL_HOSTS.has(new URL(process.env.DATABASE_URL!).hostname),
    "UI tests require a local database"
  )
  return base
}

export const launchBrowser = () =>
  chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--js-flags=--max-old-space-size=384"]
  })

type ProcedureInput = Record<string, unknown>
export type TrpcStubs = {
  /** Mutation handlers by procedure path. Others are refused and recorded. */
  mutations: Record<string, (input: ProcedureInput) => unknown>
  /** Query results to substitute inside otherwise real GET batches. */
  queries?: Record<string, () => unknown>
  unexpected: string[]
}

const procedurePaths = (url: string) =>
  new URL(url).pathname.split("/api/trpc/")[1].split(",")

/** Answers tRPC calls locally so no test can publish or call a provider. */
export async function stubTrpc(context: BrowserContext, stubs: TrpcStubs) {
  await context.route("**/api/trpc/**", async (route) => {
    const request = route.request()
    const paths = procedurePaths(request.url())
    if (request.method() === "GET") {
      const substitutes = stubs.queries ?? {}
      if (!paths.some((path) => path in substitutes)) return route.continue()
      const response = await route.fetch()
      const results = (await response.json()) as unknown[]
      const body = results.map((result, index) => {
        const substitute = substitutes[paths[index]]
        return substitute ? { result: { data: substitute() } } : result
      })
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body)
      })
    }
    const inputs = (request.postDataJSON() ?? {}) as Record<
      string,
      ProcedureInput
    >
    const responses = paths.map((path, index) => {
      const handler = stubs.mutations[path]
      if (!handler) {
        stubs.unexpected.push(path)
        return {
          error: { message: "Mutation blocked by UI test", code: -32600 }
        }
      }
      return { result: { data: handler(inputs[index] ?? {}) } }
    })
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(responses)
    })
  })
  await context.route("**/api/contribution-files**", async (route) => {
    const request = route.request()
    if (request.method() === "GET") return route.continue()
    stubs.unexpected.push(`contribution-files ${request.method()}`)
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "Upload blocked by UI test" })
    })
  })
}

/** One ChEBI lookup result carrying one reference. */
export function chebiLookup(term: string, sourceText: string) {
  const lookupId = randomUUID()
  return {
    lookupId,
    term: term.trim().toLowerCase(),
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

export type TermFixture = {
  userId: number
  userName: string
  termId: number
  definitionId: number
  termPath: string
  path: string
}

/** A user, a term and one definition, owned by the script that made them. */
export async function createTermFixture({
  userName,
  term,
  slug,
  definition
}: {
  userName: string
  term: string
  slug: string
  definition: string
}): Promise<TermFixture> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(usersTable)
      .values({ name: userName, role: "user" })
      .returning()
    const [row] = await tx
      .insert(termsTable)
      .values({ term, slug, vocabularySlug: DEFAULT_VOCABULARY_SLUG })
      .returning()
    const created = await createDefinitionWithInitialRevision(tx, {
      termId: row.id,
      authorId: user.id,
      definition,
      example: "",
      changeNote: "UI test fixture",
      source: "initial"
    })
    return {
      userId: user.id,
      userName,
      termId: row.id,
      definitionId: created.definition.id,
      termPath: termPath(row.slug, row.vocabularySlug),
      path: definitionPath(
        row.slug,
        created.definition.definitionNumber,
        row.vocabularySlug
      )
    }
  })
}

/** Removes the fixture after confirming the user row is still the test's own. */
export async function removeTermFixture(fixture: TermFixture) {
  await db.transaction(async (tx) => {
    const user = await tx.query.usersTable.findFirst({
      where: eq(usersTable.id, fixture.userId)
    })
    assert.equal(user?.name, fixture.userName)
    await deleteDefinitionRows(tx, fixture.definitionId)
    await tx.delete(termsTable).where(eq(termsTable.id, fixture.termId))
    await tx.delete(usersTable).where(eq(usersTable.id, fixture.userId))
  })
}

export async function signInAs(
  context: BrowserContext,
  base: string,
  userId: number
) {
  await context.addCookies([
    {
      name: "matsci-sam-session",
      value: await sealData(
        { id: userId },
        { password: process.env.SESSION_PASSWORD! }
      ),
      url: base,
      httpOnly: true,
      sameSite: "Lax"
    }
  ])
}

/** Sets the remembered view, as a visitor's earlier choice would. */
export const rememberView = (
  context: BrowserContext,
  base: string,
  view: InterfaceView
) =>
  context.addCookies([{ name: INTERFACE_VIEW_COOKIE, value: view, url: base }])
