"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react"
import {
  Background,
  BaseEdge,
  Controls,
  Edge,
  type EdgeProps,
  MarkerType,
  Node,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow
} from "@xyflow/react"
import { Maximize2Icon, Minimize2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import "@xyflow/react/dist/style.css"
import type { ProvEdge, ProvNode } from "@/lib/provenance"
import {
  layoutProvenance,
  movedProvenanceRoute,
  PROVENANCE_NODE_WIDTH,
  PROVENANCE_NODE_HEIGHT,
  type ProvenanceRoute
} from "@/lib/provenance-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ProvDetail } from "./detail"
import { PublicProfileName } from "@/components/public-profile-name"
import { RevisionDiff } from "@/components/definition/revision-diff"

// Visual language borrowed from OntExtract's PROV-O graph. Fills come from
// the --prov-* variables in globals.css so the graph follows the theme
// toggle (light uses pale fills and dark text, dark uses deep fills and light text).
const NODE_STYLE: Record<
  ProvNode["type"],
  { background: string; borderRadius: number; border?: string }
> = {
  term: { background: "var(--prov-term)", borderRadius: 10 },
  entity: { background: "var(--prov-entity)", borderRadius: 10 },
  activity: { background: "var(--prov-activity)", borderRadius: 2 },
  person: { background: "var(--prov-person)", borderRadius: 24 },
  software: { background: "var(--prov-software)", borderRadius: 24 }
}

const EDGE_STYLE: Record<
  ProvEdge["rel"],
  { stroke: string; dashed?: boolean }
> = {
  wasDerivedFrom: { stroke: "#3b82f6" },
  wasGeneratedBy: { stroke: "#ef4444" },
  wasAssociatedWith: { stroke: "#22c55e", dashed: true },
  wasAttributedTo: { stroke: "#a855f7", dashed: true },
  used: { stroke: "#6b7280" },
  references: { stroke: "#6b7280", dashed: true }
}

type RoutedEdge = Edge<{ route: ProvenanceRoute }>

function ProvenanceEdge({
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  id,
  label: text,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  style,
  markerStart,
  markerEnd,
  interactionWidth
}: EdgeProps<RoutedEdge>) {
  if (!data) return null
  const { points, label } = movedProvenanceRoute(
    data.route,
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY }
  )
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ")
  return (
    <BaseEdge
      id={id}
      path={path}
      label={text}
      labelX={label.x}
      labelY={label.y}
      labelStyle={labelStyle}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      style={style}
      markerStart={markerStart}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
    />
  )
}

const EDGE_TYPES = { provenance: ProvenanceEdge }

const layout = (provNodes: ProvNode[], provEdges: ProvEdge[]) => {
  const placed = layoutProvenance(provNodes, provEdges)

  const nodes: Node[] = placed.nodes.map((n) => {
    return {
      id: n.id,
      position: n.position,
      data: {
        label: (
          <span
            className="line-clamp-2 break-words [overflow-wrap:anywhere]"
            title={n.label}
          >
            {n.label}
          </span>
        )
      },
      style: {
        ...NODE_STYLE[n.type],
        width: PROVENANCE_NODE_WIDTH,
        height: PROVENANCE_NODE_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        color: "var(--prov-node-fg)",
        border: "1px solid var(--prov-node-border)",
        padding: 6
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left
    }
  })

  const edges: RoutedEdge[] = placed.edges.map((e) => {
    const style = EDGE_STYLE[e.rel]
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: "provenance",
      data: { route: e.route },
      label: e.rel,
      labelStyle: { fontSize: 11, fill: "var(--foreground)" },
      labelBgStyle: { fill: "var(--background)" },
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 3,
      style: {
        stroke: style.stroke,
        strokeLinejoin: "round",
        strokeDasharray: style.dashed ? "6 4" : undefined
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke }
    }
  })

  return { nodes, edges }
}

const LEGEND: { label: string; type: ProvNode["type"] }[] = [
  { label: "Term", type: "term" },
  { label: "Entity", type: "entity" },
  { label: "Activity", type: "activity" },
  { label: "Person", type: "person" },
  { label: "Model", type: "software" }
]

const FIT_OPTIONS = { padding: 0.15, duration: 200 }

/*
 * The canvas is its own component so it can sit inside ReactFlowProvider and
 * use the hooks that need that context.
 *
 * React Flow v12 reports node movement through onNodesChange. A flow given a
 * controlled `nodes` prop and no handler therefore accepts a drag and then
 * discards it, which is what nodesDraggable did here before: the node returned
 * to its dagre position on release. useNodesState supplies the handler.
 *
 * The explicit fitView covers resizing. Entering or leaving full screen changes
 * the size of the pane, and the viewport has to be recomputed against the new
 * size rather than the one the graph was first fitted to.
 */
