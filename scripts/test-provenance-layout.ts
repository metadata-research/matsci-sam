import assert from "node:assert/strict"
import {
  layoutProvenance,
  movedProvenanceRoute,
  PROVENANCE_NODE_HEIGHT,
  PROVENANCE_NODE_WIDTH
} from "../lib/provenance-layout"
import { metadataGraph, definitionGraph } from "./fixtures/provenance-layout"

type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y

for (const [name, fixture] of Object.entries({
  metadataGraph,
  definitionGraph
})) {
  const before = JSON.stringify(fixture)
  const result = layoutProvenance(fixture.nodes, fixture.edges)
  assert.equal(
    JSON.stringify(fixture),
    before,
    "Layout does not change provenance"
  )
  assert.equal(result.nodes.length, fixture.nodes.length)
  assert.equal(result.edges.length, fixture.edges.length)
  const nodeBoxes = result.nodes.map((node) => ({
    ...node.position,
    width: PROVENANCE_NODE_WIDTH,
    height: PROVENANCE_NODE_HEIGHT
  }))
  const labelBoxes = result.edges.map((edge) => ({
    x: edge.route.label.x - (edge.rel.length * 7 + 16) / 2,
    y: edge.route.label.y - 12,
    width: edge.rel.length * 7 + 16,
    height: 24
  }))
  for (const [index, label] of labelBoxes.entries()) {
    for (const other of labelBoxes.slice(index + 1))
      assert.ok(!overlaps(label, other), `${name}: labels overlap`)
    for (const node of nodeBoxes)
      assert.ok(!overlaps(label, node), `${name}: label overlaps a node`)
  }
  for (const edge of result.edges) {
    const { route } = edge
    assert.ok(route.points.length >= 3)
    // Sample the rendered line segments, including rank-skipping attribution.
    for (let segment = 1; segment < route.points.length; segment++) {
      const a = route.points[segment - 1],
        b = route.points[segment]
      for (let step = 0; step <= 100; step++) {
        const x = a.x + ((b.x - a.x) * step) / 100
        const y = a.y + ((b.y - a.y) * step) / 100
        result.nodes.forEach((node, index) => {
          if (node.id === edge.source || node.id === edge.target) return
          assert.ok(
            !overlaps({ x, y, width: 0.01, height: 0.01 }, nodeBoxes[index]),
            `${name}: ${edge.id} crosses ${node.id}`
          )
        })
      }
    }
    assert.deepEqual(movedProvenanceRoute(route, route.source, route.target), {
      points: route.points,
      label: route.label
    })
    const moved = movedProvenanceRoute(
      route,
      { x: route.source.x + 50, y: route.source.y + 20 },
      route.target
    )
    assert.deepEqual(moved.points[0], {
      x: route.points[0].x + 50,
      y: route.points[0].y + 20
    })
    assert.deepEqual(
      moved.points.at(-1),
      route.points.at(-1),
      "Unmoved endpoint stays attached"
    )
  }
  console.log(
    `PASS ${name}: label separation, clear routes, preserved records and drag endpoints`
  )
}

const parallel = layoutProvenance(metadataGraph.nodes, [
  ...metadataGraph.edges,
  {
    id: "also-cited",
    source: "revision:2",
    target: "reference",
    rel: "references"
  }
])
assert.notDeepEqual(
  parallel.edges.find((e) => e.id === "baseline")!.route,
  parallel.edges.find((e) => e.id === "also-cited")!.route
)
assert.deepEqual(layoutProvenance([], []), { nodes: [], edges: [] })
assert.equal(
  layoutProvenance(metadataGraph.nodes.slice(0, 1), []).nodes.length,
  1
)
console.log("PASS distinct parallel relations, empty and single-node histories")
