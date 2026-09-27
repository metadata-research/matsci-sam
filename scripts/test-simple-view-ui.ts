// Requires a running local SAM preview and its local database. Provider,
// assistant catalog and publication calls are answered locally. Only the owned
// fixtures touch the DB.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { expect } from "@playwright/test"
import { db } from "../drizzle"
import { eq } from "drizzle-orm"
import { studiesTable } from "../drizzle"
import {
  chebiLookup,
  createStudyFixture,
  createTermFixture,
  launchBrowser,
  localPreviewBase,
  rememberView,
  removeStudyFixture,
  removeTermFixture,
  signInAs,
  stubTrpc,
  type StudyFixture,
  type TermFixture
} from "./ui-test-harness"

// A vocabulary whose synonym entry is a bare concept, mapped from the concept
// that carries the hierarchy.
const NIST = {
  key: "nist-imrr",
  title: "Materials Data Vocabulary (NIST Materials Resource Registry)",
  version: "1.1.0-rev20210726",
  license: "NIST-PD",
  kind: "vocabulary"
}
const SYNONYM = "https://data.nist.gov/od/dm/nmrr/vocab/?tema=725"
const OTHER_SYNONYM = "https://data.nist.gov/od/dm/nmrr/vocab/?tema=727"
const CONCEPT = "https://data.nist.gov/od/dm/nmrr/vocab/?tema=300"
const PARENT = "https://data.nist.gov/od/dm/nmrr/vocab/?tema=299"
const EXACT_MATCH = "http://www.w3.org/2004/02/skos/core#exactMatch"
const BROADER = "http://www.w3.org/2004/02/skos/core#broader"
// A second source, an ontology, whose match has a superclass.
const EMMO = {
  key: "emmo",
  title: "EMMO, the Elementary Multiperspective Material Ontology",
  version: "1.0.3",
  license: "CC-BY-4.0",
  kind: "ontology"
}
const EMMO_ANNEALING =
  "https://w3id.org/emmo#EMMO_9900d51c_bdd3_40e8_aa82_ad1aa7092f71"
const HEAT_TREATMENT = "https://w3id.org/emmo#EMMO_HeatTreatment"

