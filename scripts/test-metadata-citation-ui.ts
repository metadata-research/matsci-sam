// Requires a running local SAM preview and its local database. Ontology
// matches are answered locally and metadata submissions are captured, so only
// the owned fixture touches the DB.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { expect } from "@playwright/test"
import {
  createTermFixture,
  launchBrowser,
  localPreviewBase,
  rememberView,
  removeTermFixture,
  signInAs,
  stubTrpc,
  type TermFixture
} from "./ui-test-harness"

const CHEBI = {
  key: "chebi",
  title: "ChEBI, Chemical Entities of Biological Interest (CORE)",
  version: "254",
  license: "CC-BY-4.0"
}
const CONCEPT = "http://purl.obolibrary.org/obo/CHEBI_15377"
const NOTE = "A usage note the citation test writes."

// The fields a submission carries, without the term and language.
const sent = (input: Record<string, unknown>) => ({
  fieldKey: input.fieldKey,
  value: input.value,
  sourceLabel: input.sourceLabel,
  sourceIri: input.sourceIri,
  sourceVersion: input.sourceVersion
})

async function main() {
  const base = localPreviewBase()
  const stamp = randomUUID()
  const term = `citation test ${stamp}`
  const browser = await launchBrowser()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 }
  })
  const page = await context.newPage()
  const unexpected: string[] = []
  const errors: string[] = []
  const submitted: Record<string, unknown>[] = []
  let ontologyQueries = 0
  let fixture: TermFixture | undefined
  page.on("pageerror", (error) => errors.push(error.message))
  context.on("request", (request) => {
    if (request.url().includes("ontologyContext.candidates"))
      ontologyQueries += 1
  })
  await stubTrpc(context, {
    unexpected,
    queries: {
      "ontologyContext.candidates": () => ({
        query: term,
        mode: "exact",
        sources: [
          {
            source: CHEBI,
            candidates: [{ iri: CONCEPT, label: term, match: "exact" }],
            truncated: false
          }
        ]
      }),
      "ontologyContext.hierarchy": () => ({
        source: CHEBI,
        entity: { iri: CONCEPT, label: term },
        parents: [
          {
            iri: "http://purl.obolibrary.org/obo/CHEBI_33693",
            label: "oxygen hydride",
            predicate: "http://www.w3.org/2000/01/rdf-schema#subClassOf",
            direction: "outgoing"
          }
        ],
        truncated: false,
        hasAnonymousSuperclasses: false
      })
    },
    mutations: {
      "termMetadata.add": (input) => {
        submitted.push(input)
        return { id: randomUUID(), status: "proposed" }
      }
    }
  })

  const tab = (name: "Simple" | "Advanced") =>
    page.getByRole("tab", { name, exact: true })
  const panel = page.locator("[data-ontology-context]")
  const cite = page.getByRole("button", {
    name: "Cite this match",
    exact: true
  })
  const relate = page.getByRole("button", {
    name: "Add as related concept",
    exact: true
  })
  const kind = page.getByLabel("Add a description")
  const note = page.getByLabel("Usage guidance")
  const sourceName = page.getByLabel("Source name or citation")
  const sourceLink = page.getByLabel("Source link")
  const sourceVersion = page.getByLabel("Source version")
  const status = page.getByRole("status").filter({ hasText: "filled" })
  const submit = page.getByRole("button", { name: "Submit for review" })

  try {
    fixture = await createTermFixture({
      userName: `Citation test ${stamp}`,
      term,
      slug: `citation_test_${stamp.replaceAll("-", "_")}`,
      definition: "A fixture definition for the citation test."
    })
    const metadata = `${base}/terms/${fixture.termId}/metadata`

    // Signed out, the matches show without the actions.
    await rememberView(context, base, "advanced")
    await page.goto(metadata, { waitUntil: "networkidle" })
    await expect(panel.getByText("oxygen hydride")).toBeVisible()
    await expect(cite).toHaveCount(0)
    await expect(relate).toHaveCount(0)

    // Simple shows no sidebar and asks for no matches.
    await signInAs(context, base, fixture.userId)
    await rememberView(context, base, "simple")
    ontologyQueries = 0
    await page.goto(metadata, { waitUntil: "networkidle" })
    await expect(
      page.getByRole("heading", { name: "Add metadata" })
    ).toBeVisible()
    await expect(cite).toHaveCount(0)
    assert.equal(ontologyQueries, 0, "Simple asks for no ontology matches")

    // A note typed first is cited to the selected match and kept.
    await note.fill(NOTE)
    await tab("Advanced").click()
    await expect(cite).toBeVisible()
    await cite.click()
    await expect(sourceName).toBeFocused()
    await expect(sourceName).toHaveValue(`${CHEBI.title}: ${term}`)
    await expect(sourceLink).toHaveValue(CONCEPT)
    await expect(sourceVersion).toHaveValue(CHEBI.version)
    await expect(status).toHaveText(
      `Source filled from ${CHEBI.title}: ${term}.`
    )
    await expect(note).toHaveValue(NOTE)

    // The related concept fills its own draft and keeps the note's.
    await relate.click()
    await expect(kind).toHaveValue("relatedConcept")
    const conceptLink = page.getByLabel("Concept link")
    await expect(conceptLink).toBeFocused()
    await expect(conceptLink).toHaveValue(CONCEPT)
    await expect(sourceName).toHaveValue(CHEBI.title)
    await expect(sourceLink).toHaveValue("")
    await expect(sourceVersion).toHaveValue(CHEBI.version)
    await expect(status).toHaveText(
      `Related concept filled: ${term} in ${CHEBI.title}.`
    )
    await kind.selectOption("usageNote")
    await expect(note).toHaveValue(NOTE)
    await expect(sourceName).toHaveValue(`${CHEBI.title}: ${term}`)

    // Each submission carries its own draft, and only that draft clears.
    await submit.click()
    await expect.poll(() => submitted.length).toBe(1)
    assert.deepEqual(sent(submitted[0]), {
      fieldKey: "usageNote",
      value: NOTE,
      sourceLabel: `${CHEBI.title}: ${term}`,
      sourceIri: CONCEPT,
      sourceVersion: CHEBI.version
    })
    await expect(note).toHaveValue("")
    await kind.selectOption("relatedConcept")
    await expect(conceptLink).toHaveValue(CONCEPT)
    await submit.click()
    await expect.poll(() => submitted.length).toBe(2)
    assert.deepEqual(sent(submitted[1]), {
      fieldKey: "relatedConcept",
      value: CONCEPT,
      sourceLabel: CHEBI.title,
      sourceIri: undefined,
      sourceVersion: CHEBI.version
    })

    assert.deepEqual(unexpected, [], "no other writes")
    assert.deepEqual(errors, [], "no page errors")
    console.log(
      "Metadata citation UI tests passed: signed-out and Simple views, citing a match, a related concept, kept drafts and submissions."
    )
  } finally {
    if (fixture) await removeTermFixture(fixture)
    await browser.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
