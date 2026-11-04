import dagre from "@dagrejs/dagre"
import type { ProvEdge, ProvNode } from "./provenance"

export const PROVENANCE_NODE_WIDTH = 190
export const PROVENANCE_NODE_HEIGHT = 48

type Point = { x: number; y: number }

export type ProvenanceRoute = {
  points: Point[]
  label: Point
  source: Point
  target: Point
}

export function layoutProvenance(nodes: ProvNode[], edges: ProvEdge[]) {
  // Preserve separate relations between the same pair of records. Reserving
  // label space only helps if we also render Dagre's routes and label positions.
  const graph = new dagre.graphlib.Graph({ multigraph: true })
  graph.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 64, edgesep: 24 })
  nodes.forEach((node) =>
    graph.setNode(node.id, {
      width: PROVENANCE_NODE_WIDTH,
      height: PROVENANCE_NODE_HEIGHT
    })
  )
  edges.forEach((edge) =>
    graph.setEdge(
      edge.source,
      edge.target,
      {
        // Relations use 11px text. This conservative width includes its padding.
        width: edge.rel.length * 7 + 16,
        height: 24,
        labelpos: "c"
      },
      edge.id
    )
  )
  dagre.layout(graph)

  return {
    nodes: nodes.map((node) => {
      const center = graph.node(node.id)
      return {
        ...node,
        position: {
          x: center.x - PROVENANCE_NODE_WIDTH / 2,
          y: center.y - PROVENANCE_NODE_HEIGHT / 2
        }
      }
    }),
    edges: edges.map((edge) => {
      const route = graph.edge({
        v: edge.source,
        w: edge.target,
        name: edge.id
      })
      const source = graph.node(edge.source)
      const target = graph.node(edge.target)
      return {
        ...edge,
        route: {
          points: route.points,
          label: { x: route.x!, y: route.y! },
          source: { x: source.x + PROVENANCE_NODE_WIDTH / 2, y: source.y },
          target: { x: target.x - PROVENANCE_NODE_WIDTH / 2, y: target.y }
        } satisfies ProvenanceRoute
      }
    })
  }
}

// Keep connections attached when a reader rearranges nodes. At the automatic
// positions these offsets are zero, retaining the routes around other nodes.
export function movedProvenanceRoute(
  route: ProvenanceRoute,
  source: Point,
  target: Point
) {
  const move = (point: Point, progress: number) => ({
    x:
      point.x +
      (source.x - route.source.x) * (1 - progress) +
      (target.x - route.target.x) * progress,
    y:
      point.y +
      (source.y - route.source.y) * (1 - progress) +
      (target.y - route.target.y) * progress
  })
  return {
    points: route.points.map((point, index) =>
      move(point, index / (route.points.length - 1))
    ),
    label: move(route.label, 0.5)
  }
}
