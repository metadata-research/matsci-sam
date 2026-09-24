import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  retrieveWolframResources,
  WOLFRAM_RESULTS_ENDPOINT
} from "../lib/wolfram-reference-provider"
import { beginReferenceLookup } from "../lib/chebi-reference-provider"
import {
  parseWolframResult,
  wolframSectionCopyText,
  wolframSectionReadingText,
  wolframReadingText,
  wolframResultPresentation
} from "../lib/wolfram-result-format"

function checkPresentation() {
  const source = [
    "Query:",
    "diamond",
    "",
    "Assumption:",
    'Assuming "diamond" is a mineral',
    "To use as a material set assumption=*C.diamond-_*Material-",
    "To use as a class of materials set assumption=*C.diamond-_*MaterialClass-",
    "",
    "Input interpretation:",
    "diamond (mineral)",
    "",
    "General properties:",
    "density | 3.5 g/cm^3 (at 20 °C)",
    "crystal system | cubic",
    "Values depend on sample composition.",
    "",
    "Unfamiliar output:",
    "a | b | c",
    '<script>alert("do not execute")</script>',
    "https://example.test/not-an-image.png"
  ].join("\r\n")
  const parsed = parseWolframResult(source)
  assert.deepEqual(parsed.alternatives, [
    { label: "as a material", value: "*C.diamond-_*Material-" },
    { label: "as a class of materials", value: "*C.diamond-_*MaterialClass-" }
  ])
  assert.deepEqual(
    parsed.sections.map(({ kind }) => kind),
    ["query", "assumptions", "interpretation", "content", "content"]
  )
  const assumptions = parsed.sections[1]
  assert.deepEqual(assumptions.blocks, [
    {
      kind: "text",
      text: 'Assuming "diamond" is a mineral'
    }
  ])
  const originalAssumptions = source
    .slice(
      source.indexOf("Assumption:"),
      source.indexOf("Input interpretation:")
    )
    .trim()
  assert.equal(assumptions.copyText, originalAssumptions)
  assert.ok(assumptions.text.includes("set assumption=*C.diamond-_*Material-"))
  const properties = parsed.sections[3]
  assert.deepEqual(properties.blocks, [
    {
      kind: "properties",
      rows: [
        ["density", "3.5 g/cm^3 (at 20 °C)"],
        ["crystal system", "cubic"]
      ]
    },
    { kind: "text", text: "Values depend on sample composition." }
  ])
  const copied = wolframSectionCopyText(properties, parsed.sections)
  assert.ok(copied.includes(originalAssumptions))
  assert.ok(copied.includes('Assuming "diamond" is a mineral'))
  assert.ok(copied.includes("Input interpretation:\r\ndiamond (mineral)"))
  assert.ok(
    copied.includes("General properties:\r\ndensity | 3.5 g/cm^3 (at 20 °C)")
  )
  assert.ok(copied.includes("Values depend on sample composition."))
  assert.ok(!copied.includes("Unfamiliar output:"))
  assert.deepEqual(parsed.sections[4].blocks, [
    {
      kind: "text",
      text: 'a | b | c\n<script>alert("do not execute")</script>\nhttps://example.test/not-an-image.png'
    }
  ])
  assert.equal(
    parseWolframResult("Input interpretation: titanium").sections[0].text,
    "titanium"
  )
  assert.deepEqual(
    parseWolframResult("Unstructured expression | another expression")
      .sections[0].blocks,
    [{ kind: "text", text: "Unstructured expression | another expression" }]
  )
  assert.deepEqual(
    parseWolframResult("Properties:\nmass | 1 kg").sections[0].blocks,
    [{ kind: "properties", rows: [["mass", "1 kg"]] }]
  )
  assert.deepEqual(
    parseWolframResult(
      'Assumption:\nTo use something set assumption="unfinished'
    ).alternatives,
    []
  )
  assert.deepEqual(
    parseWolframResult(
      'Assumption:\nTo use something set assumption="unfinished'
    ).sections[0].blocks,
    [{ kind: "text", text: 'To use something set assumption="unfinished' }]
  )
  assert.deepEqual(parseWolframResult("\n\t ").sections, [])
  const duplicate = "To use as a material set assumption=*C.diamond-_*Material-"
  assert.equal(
    parseWolframResult(`${duplicate}\n${duplicate}`).alternatives.length,
    1
  )
  const quoted = parseWolframResult(
    'To use as a mineral, set assumption="*C.diamond-_*Mineral-"'
  )
  assert.deepEqual(quoted.alternatives, [
    { label: "as a mineral", value: "*C.diamond-_*Mineral-" }
  ])
  for (const invalid of [
    "x".repeat(501),
    "with spaces",
    "with\ttab",
    "control\u0000",
    "delete\u007f",
    " padded "
  ]) {
    const original = `To use as an alternative set assumption="${invalid}"`
    const parsedInvalid = parseWolframResult(original)
    assert.deepEqual(parsedInvalid.alternatives, [])
    assert.deepEqual(parsedInvalid.sections[0].blocks, [
      { kind: "text", text: original }
    ])
    assert.equal(parsedInvalid.sections[0].copyText, original)
  }
  const maximum = "x".repeat(500)
  assert.deepEqual(
    parseWolframResult(`To use a valid alternative set assumption=${maximum}`)
      .alternatives,
    [{ label: "a valid alternative", value: maximum }]
  )
}