const Canvas = ({
  layoutNodes,
  layoutEdges,
  onNodeClick,
  onPaneClick,
  expanded
}: {
  layoutNodes: Node[]
  layoutEdges: RoutedEdge[]
  onNodeClick: (event: unknown, node: Node) => void
  onPaneClick: () => void
  expanded: boolean
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges)
  const initialized = useNodesInitialized()
  const { fitView } = useReactFlow()

  useEffect(() => {
    setNodes(layoutNodes)
    setEdges(layoutEdges)
  }, [layoutNodes, layoutEdges, setNodes, setEdges])

  // Expanding changes the size of the pane. The refit waits a frame so the
  // new size is measured before the viewport is recomputed.
  useEffect(() => {
    if (!initialized) return
    const id = window.setTimeout(() => fitView(FIT_OPTIONS), 60)
    return () => window.clearTimeout(id)
  }, [initialized, expanded, fitView, nodes.length])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      fitView
      fitViewOptions={FIT_OPTIONS}
      minZoom={0.1}
      nodesDraggable
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

export const ProvenanceGraph = ({
  nodes: provNodes,
  edges: provEdges,
  renderExtraDetails
}: {
  nodes: ProvNode[]
  edges: ProvEdge[]
  renderExtraDetails?: (node: ProvNode) => ReactNode
}) => {
  const { nodes, edges } = useMemo(
    () => layout(provNodes, provEdges),
    [provNodes, provEdges]
  )

  const [selected, setSelected] = useState<ProvNode | null>(null)
  const [expanded, setExpanded] = useState(false)

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      setSelected(provNodes.find((n) => n.id === node.id) ?? null)
    },
    [provNodes]
  )

  // Escape leaves the expanded view, which is what a reader expects of
  // anything that covers the page. The page behind it stops scrolling for as
  // long as it is covered.
  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKey)
    }
  }, [expanded])

  return (
    <div
      className={
        expanded
          ? // Sized to the viewport rather than by inset alone: inset-0 resolves
            // against the nearest containing block, which left a strip of the
            // page showing under the overlay.
            "fixed top-0 left-0 z-50 flex h-[100dvh] w-screen flex-col gap-2 bg-background p-4"
          : "space-y-2"
      }
    >
      <div className="flex items-center gap-3 text-xs flex-wrap">
        {LEGEND.map(({ label, type }) => (
          <span key={type} className="flex items-center gap-1">
            <span
              className="inline-block size-3 border border-[var(--prov-node-border)]"
              style={{
                background: NODE_STYLE[type].background,
                borderRadius: NODE_STYLE[type].borderRadius > 10 ? 6 : 2
              }}
            />
            {label}
          </span>
        ))}
      </div>
      <div
        className={`border rounded-md bg-background ${
          expanded ? "flex-1 min-h-0" : "h-[480px]"
        }`}
      >
        <ReactFlowProvider>
          <Canvas
            layoutNodes={nodes}
            layoutEdges={edges}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelected(null)}
            expanded={expanded}
          />
        </ReactFlowProvider>
      </div>
      {/* Below the pane, and away from the zoom cluster inside it. The control
          in the bottom-left corner of the pane is React Flow's own "fit view",
          which reframes the graph within whatever space the pane already has.
          This one changes how much space there is, so it is named and placed
          for that difference rather than sharing the corner. */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          title={
            expanded
              ? "Return the graph to the page (Esc)"
              : "Open the graph across the whole window"
          }
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <Minimize2Icon className="size-4 mr-1" />
          ) : (
            <Maximize2Icon className="size-4 mr-1" />
          )}
          {expanded ? "Exit full screen" : "Full screen"}
        </Button>
      </div>
      {selected && (
        <Card
          className={`!py-3 ${
            expanded ? "max-h-52 shrink-0 overflow-y-auto" : ""
          }`}
        >
          <CardHeader className="!pb-0">
            <CardTitle className="text-base">
              {selected.profileUserId ? (
                <PublicProfileName
                  user={{
                    id: selected.profileUserId,
                    name: selected.label,
                    isAi: false,
                    isProfilePublic: true
                  }}
                />
              ) : (
                selected.label
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {selected.comparison ? (
              <RevisionDiff
                comparison={selected.comparison}
                headingLevel="h3"
                id={`provenance-${selected.id}-comparison`}
              />
            ) : selected.detail ? (
              <ProvDetail text={selected.detail} />
            ) : null}
            {renderExtraDetails?.(selected)}
            {selected.meta &&
              Object.entries(selected.meta).map(([k, v]) => (
                <p key={k} className="text-muted-foreground">
                  {k}: {String(v)}
                </p>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
