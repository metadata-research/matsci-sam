import { expect, type Locator } from "@playwright/test"

// Compare the rendered SVG text, not the layout engine's estimated dimensions.
export async function expectSeparatedProvenanceLabels(graph: Locator) {
  await expect
    .poll(() =>
      graph
        .locator(".react-flow__edge-text")
        .evaluateAll(
          (elements) =>
            elements.length > 0 &&
            elements.every(
              (element) => element.getBoundingClientRect().width > 0
            )
        )
    )
    .toBe(true)
  const collisions = await graph.evaluate((root) => {
    const labels = [...root.querySelectorAll(".react-flow__edge-text")]
    const nodes = [...root.querySelectorAll(".react-flow__node")]
    const result: string[] = []
    labels.forEach((label, index) => {
      for (const other of [...labels.slice(index + 1), ...nodes]) {
        const a = label.getBoundingClientRect(),
          b = other.getBoundingClientRect()
        if (
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top
        )
          result.push(`${label.textContent} overlaps ${other.textContent}`)
      }
    })
    return result
  })
  expect(
    collisions,
    "Provenance labels must not overlap labels or nodes"
  ).toEqual([])
}