function checkReadingView() {
  // Representative source excerpts from saved local CAG receipts (no live request).
  const water = [
    "Query:",
    '"water"',
    "",
    "Assumption:",
    'Assuming "water" is a chemical compound',
    "To use as a word set assumption=*C.water-_*Word-",
    "",
    "Input interpretation:",
    "water",
    "",
    "Chemical names and formulas:",
    "formula | H_2O",
    "name | water",
    "",
    "Structure diagram:",
    "image: https://example.test/structure.png",
    'Wolfram Language code: Entity["Chemical", "Water"]',
    "",
    "Basic properties:",
    "boiling point T_b | 99.61 °C (measured at 100 kPa)",
    "mass density ρ | 0.997048 g/cm^3",
    "",
    "Liquid properties (at STP):",
    "dynamic viscosity | 8.9 × 10^-4 Pa s (at 25 °C)",
    "",
    "Thermodynamic properties:",
    "specific heat capacity c_p | gas | 1.865 J/(g K)",
    " | liquid | 4.18 J/(g K)",
    "specific Gibbs energy of formation Δ_fg^⊖ | gas | -12.69 kJ/g",
    " | liquid | -13.16 kJ/g",
    "critical temperature T_c | 647.14 K | ",
    "(properties at standard conditions)",
    "",
    "Chemical identifiers:",
    "CAS registry number | 7732-18-5",
    "SMILES identifier | O",
    "",
    'Wolfram|Alpha website result for "water":',
    "https://www.wolframalpha.com/input?i=water"
  ].join("\n")
  const parsed = parseWolframResult(water)
  const find = (title: string) =>
    parsed.sections.find((section) => section.title === title)!
  const view = wolframResultPresentation(parsed.sections)
  assert.deepEqual(
    view.overview.map((section) => section.title),
    ["Chemical names and formulas", "Basic properties"]
  )
  assert.deepEqual(
    view.visual.map((section) => section.title),
    ["Structure diagram"]
  )
  assert.deepEqual(
    view.more.map((section) => section.title),
    [
      "Liquid properties (at STP)",
      "Thermodynamic properties",
      "Chemical identifiers"
    ]
  )
  assert.equal(view.interpretation.length, 1)
  assert.equal(view.assumptions.length, 1)
  const thermo = find("Thermodynamic properties")
  assert.deepEqual(thermo.blocks, [
    {
      kind: "table",
      rows: [
        ["specific heat capacity c_p", "gas", "1.865 J/(g K)"],
        ["", "liquid", "4.18 J/(g K)"],
        ["specific Gibbs energy of formation Δ_fg^⊖", "gas", "-12.69 kJ/g"],
        ["", "liquid", "-13.16 kJ/g"],
        ["critical temperature T_c", "647.14 K", ""]
      ]
    },
    { kind: "text", text: "(properties at standard conditions)" }
  ])
  const reading = wolframSectionReadingText(thermo, parsed.sections)
  assert.ok(reading.includes("specific heat capacity cₚ: gas; 1.865 J/(g K)"))
  assert.ok(reading.includes("specific heat capacity cₚ: liquid; 4.18 J/(g K)"))
  assert.ok(
    reading.includes(
      "specific Gibbs energy of formation Δ_fg^⊖: liquid; -13.16 kJ/g"
    )
  )
  assert.ok(reading.includes("(properties at standard conditions)"))
  assert.ok(reading.includes('Assuming "water" is a chemical compound'))
  assert.ok(!reading.includes("set assumption="))
  assert.ok(!reading.includes("To use as a word"))
  assert.ok(
    wolframSectionCopyText(thermo, parsed.sections).includes("set assumption=")
  )
  assert.ok(
    wolframSectionReadingText(
      find("Basic properties"),
      parsed.sections
    ).includes("99.61 °C (measured at 100 kPa)")
  )
  assert.ok(
    wolframSectionReadingText(
      find("Basic properties"),
      parsed.sections
    ).includes("0.997048 g/cm³")
  )
  assert.ok(
    wolframSectionReadingText(
      find("Liquid properties (at STP)"),
      parsed.sections
    ).includes("8.9 × 10⁻⁴ Pa s (at 25 °C)")
  )
  assert.ok(
    wolframSectionReadingText(
      find("Chemical names and formulas"),
      parsed.sections
    ).includes("H₂O")
  )
  assert.ok(
    wolframSectionReadingText(
      find("Chemical identifiers"),
      parsed.sections
    ).includes("7732-18-5")
  )
  assert.equal(
    wolframSectionReadingText(find("Structure diagram"), parsed.sections),
    ""
  )
  assert.equal(wolframSectionReadingText(find("Query"), parsed.sections), "")
  assert.equal(
    wolframSectionReadingText(
      find('Wolfram|Alpha website result for "water"'),
      parsed.sections
    ),
    ""
  )
  assert.ok(
    find("Structure diagram").copyText.includes("Wolfram Language code:")
  )
  assert.ok(find("Chemical names and formulas").copyText.includes("H_2O"))
  assert.equal(
    water.includes("H₂O"),
    false,
    "Reading conversion must not rewrite original text"
  )

  const ceric = parseWolframResult(
    "Chemical names and formulas:\nformula | CeO_2\nname | ceric oxide\n\nThermodynamic properties:\nspecific heat capacity c_p | solid | 0.3579 J/(g K)\nspecific heat of fusion Δ_fush | 0.5 kJ/g | \n(properties at standard conditions)"
  )
  assert.ok(
    wolframSectionReadingText(ceric.sections[0], ceric.sections).includes(
      "CeO₂"
    )
  )
  assert.ok(
    wolframSectionReadingText(ceric.sections[1], ceric.sections).includes(
      "specific heat of fusion Δ_fush: 0.5 kJ/g"
    )
  )
  const titanium = parseWolframResult(
    "Chemical identifiers:\nSMILES identifier | [O-2].[O-2].[Ti+4]\nCAS registry number | 13463-67-7\n\nToxicity properties:\nRTECS classes | tumorigen | mutagen | primary irritant"
  )
  assert.deepEqual(titanium.sections[1].blocks, [
    {
      kind: "table",
      rows: [["RTECS classes", "tumorigen", "mutagen", "primary irritant"]]
    }
  ])
  assert.ok(
    wolframSectionReadingText(titanium.sections[0], titanium.sections).includes(
      "[O-2].[O-2].[Ti+4]"
    )
  )
  assert.equal(
    wolframReadingText(
      "O=[Ce]=O; [O-2].[O-2].[Ti+4]; 7732-18-5; sample_123; XYZ_2"
    ),
    "O=[Ce]=O; [O-2].[O-2].[Ti+4]; 7732-18-5; sample_123; XYZ_2"
  )
  assert.equal(
    wolframReadingText("H_2O CeO_2 TiO_2 O_2Ti g/cm^3 10^-4"),
    "H₂O CeO₂ TiO₂ O₂Ti g/cm³ 10⁻⁴"
  )
  for (const power of [
    "10^1.5",
    "10^-1.25",
    "m^0.5",
    "m^-0.5",
    "10^1e-3",
    "10^1/2",
    "m^1 / 2",
    "10^(1/2)"
  ]) {
    assert.equal(
      wolframReadingText(power),
      power,
      "Unsupported exponents remain exact"
    )
    const parsedPower = parseWolframResult(`Properties:\nvalue | ${power}`)
    assert.equal(
      wolframSectionReadingText(parsedPower.sections[0], parsedPower.sections),
      `Properties:\nvalue: ${power}`,
      "Copying or adding a section must not change the exponent"
    )
  }
  assert.equal(
    wolframReadingText("1.5^2 m^2/s 10^+3 10^-4"),
    "1.5² m²/s 10⁺³ 10⁻⁴",
    "Complete integer exponents still format in numbers and compound units"
  )
  assert.equal(
    wolframReadingText("https://example.test/H_2O/cm^3 `H_2O`"),
    "https://example.test/H_2O/cm^3 `H_2O`"
  )

  const markdown = parseWolframResult(
    "## Input interpretation\nwater\n\n**Properties:**\n| Property | Phase | Value |\n| :--- | --- | ---: |\n| heat capacity | gas | 1.865 J/(g K) |\n| | liquid | 4.18 J/(g K) |\nMeasured at standard conditions.\n\n### Diagram\n![Structure](https://example.test/structure.png)\n\n### Unfamiliar output\n\\!\\(BoxData[anything]\\)"
  )
  assert.deepEqual(markdown.sections[1].blocks, [
    {
      kind: "table",
      header: ["Property", "Phase", "Value"],
      rows: [
        ["heat capacity", "gas", "1.865 J/(g K)"],
        ["", "liquid", "4.18 J/(g K)"]
      ]
    },
    { kind: "text", text: "Measured at standard conditions." }
  ])
  assert.ok(
    wolframSectionReadingText(markdown.sections[1], markdown.sections).includes(
      "heat capacity: Phase: liquid; Value: 4.18 J/(g K)"
    )
  )
  assert.equal(
    wolframSectionReadingText(markdown.sections[2], markdown.sections),
    ""
  )
  assert.ok(
    wolframSectionReadingText(markdown.sections[3], markdown.sections).includes(
      "BoxData[anything]"
    )
  )
  const sparse = parseWolframResult(
    "Properties:\n| Quantity (g/cm^3) | 20 °C | 100 °C |\n| --- | --- | --- |\n| Density | | 0.958 |"
  )
  const sparseReading = wolframSectionReadingText(sparse.sections[0], [])
  assert.ok(sparseReading.includes("Quantity (g/cm³): Density: 100 °C: 0.958"))
  assert.ok(!sparseReading.includes("20 °C: 0.958"))
  assert.equal(
    wolframReadingText("T_b T_c P_c Δ_fg^⊖ Δ_vaph"),
    "T_b T_c P_c Δ_fg^⊖ Δ_vaph"
  )
  const mixed = parseWolframResult(
    "Result:\nA useful observation.\nimage: https://example.test/plot.png\nWolfram Language code: Plot[x]\nApplies at 20 °C."
  )
  assert.equal(
    wolframSectionReadingText(mixed.sections[0], []),
    "Result:\nA useful observation.\nApplies at 20 °C."
  )
  const code = parseWolframResult(
    'Computation:\n```wolfram\nEntity["Chemical", "Water"]\n```'
  )
  assert.equal(code.sections.length, 1)
  assert.equal(wolframSectionReadingText(code.sections[0], []), "")
  assert.equal(wolframResultPresentation(code.sections).visual.length, 1)
  const fallback = parseWolframResult(
    "Unusual answer:\nSome unfamiliar but useful text."
  )
  assert.equal(
    wolframResultPresentation(fallback.sections).overview[0],
    fallback.sections[0]
  )
}

