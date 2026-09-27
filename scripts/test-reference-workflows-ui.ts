// Requires a running local SAM preview and its local database. Provider,
// ontology and publication calls are intercepted. Only the owned fixtures
// touch the DB.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { expect, type Locator } from "@playwright/test"
import { db } from "../drizzle"
import {
  chebiLookup,
  createTermFixture,
  launchBrowser,
  localPreviewBase,
  referenceLookup,
  removeTermFixture,
  signInAs,
  stubTrpc,
  type TermFixture
} from "./ui-test-harness"

// A vocabulary that models synonyms as bare concepts mapped from the concept
// that carries the hierarchy, as the NIST Materials Data Vocabulary does.
const NIST = {
  key: "nist-imrr",
  title: "Materials Data Vocabulary (NIST Materials Resource Registry)",
  version: "1.1.0-rev20210726",
  license: "NIST-PD",
  kind: "vocabulary"
}
const SYNONYM = "https://data.nist.gov/od/dm/nmrr/vocab/?tema=725"
const CONCEPT = "https://data.nist.gov/od/dm/nmrr/vocab/?tema=300"
const PARENT = "https://data.nist.gov/od/dm/nmrr/vocab/?tema=299"
const EXACT_MATCH = "http://www.w3.org/2004/02/skos/core#exactMatch"
const CLOSE_MATCH = "http://www.w3.org/2004/02/skos/core#closeMatch"
const EQUIVALENT_CLASS = "http://www.w3.org/2002/07/owl#equivalentClass"
// Mappings whose target the source does not define, so they carry no label.
const CLOSE_IRI = "https://example.org/vocab/annealing-close"
const EQUIVALENT_IRI = "https://example.org/ontology#AnnealingProcess"
const EMMO_TITLE =
  "EMMO, the Elementary Multiperspective Material Ontology (CHAMEO closure)"