async function main() {
  const base = localPreviewBase()
  const stamp = randomUUID()
  const fixtureTerm = `simple view ${stamp}`
  const assistantLabel = "Test assistant"
  const modelDraft = "A model draft returned by the Simple view test."
  const browser = await launchBrowser()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 }
  })
  const page = await context.newPage()
  const unexpected: string[] = []
  const errors: string[] = []
  let lookups = 0
  let suggestions = 0
  let fixture: TermFixture | undefined
  let study: StudyFixture | undefined
  page.on("pageerror", (error) => errors.push(error.message))
  await stubTrpc(context, {
    unexpected,
    queries: {
      // The helper names the assistant, so the catalog is fixed here.
      "definitionAssistants.catalog": () => ({
        profiles: [
          {
            id: "default",
            label: assistantLabel,
            available: true,
            reason: null
          }
        ],
        defaultProfile: "default",
        preferredProfile: null,
        agentOne: {
          configured: false,
          enabled: false,
          validated: false,
          validatedAt: null
        }
      }),
      // The fixture term matches two vocabulary entries, synonyms whose exact
      // match carries the parents, and one ontology class.
      "ontologyContext.candidates": (input) => ({
        query: input.term,
        mode: input.mode,
        sources:
          input.term === fixtureTerm
            ? [
                {
                  source: NIST,
                  candidates: [
                    { iri: SYNONYM, label: fixtureTerm, match: "exact" },
                    { iri: OTHER_SYNONYM, label: fixtureTerm, match: "exact" }
                  ],
                  truncated: false
                },
                {
                  source: EMMO,
                  candidates: [
                    { iri: EMMO_ANNEALING, label: fixtureTerm, match: "exact" }
                  ],
                  truncated: false
                }
              ]
            : []
      }),
      "ontologyContext.hierarchy": (input) => {
        const base = { truncated: false, hasAnonymousSuperclasses: false }
        if (input.iri === CONCEPT)
          return {
            ...base,
            source: NIST,
            entity: { iri: CONCEPT, label: "annealing and homogenization" },
            parents: [
              {
                iri: PARENT,
                label: "Synthesis and processing",
                predicate: BROADER,
                direction: "outgoing"
              }
            ],
            // The concept maps to both synonyms, as the vocabulary states.
            mappings: [SYNONYM, OTHER_SYNONYM].map((iri) => ({
              iri,
              label: fixtureTerm,
              predicate: EXACT_MATCH,
              direction: "outgoing"
            }))
          }
        if (input.iri === EMMO_ANNEALING)
          return {
            ...base,
            source: EMMO,
            entity: { iri: EMMO_ANNEALING, label: fixtureTerm },
            parents: [
              {
                iri: HEAT_TREATMENT,
                label: "HeatTreatment",
                predicate: "http://www.w3.org/2000/01/rdf-schema#subClassOf",
                direction: "outgoing"
              }
            ],
            mappings: []
          }
        return {
          ...base,
          source: NIST,
          entity: { iri: String(input.iri), label: fixtureTerm },
          parents: [],
          mappings: [
            {
              iri: CONCEPT,
              label: "annealing and homogenization",
              predicate: EXACT_MATCH,
              direction: "incoming"
            }
          ]
        }
      }
    },
    mutations: {
      "termReferences.recordAction": () => null,
      "termReferences.retrieveChebi": (input) => {
        lookups += 1
        return chebiLookup(
          String(input.term),
          "A source definition supplied by the test fixture."
        )
      },
      "aiAssist.suggestNewTerm": (input) => {
        suggestions += 1
        return {
          suggestionId: 900000 + suggestions,
          definition: modelDraft,
          model: "test-model",
          assistantProfile: "default",
          assistantLabel,
          inference: null,
          referenceCount: 0,
          referenceInputs: [],
          requestInputs: {
            userPrompt: "Stubbed by the UI test",
            definition: input.context ?? null,
            example: null
          }
        }
      }
    }
  })

  const tab = (name: "Simple" | "Advanced") =>
    page.getByRole("tab", { name, exact: true })
  const hiddenText = (text: string) =>
    expect(page.getByText(text, { exact: true })).toBeHidden()
  const history = page.getByRole("heading", { name: "Revision history" })
  const historySection = page.locator(
    'section[aria-labelledby="revision-history-heading"]'
  )
  // The section a link leads to is marked for a moment, then unmarked.
  const expectArrival = async (section: typeof historySection) => {
    await expect(section).toHaveAttribute("data-arrived", "")
    expect(
      await section.evaluate((node) => node.getBoundingClientRect().top)
    ).toBeGreaterThanOrEqual(0)
    await expect(section).not.toHaveAttribute("data-arrived", {
      timeout: 5000
    })
  }

  try {
    fixture = await createTermFixture({
      userName: `Simple view test ${stamp}`,
      term: fixtureTerm,
      slug: `simple_view_${stamp}`,
      definition: "A fixture definition for the Simple view test."
    })

    // A first visit opens in Simple, which reports what exists only.
    await page.goto(`${base}${fixture.termPath}`, { waitUntil: "networkidle" })
    await expect(tab("Simple")).toHaveAttribute("aria-selected", "true")
    await hiddenText("No citations attached")
    for (const name of ["Revision history", "Definition 1 · revision 1"])
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0)
    for (const name of ["Discussion", "Definition page", "Propose a change"])
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible()

    await tab("Advanced").click()
    await expect(
      page.getByText("No citations attached", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Revision history", exact: true })
    ).toBeVisible()

    // The server renders the remembered choice on the next load.
    await page.reload({ waitUntil: "networkidle" })
    await expect(tab("Advanced")).toHaveAttribute("aria-selected", "true")
    await expect(
      page.getByText("No citations attached", { exact: true })
    ).toBeVisible()
    await tab("Simple").click()
    await page.reload({ waitUntil: "networkidle" })
    await expect(tab("Simple")).toHaveAttribute("aria-selected", "true")

    // A link to a section of another page marks where it lands.
    await page.getByRole("link", { name: "Discussion", exact: true }).click()
    await expectArrival(page.locator("#discussion"))

    // The definition page offers the same views.
    await page.goto(`${base}${fixture.path}`, { waitUntil: "networkidle" })
    await expect(tab("Simple")).toHaveAttribute("aria-selected", "true")
    await expect(page.getByText(/its metadata record/)).toBeHidden()
    await hiddenText("Initial publication")
    await expect(history).toHaveCount(0)
    const exampleInput = page.getByRole("textbox", { name: "Add example" })
    await expect(exampleInput).toHaveCount(0)
    await page
      .getByRole("button", { name: "Add an example", exact: true })
      .click()
    await expect(exampleInput).toBeFocused()
    await expect(page.locator("#tags-heading")).toHaveCount(0)
    await tab("Advanced").click()
    await expect(history).toBeVisible()
    await expect(page.getByText(/its metadata record/)).toBeVisible()
    await expect(
      page.getByText("No tags assigned", { exact: true })
    ).toBeVisible()
    await tab("Simple").click()

    // A link to Advanced-only detail opens Advanced for that visit only.
    await page.goto(`${base}${fixture.path}#revision-history-heading`, {
      waitUntil: "networkidle"
    })
    await expect(tab("Advanced")).toHaveAttribute("aria-selected", "true")
    await expect(history).toBeInViewport()
    await expectArrival(historySection)
    await tab("Simple").click()
    await expect(history).toHaveCount(0)
    await page.evaluate(() => {
      window.location.hash = "discussion"
      window.location.hash = "revision-history-heading"
    })
    await expect(tab("Advanced")).toHaveAttribute("aria-selected", "true")
    await expect(history).toBeInViewport()
    await expectArrival(historySection)
    await page.goto(`${base}${fixture.termPath}`, { waitUntil: "networkidle" })
    await expect(tab("Simple")).toHaveAttribute("aria-selected", "true")

    // Choosing the tab that a link opened keeps that view.
    await page.goto(`${base}${fixture.path}#revision-history-heading`, {
      waitUntil: "networkidle"
    })
    await expect(tab("Advanced")).toHaveAttribute("aria-selected", "true")
    await tab("Advanced").click()
    await page.goto(`${base}${fixture.termPath}`, { waitUntil: "networkidle" })
    await expect(tab("Advanced")).toHaveAttribute("aria-selected", "true")

    await signInAs(context, base, fixture.userId)

    // Simple metadata describes the whole term, without scope or source.
    await rememberView(context, base, "simple")
    await page.goto(`${base}/terms/${fixture.termId}/metadata`, {
      waitUntil: "networkidle"
    })
    await expect(
      page.getByRole("heading", { name: "Add metadata" })
    ).toBeVisible()
    await expect(page.getByLabel("What does this describe?")).toHaveCount(0)
    await expect(page.getByText("Source (optional)")).toHaveCount(0)
    await hiddenText("No additional metadata has been published.")
    await expect(
      page.getByRole("heading", { name: "Already recorded" })
    ).toHaveCount(0)
    const submit = page.getByRole("button", { name: "Submit for review" })
    await expect(submit).toBeDisabled()
    await page
      .getByLabel("Usage guidance")
      .fill("A usage note typed by the Simple view test.")
    await expect(submit).toBeEnabled()
    await tab("Advanced").click()
    const scope = page.getByLabel("What does this describe?")
    await expect(scope).toHaveValue("term")
    await expect(page.getByText("Source (optional)")).toBeVisible()

    // The compact sidebar names a vocabulary as one, and opens a mapped
    // concept in place of the match until Back to the match.
    const panel = page.locator("[data-ontology-context]")
    const sourceSelect = page.getByLabel("Ontology or vocabulary")
    const candidateSelect = page.getByLabel("Matched term")
    await expect(sourceSelect).toHaveValue(NIST.key)
    await expect(sourceSelect.locator("option")).toHaveText([
      `${NIST.title} (vocabulary) · 2 matches`,
      `${EMMO.title} · 1 match`
    ])
    await expect(candidateSelect).toHaveValue(SYNONYM)
    const noParents = panel.getByText(
      "No named parents stated in this source.",
      { exact: true }
    )
    const opened = panel.getByText("Mapped concept, opened from")
    const back = panel.getByRole("button", {
      name: "Back to the match",
      exact: true
    })
    const concept = panel.getByRole("button", {
      name: "annealing and homogenization",
      exact: true
    })
    const mapped = panel.locator('ul[aria-label="Mapped concepts"]')
    const cite = page.getByRole("button", {
      name: "Cite this match",
      exact: true
    })
    const citeConcept = page.getByRole("button", {
      name: "Cite this concept",
      exact: true
    })
    await expect(noParents).toBeVisible()
    await expect(back).toHaveCount(0)
    await expect(cite).toBeVisible()
    // The bounded list is reachable from the keyboard. Opening a mapped
    // concept from the keyboard moves focus to the way back.
    await expect(mapped).toHaveAttribute("tabindex", "0")
    await concept.focus()
    await page.keyboard.press("Enter")
    await expect(opened).toContainText(fixtureTerm)
    await expect(back).toBeFocused()
    await expect(
      panel.getByText("Broader terms", { exact: true })
    ).toBeVisible()
    await expect(
      panel.getByText("Synthesis and processing", { exact: true })
    ).toBeVisible()
    await expect(noParents).toHaveCount(0)
    // The opened concept lists the match as text, and its other synonym as
    // a step. Neither is described as opened from itself.
    await expect(
      mapped.locator("li").filter({ hasText: "(selected match)" })
    ).toHaveCount(1)
    await expect(
      mapped.getByRole("button", { name: fixtureTerm, exact: true })
    ).toHaveCount(1)
    // The citation actions follow the opened concept and say so.
    await expect(cite).toHaveCount(0)
    await citeConcept.click()
    await expect(page.getByLabel("Source name or citation")).toHaveValue(
      `${NIST.title}: annealing and homogenization`
    )
    await expect(page.getByLabel("Source link")).toHaveValue(CONCEPT)
    await expect(page.getByLabel("Source version")).toHaveValue(NIST.version)
    await expect(
      page.getByRole("status").filter({ hasText: "filled" })
    ).toHaveText(
      `Source filled from ${NIST.title}: annealing and homogenization.`
    )
    // Returning from the keyboard moves focus to the mapping that opened.
    await back.focus()
    await page.keyboard.press("Enter")
    await expect(opened).toHaveCount(0)
    await expect(concept).toBeFocused()
    await expect(cite).toBeVisible()
    await expect(noParents).toBeVisible()
    await expect(
      panel.getByText("Synthesis and processing", { exact: true })
    ).toHaveCount(0)
    // Choosing another match closes an opened concept.
    await concept.click()
    await expect(opened).toBeVisible()
    await candidateSelect.selectOption(OTHER_SYNONYM)
    await expect(opened).toHaveCount(0)
    await expect(noParents).toBeVisible()
    // So does choosing another source, and coming back does not reopen it.
    await concept.click()
    await expect(opened).toBeVisible()
    await sourceSelect.selectOption(EMMO.key)
    await expect(opened).toHaveCount(0)
    await expect(
      panel.getByText("Immediate superclasses", { exact: true })
    ).toBeVisible()
    await expect(
      panel.getByText("HeatTreatment", { exact: true })
    ).toBeVisible()
    await expect(mapped).toHaveCount(0)
    await sourceSelect.selectOption(NIST.key)
    await expect(opened).toHaveCount(0)
    await expect(candidateSelect).toHaveValue(OTHER_SYNONYM)
    await expect(noParents).toBeVisible()
    await scope.selectOption({ label: "Definition 1 · Revision 1" })
    // The citation opened the source section. Open it only when closed.
    const sourceSection = page.locator("details", {
      has: page.getByText("Source (optional)")
    })
    if (
      !(await sourceSection.evaluate(
        (node) => (node as HTMLDetailsElement).open
      ))
    )
      await page.getByText("Source (optional)").click()
    await page.getByLabel("Source link").fill("not a link")
    await tab("Simple").click()
    await expect(
      page.getByText("Also included from Advanced: Definition 1, a source.", {
        exact: true
      })
    ).toBeVisible()
    // A value only Advanced shows is checked here and named here.
    await submit.click()
    await expect(
      page.getByRole("alert").filter({ hasText: "Open Advanced to change it." })
    ).toHaveText(
      "Enter a complete http or https source identifier. Open Advanced to change it."
    )
    assert.ok(
      !unexpected.includes("termMetadata.add"),
      "an invalid source must not reach the server"
    )

    // Simple Add keeps example files and a cut-down assistant.
    await page.goto(
      `${base}/add?term=${encodeURIComponent(`simple add ${stamp}`)}`,
      { waitUntil: "networkidle" }
    )
    await page
      .getByRole("button", { name: "Confirm term", exact: true })
      .click()
    await expect(
      page.getByRole("button", { name: "Review definition" })
    ).toBeVisible()
    await page.waitForTimeout(500)
    assert.equal(lookups, 0, "Simple starts no lookup")
    await expect(
      page.getByRole("button", { name: "Add a citation" })
    ).toHaveCount(0)
    const exampleFile = page.getByRole("button", {
      name: "Attach an example file",
      exact: true
    })
    await exampleFile.click()
    const filePanel = page.getByRole("region", {
      name: "Attach an example file"
    })
    await expect(
      filePanel.getByRole("button", { name: "Attach example", exact: true })
    ).toBeVisible()
    await expect(page.getByLabel("Use as")).toBeHidden()
    await page
      .locator("[data-definition-toolbox]")
      .getByRole("button", { name: "Close tool" })
      .click()
    await expect(exampleFile).toBeFocused()
    await expect(exampleFile).toHaveAttribute("aria-expanded", "false")
    await page
      .getByRole("button", { name: "Help me write", exact: true })
      .click()
    const helper = page.getByRole("region", { name: "Help me write" })
    await expect(
      helper.getByText(`Sends the term to ${assistantLabel}.`, { exact: true })
    ).toBeVisible()
    await expect(
      helper.getByRole("button", { name: "Suggest a definition" })
    ).toBeVisible()
    await expect(page.getByLabel("Definition assistant")).toHaveCount(0)
    await expect(page.getByText("Inspect input text")).toHaveCount(0)
    await helper.getByRole("button", { name: "Close" }).click()
    await expect(
      page.getByRole("button", { name: "Help me write", exact: true })
    ).toBeFocused()
    const editor = page.getByRole("textbox", {
      name: "Definition",
      exact: true
    })
    await editor.fill("A definition typed by the Simple view test.")
    await page.getByRole("button", { name: "Review definition" }).click()
    const review = page.locator('section[aria-label="Review and publish"]')
    await expect(review).toBeVisible()
    for (const text of [
      "No example added.",
      "No model draft is applied to this contribution.",
      "No citations attached.",
      "Citations already attached"
    ])
      await expect(review.getByText(text, { exact: true })).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "Publish new term" })
    ).toBeVisible()
    await tab("Advanced").click()
    await expect(
      review.getByText("No citations attached.", { exact: true })
    ).toBeVisible()
    await expect(
      review.getByText("No model draft is applied to this contribution.", {
        exact: true
      })
    ).toBeVisible()

    // A citation added in Advanced stays visible at Simple review. The lookup
    // started when Advanced opened.
    await expect.poll(() => lookups).toBe(1)
    await page.getByRole("button", { name: "Back to writing" }).click()
    const references = page.locator('[aria-label="Reference definitions"]')
    await expect(references).toBeVisible()
    await references
      .getByRole("button", { name: "Add to definition", exact: true })
      .click()
    await tab("Simple").click()
    await page.getByRole("button", { name: "Review definition" }).click()
    const removeCitation = review.getByRole("button", {
      name: "Remove citation: Reference test material",
      exact: true
    })
    await expect(removeCitation).toBeVisible()
    await expect(
      review.getByRole("button", { name: "Add a citation" })
    ).toHaveCount(0)
    await removeCitation.click()
    await expect(
      page.getByRole("heading", { name: "Review your contribution" })
    ).toBeFocused()
    await expect(review.getByText("Citations", { exact: true })).toHaveCount(0)
    assert.equal(lookups, 1, "a view change starts no second lookup")

    // The cut-down assistant previews, applies and credits a model draft.
    await page.goto(
      `${base}/add?term=${encodeURIComponent(`simple assist ${stamp}`)}`,
      { waitUntil: "networkidle" }
    )
    await page
      .getByRole("button", { name: "Confirm term", exact: true })
      .click()
    await editor.fill("My own starting sentence.")
    const help = page.getByRole("button", {
      name: "Help me write",
      exact: true
    })
    await help.click()
    await expect(help).toHaveAttribute("aria-expanded", "true")
    await expect(
      helper.getByText(
        `Sends the term and your definition draft to ${assistantLabel}.`,
        { exact: true }
      )
    ).toBeVisible()
    await helper.getByRole("button", { name: "Suggest a definition" }).click()
    await expect(
      helper.getByText(
        "Use this draft replaces your writing. Undo restores it.",
        { exact: true }
      )
    ).toBeVisible()
    await expect(
      helper.getByText(`Drafted by ${assistantLabel}.`, { exact: true })
    ).toBeVisible()
    await expect(page.getByText("Inspect input text")).toHaveCount(0)
    await helper.getByRole("button", { name: "Use this draft" }).click()
    await expect(editor).toHaveValue(modelDraft)
    await expect(help).toBeDisabled()
    await expect(help).toHaveAttribute("aria-expanded", "false")
    await expect(helper).toHaveCount(0)
    await expect(page.getByText(/references? (was|were) included/)).toHaveCount(
      0
    )
    await page.getByRole("button", { name: "Review definition" }).click()
    await expect(
      review.getByText(
        `Drafted with ${assistantLabel}. Model attribution stays with this contribution.`,
        { exact: true }
      )
    ).toBeVisible()
    await expect(review.getByText("Context for this request")).toHaveCount(0)
    await tab("Advanced").click()
    await expect(
      review.getByText(/These model inputs are recorded separately/)
    ).toBeVisible()
    await tab("Simple").click()
    assert.equal(suggestions, 1, "one model request should be made")

    // The change forms follow the page's view. Simple shows no source tools
    // and starts no lookup. Advanced shows them and starts one.
    await page.goto(`${base}${fixture.path}`, { waitUntil: "networkidle" })
    await expect(tab("Simple")).toHaveAttribute("aria-selected", "true")
    const beforeReplacement = lookups
    await page
      .getByRole("button", { name: "Propose a replacement", exact: true })
      .click()
    const viewReferences = page.getByRole("button", {
      name: "View references",
      exact: true
    })
    const reviewDefinition = page.getByRole("button", {
      name: "Review definition",
      exact: true
    })
    await expect(reviewDefinition).toBeVisible()
    await expect(viewReferences).toHaveCount(0)
    await page.waitForTimeout(500)
    assert.equal(
      lookups,
      beforeReplacement,
      "a Simple change form starts no lookup"
    )
    await tab("Advanced").click()
    await expect(viewReferences).toBeVisible()
    await expect.poll(() => lookups).toBe(beforeReplacement + 1)
    await tab("Simple").click()

    // A study fixes its interface. This one uses the Simple view.
    study = await createStudyFixture({ stamp, presentation: "simple" })
    await signInAs(context, base, study.userId)
    const beforeStudy = lookups
    await page.goto(`${base}/studies/${study.studySlug}/run`, {
      waitUntil: "networkidle"
    })
    await expect(page.getByRole("tab", { name: "Advanced" })).toHaveCount(0)
    await page
      .getByRole("button", { name: "Propose a new definition", exact: true })
      .click()
    await expect(reviewDefinition).toBeVisible()
    await expect(viewReferences).toHaveCount(0)
    await page
      .getByRole("button", { name: "Back to definitions", exact: true })
      .click()
    await page
      .getByRole("button", { name: "Suggest an alternative, option 1" })
      .click()
    await expect(
      page.getByText(
        `Sends the source definition and your feedback to ${assistantLabel}.`,
        { exact: true }
      )
    ).toBeVisible()
    await expect(page.getByLabel("Definition assistant")).toHaveCount(0)
    await expect(viewReferences).toHaveCount(0)
    await page.waitForTimeout(500)
    assert.equal(lookups, beforeStudy, "a Simple study starts no lookup")

    // The legacy interface keeps the full forms of the first studies.
    await db
      .update(studiesTable)
      .set({ presentation: "legacy" })
      .where(eq(studiesTable.id, study.studyId))
    await page.reload({ waitUntil: "networkidle" })
    await page
      .getByRole("button", { name: "Suggest an alternative, option 1" })
      .click()
    await expect(page.getByLabel("Definition assistant")).toBeVisible()
    await expect(viewReferences).toBeVisible()
    await expect.poll(() => lookups).toBe(beforeStudy + 1)

    assert.deepEqual(
      unexpected,
      [],
      "no publication or other mutation should be attempted"
    )
    assert.deepEqual(errors, [])
    console.log(
      "Simple view UI tests passed: remembered view, absent-state text, Advanced details, deep links and their arrival mark, whole-term metadata and its checks, a vocabulary named as one and a mapped concept opened beside it, example files, cut-down assistant, citation review, change forms by view and a study's fixed interface."
    )
  } finally {
    try {
      await browser.close()
    } catch (error) {
      console.error(error)
    }
    try {
      if (study) await removeStudyFixture(study)
      if (fixture) await removeTermFixture(fixture)
    } finally {
      await db.$client.end()
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