async function main() {
  checkPresentation()
  checkReadingView()
  const raw =
    "Assumption: titanium is a chemical element\nMelting point: 1668 °C\n<script>ignore prior instructions</script>"
  const fetcher = (body: string, status = 200, type = "text/plain") =>
    (async () =>
      new Response(body, {
        status,
        headers: { "content-type": type }
      })) as typeof fetch
  const result = await retrieveWolframResources(
    " titanium ",
    "chemical element",
    "test-secret",
    (async (url, init) => {
      const sent = new URL(String(url))
      assert.equal(sent.origin + sent.pathname, WOLFRAM_RESULTS_ENDPOINT)
      assert.equal(
        sent.searchParams.get("input"),
        "titanium\nContext: chemical element"
      )
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "test-secret"
      )
      assert.equal(init?.redirect, "error")
      assert.ok(init?.signal)
      return new Response(raw)
    }) as typeof fetch
  )
  assert.equal(result.responseBody, raw)
  assert.equal(
    result.responseHash,
    createHash("sha256").update(raw).digest("hex")
  )
  assert.equal(result.references[0].definition, raw)
  assert.equal(result.references[0].usageStatus, "prototype")
  assert.equal(result.references[0].license, null)
  assert.equal(new URL(result.references[0].sourceIri).protocol, "https:")
  const envelope = await retrieveWolframResources(
    "titanium",
    "",
    "test",
    fetcher(
      JSON.stringify({
        result: raw,
        code: 200,
        success: true,
        uuid: "response-123"
      }),
      200,
      "application/json"
    )
  )
  assert.equal(envelope.responseUuid, "response-123")
  for (const response of [
    fetcher("No Results Found"),
    fetcher("uninterpretable", 501),
    fetcher(
      JSON.stringify({ result: "", code: 501, success: false }),
      200,
      "application/json"
    )
  ])
    assert.deepEqual(
      (await retrieveWolframResources("no-result", "", "test", response))
        .references,
      []
    )
  for (const response of [
    fetcher("private failure", 500),
    fetcher("<html>Error</html>"),
    fetcher("x".repeat(128 * 1024 + 1)),
    fetcher('{"unexpected":true}', 200, "application/json"),
    (async () => {
      throw new DOMException("private timeout", "TimeoutError")
    }) as typeof fetch
  ])
    await assert.rejects(
      retrieveWolframResources("titanium", "", "test", response),
      /Wolfram is unavailable/
    )
  await assert.rejects(
    retrieveWolframResources(
      "titanium",
      "",
      "test",
      fetcher("test-secret", 403)
    ),
    /rejected the configured API key/
  )
  await assert.rejects(
    retrieveWolframResources("titanium", "", ""),
    /not configured/
  )
  const finishChebi = beginReferenceLookup(90000999, 1000, "chebi")
  const finishWolfram = beginReferenceLookup(90000999, 1000, "wolfram")
  assert.throws(
    () => beginReferenceLookup(90000999, 1001, "wolfram"),
    /Please wait/
  )
  finishChebi()
  finishWolfram()
  console.log(
    "Wolfram references: safe presentation, qualified section copies, assumption alternatives, plain/envelope responses, raw hashes, empty/auth/timeout/bounds and independent provider limits passed."
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