async function main() {
  const base = localPreviewBase()
  const stamp = randomUUID()
  const sourceText = "A source definition supplied by the test fixture."
  const emmoText = "A heat treatment definition supplied by the test fixture."
  const original = "A contributor's own draft."
  const twoSources = `two sources ${stamp}`
  const browser = await launchBrowser()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 }
  })
  const page = await context.newPage()
  const unexpected: string[] = []
  const errors: string[] = []
  let lookups = 0
  let fixture: TermFixture | undefined
  page.on("pageerror", (error) => errors.push(error.message))
  await stubTrpc(context, {
    unexpected,
    queries: {
      // Only the two-source term has ontology matches, in one vocabulary.
      "ontologyContext.candidates": (input) => ({
        query: input.term,
        mode: input.mode,
        sources:
          input.term === twoSources
            ? [
                {
                  source: NIST,
                  candidates: [
                    { iri: SYNONYM, label: twoSources, match: "exact" }
                  ],
                  truncated: false
                }
              ]
            : []
      }),
      "ontologyContext.hierarchy": (input) =>
        input.iri === CONCEPT
          ? {
              source: NIST,
              entity: { iri: CONCEPT, label: "annealing and homogenization" },
              parents: [
                {
                  iri: PARENT,
                  label: "Synthesis and processing",
                  predicate: "http://www.w3.org/2004/02/skos/core#broader",
                  direction: "outgoing"
                }
              ],
              mappings: [
                {
                  iri: SYNONYM,
                  label: twoSources,
                  predicate: EXACT_MATCH,
                  direction: "outgoing"
                }
              ],
              truncated: false,
              hasAnonymousSuperclasses: false
            }
          : {
              source: NIST,
              entity: { iri: SYNONYM, label: twoSources },
              parents: [],
              // The exact match is stated in both directions. The other
              // kinds point outside the source, without labels.
              mappings: [
                {
                  iri: CONCEPT,
                  label: "annealing and homogenization",
                  predicate: EXACT_MATCH,
                  direction: "incoming"
                },
                {
                  iri: CONCEPT,
                  label: "annealing and homogenization",
                  predicate: EXACT_MATCH,
                  direction: "outgoing"
                },
                {
                  iri: CLOSE_IRI,
                  predicate: CLOSE_MATCH,
                  direction: "outgoing"
                },
                {
                  iri: EQUIVALENT_IRI,
                  predicate: EQUIVALENT_CLASS,
                  direction: "outgoing"
                }
              ],
              truncated: false,
              hasAnonymousSuperclasses: false
            }
    },
    mutations: {
      "termReferences.recordAction": () => null,
      "termReferences.retrieveChebi": (input) => {
        lookups += 1
        const term = String(input.term)
        return term === twoSources
          ? referenceLookup(term, [
              {
                term: "Reference test material",
                definition: sourceText,
                source: "ChEBI CORE",
                sourceKey: "chebi",
                sourceIri: "http://purl.obolibrary.org/obo/CHEBI_15377",
                version: "test",
                license: "CC-BY-4.0"
              },
              {
                term: "Annealing",
                definition: emmoText,
                source: EMMO_TITLE,
                sourceKey: "emmo",
                sourceIri:
                  "https://w3id.org/emmo#EMMO_9900d51c_bdd3_40e8_aa82_ad1aa7092f71",
                version: "1.0.3",
                license: "CC-BY-4.0"
              }
            ])
          : chebiLookup(term, sourceText)
      }
    }
  })

  type EditorKind = "add" | "revision"
  const sourceAddedNotice =
    "Added to your definition with a citation. You can remove the citation during review."

  async function showReferences(scope: Locator, kind: EditorKind) {
    if (kind === "add") {
      await scope.getByRole("tab", { name: "Advanced", exact: true }).click()
    } else {
      await scope
        .getByRole("button", { name: "View references", exact: true })
        .click()
    }
    const references = scope.locator('[aria-label="Reference definitions"]')
    await expect(references).toBeVisible()
    if (kind === "add")
      await expect(
        references.getByText("Reference definitions", { exact: true })
      ).toBeVisible()
    else {
      // The revision editor names the tool and counts its matches.
      await expect(
        scope.locator('aside[aria-label="Reference lookup"]')
      ).toBeVisible()
      await expect(
        scope.getByRole("status").filter({
          hasText: "Reference definitions: 1 possible match"
        })
      ).toBeVisible()
    }
    await expect(
      references.getByText("Reference test material", { exact: true })
    ).toBeVisible()
    return references
  }

  async function addSource(scope: Locator, kind: EditorKind) {
    const references = await showReferences(scope, kind)
    // Add reveals its first match automatically. Revision editing keeps the
    // deliberate reveal action. Scope the action to the references, not
    // adjacent tools.
    if (kind === "revision") {
      const reveal = references.getByRole("button", {
        name: "Show definition",
        exact: true
      })
      if (await reveal.count()) await reveal.click()
    }
    await references
      .getByRole("button", { name: "Add to definition", exact: true })
      .click()
    // Insertion selects the added text in a later frame. Wait for that focus
    // so a following fill replaces the whole value.
    await expect(
      scope.getByRole("textbox", { name: "Definition", exact: true })
    ).toBeFocused()
  }

  async function checkUndo(
    scope: Locator,
    undoName: string,
    reviewName: string,
    backName: string,
    kind: EditorKind
  ) {
    const editor = scope.getByRole("textbox", {
      name: "Definition",
      exact: true
    })
    const undo = scope.getByRole("button", { name: undoName, exact: true })
    await editor.fill(original)
    await addSource(scope, kind)
    await expect(editor).toHaveValue(`${original}\n\n${sourceText}`)
    await expect(undo).toBeVisible()
    if (kind === "add") {
      const beforeToggle = lookups
      await scope.getByRole("tab", { name: "Simple", exact: true }).click()
      await expect(editor).toHaveValue(`${original}\n\n${sourceText}`)
      await expect(undo).toBeVisible()
      await expect(
        scope.locator('[aria-label="Reference definitions"]')
      ).toBeHidden()
      await scope.getByRole("tab", { name: "Advanced", exact: true }).click()
      await expect(editor).toHaveValue(`${original}\n\n${sourceText}`)
      assert.equal(
        lookups,
        beforeToggle,
        "changing views must reuse the source lookup"
      )
    }
    await undo.click()
    await expect(editor).toHaveValue(original)
    const references = await showReferences(scope, kind)
    await expect(
      references.getByText(sourceAddedNotice, { exact: true })
    ).toHaveCount(0)
    await expect(
      references.getByRole("button", {
        name: "Cite without inserting",
        exact: true
      })
    ).toBeEnabled()
    await addSource(scope, kind)
    const later = `${original}\n\n${sourceText}\nA sentence written afterward.`
    await editor.fill(later)
    await expect(undo).toHaveCount(0)
    await expect(editor).toHaveValue(later)
    await addSource(scope, kind)
    await expect(undo).toBeVisible()
    const withSecondSource = await editor.inputValue()
    await scope.getByRole("button", { name: reviewName, exact: true }).click()
    await scope
      .getByRole("button", {
        name: "Remove citation: Reference test material",
        exact: true
      })
      .click()
    await scope.getByRole("button", { name: backName, exact: true }).click()
    await expect(undo).toHaveCount(0)
    await expect(editor).toHaveValue(withSecondSource)
  }

  /** A lookup from two sources shows each with its licence, and each cites. */
  async function checkTwoSources(scope: Locator) {
    const references = scope.locator('[aria-label="Reference definitions"]')
    await expect(references).toBeVisible()
    const block = (term: string) =>
      references.locator("div.rounded-md.border.p-4").filter({ hasText: term })
    const chebi = block("Reference test material")
    const emmo = block("Annealing")
    // The closest match opens with its source, identifier, release and licence.
    await expect(chebi.getByText(sourceText, { exact: true })).toBeVisible()
    await expect(chebi.getByText("ChEBI CORE")).toContainText(
      "ChEBI CORE · CHEBI:15377 · release test · licence CC-BY-4.0"
    )
    await expect(
      chebi.getByRole("link", { name: "CC-BY-4.0", exact: true })
    ).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/")
    await chebi
      .getByRole("button", { name: "Cite without inserting", exact: true })
      .click()
    await expect(
      chebi.getByRole("button", { name: "Citation attached", exact: true })
    ).toBeVisible()
    // The other source waits behind Other matches with its own licence.
    await references
      .getByRole("button", { name: "Other matches (1)", exact: true })
      .click()
    await expect(
      emmo.getByRole("link", { name: "Annealing", exact: true })
    ).toHaveAttribute(
      "href",
      "https://w3id.org/emmo#EMMO_9900d51c_bdd3_40e8_aa82_ad1aa7092f71"
    )
    await emmo
      .getByRole("button", { name: "Show definition", exact: true })
      .click()
    await expect(emmo.getByText(emmoText, { exact: true })).toBeVisible()
    await expect(emmo.getByText(EMMO_TITLE)).toContainText(
      `${EMMO_TITLE} · EMMO_9900d51c_bdd3_40e8_aa82_ad1aa7092f71 · release 1.0.3 · licence CC-BY-4.0`
    )
    await emmo
      .getByRole("button", { name: "Cite without inserting", exact: true })
      .click()
    await expect(
      references.getByRole("button", {
        name: "Citation attached",
        exact: true
      })
    ).toHaveCount(2)
    // Review lists each citation with its source, release and licence.
    await scope
      .getByRole("textbox", { name: "Definition", exact: true })
      .fill(original)
    await scope
      .getByRole("button", { name: "Review definition", exact: true })
      .click()
    const review = scope.locator('section[aria-label="Review and publish"]')
    await expect(
      review.getByText("ChEBI CORE: Reference test material", { exact: false })
    ).toContainText(
      "ChEBI CORE: Reference test material · release test · CC-BY-4.0"
    )
    await expect(
      review.getByText(`${EMMO_TITLE}: Annealing`, { exact: false })
    ).toContainText(`${EMMO_TITLE}: Annealing · release 1.0.3 · CC-BY-4.0`)
    for (const name of [
      "Remove citation: Reference test material",
      "Remove citation: Annealing"
    ])
      await expect(
        review.getByRole("button", { name, exact: true })
      ).toBeVisible()
    await scope
      .getByRole("button", { name: "Back to writing", exact: true })
      .click()
  }

  /** A vocabulary is named as one, and a mapped concept opens in place. */
  async function checkMappedConcept(scope: Locator) {
    const panel = scope.locator("[data-ontology-context]")
    const opened = panel.getByText("Mapped concept, opened from")
    const back = panel.getByRole("button", {
      name: "Back to the match",
      exact: true
    })
    await expect(
      panel.getByText(`${NIST.title} (vocabulary)`, { exact: true })
    ).toBeVisible()
    await expect(
      panel.getByText(`${NIST.title} (vocabulary) · Selected match`, {
        exact: true
      })
    ).toBeVisible()
    // The synonym entry has no parents. Its exact match carries them.
    await expect(
      panel.getByText("No named parents stated in this source.", {
        exact: true
      })
    ).toBeVisible()
    // A mapping stated in both directions is one entry. Each kind is named,
    // and only a labelled one is a step.
    const mapped = panel.locator('ul[aria-label="Mapped concepts"]')
    await expect(mapped.locator("li")).toHaveText([
      "Exact match: annealing and homogenization",
      "Close match: annealing-close(label unavailable)",
      "Equivalent class: AnnealingProcess(label unavailable)"
    ])
    await expect(mapped.getByRole("button")).toHaveCount(1)
    await expect(mapped).toHaveAttribute("tabindex", "0")
    await expect(back).toHaveCount(0)
    const concept = panel.getByRole("button", {
      name: "annealing and homogenization",
      exact: true
    })
    await concept.focus()
    await page.keyboard.press("Enter")
    await expect(opened).toBeVisible()
    await expect(opened).toContainText(twoSources)
    await expect(back).toBeFocused()
    await expect(
      panel.getByText(`${NIST.title} (vocabulary) · Mapped concept`, {
        exact: true
      })
    ).toBeVisible()
    await expect(
      panel.getByText("Broader terms", { exact: true })
    ).toBeVisible()
    await expect(
      panel.getByText("Synthesis and processing", { exact: true })
    ).toBeVisible()
    await expect(
      panel.getByText("No named parents stated in this source.")
    ).toHaveCount(0)
    // The opened concept maps back to the match, which is text, not a step.
    await expect(mapped.locator("li")).toHaveText([
      `Exact match: ${twoSources}(selected match)`
    ])
    await expect(mapped.getByRole("button")).toHaveCount(0)
    await page.keyboard.press("Enter")
    await expect(opened).toHaveCount(0)
    await expect(concept).toBeFocused()
    await expect(
      panel.getByText("No named parents stated in this source.", {
        exact: true
      })
    ).toBeVisible()
    await expect(
      panel.getByText("Synthesis and processing", { exact: true })
    ).toHaveCount(0)
    // Searching similar names clears any opened concept.
    await panel
      .getByRole("button", {
        name: "annealing and homogenization",
        exact: true
      })
      .click()
    await expect(opened).toBeVisible()
    await panel
      .getByRole("button", { name: "Search similar names", exact: true })
      .click()
    await expect(opened).toHaveCount(0)
    await panel
      .getByRole("button", { name: "Back to exact matches", exact: true })
      .click()
    await expect(
      panel.getByText("No named parents stated in this source.", {
        exact: true
      })
    ).toBeVisible()
  }

  try {
    await page.goto(`${base}/discussion`, { waitUntil: "networkidle" })
    await expect(
      page.getByRole("heading", { name: "Discussion", exact: true })
    ).toBeVisible()
    assert.equal(lookups, 0, "anonymous reading must not start lookups")
    fixture = await createTermFixture({
      userName: `Reference UI test ${stamp}`,
      term: `reference ui ${stamp}`,
      slug: `reference_ui_${stamp}`,
      definition: original
    })
    await signInAs(context, base, fixture.userId)
    await page.goto(`${base}/discussion`, { waitUntil: "networkidle" })
    assert.equal(lookups, 0, "signed-in reading must not start lookups")
    await page
      .getByRole("button", { name: "Start an alternative", exact: true })
      .first()
      .click()
    await expect.poll(() => lookups).toBe(1)
    await page.goto(`${base}/add?term=undo%20test%20${stamp}`)
    // The label differs by view, and the view is a remembered choice.
    await page.getByRole("button", { name: /^Confirm term/ }).click()
    await checkUndo(
      page.locator("main"),
      "Undo source insertion",
      "Review definition",
      "Back to writing",
      "add"
    )
    // Advanced is now the remembered view, so the lookup starts on confirm.
    await page.goto(`${base}/add?term=${encodeURIComponent(twoSources)}`)
    const beforeConfirm = lookups
    await page.getByRole("button", { name: /^Confirm term/ }).click()
    await expect.poll(() => lookups).toBe(beforeConfirm + 1)
    await checkTwoSources(page.locator("main"))
    await checkMappedConcept(page.locator("main"))
    assert.equal(
      lookups,
      beforeConfirm + 1,
      "citing and exploring start no further lookup"
    )
    await page.goto(`${base}${fixture.path}`)
    await page
      .getByRole("button", { name: "Create a new version", exact: true })
      .click()
    const dialog = page.getByRole("dialog")
    await dialog
      .getByRole("textbox", { name: "Change note", exact: true })
      .fill("Test an insertion and subsequent editing")
    await checkUndo(
      dialog,
      "Undo",
      "Review new version",
      "Back to editing",
      "revision"
    )
    assert.deepEqual(
      unexpected,
      [],
      "no publication or other mutation should be attempted"
    )
    assert.deepEqual(errors, [])
    console.log(
      "Reference UI tests passed: deliberate discussion lookup, immediate insertion Undo, preservation of later writing and citation choices in both editors, two sources with their licences and citations, a vocabulary named as one, and a mapped concept opened and closed."
    )
  } finally {
    try {
      await browser.close()
    } catch (error) {
      console.error(error)
    }
    try {
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
