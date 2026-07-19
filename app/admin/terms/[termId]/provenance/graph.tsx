"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Edge,
  MarkerType,
  Node,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import type { ProvEdge, ProvNode } from "@/lib/provenance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Visual language borrowed from OntExtract's PROV-O graph
const NODE_STYLE: Record<
  ProvNode["type"],
  { background: string; borderRadius: number; border?: string }
> = {
  term: { background: "#90EE90", borderRadius: 10 },
  entity: { background: "#FFE5B4", borderRadius: 10 },
  activity: { background: "#B4D7FF", borderRadius: 2 },
  person: { background: "#CE93D8", borderRadius: 24 },
  software: { background: "#FFCC80", borderRadius: 24 },
};

const EDGE_STYLE: Record<ProvEdge["rel"], { stroke: string; dashed?: boolean }> =
  {
    wasDerivedFrom: { stroke: "#3b82f6" },
    wasGeneratedBy: { stroke: "#ef4444" },
    wasAssociatedWith: { stroke: "#22c55e", dashed: true },
    wasAttributedTo: { stroke: "#a855f7", dashed: true },
    used: { stroke: "#6b7280" },
  };

const NODE_WIDTH = 190;
const NODE_HEIGHT = 48;

const layout = (provNodes: ProvNode[], provEdges: ProvEdge[]) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 70 });
  g.setDefaultEdgeLabel(() => ({}));

  provNodes.forEach((n) =>
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }),
  );
  provEdges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  const nodes: Node[] = provNodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: { label: n.label },
      style: {
        ...NODE_STYLE[n.type],
        width: NODE_WIDTH,
        fontSize: 12,
        color: "#1f2937",
        border: "1px solid rgba(0,0,0,0.25)",
        padding: 6,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });

  const edges: Edge[] = provEdges.map((e) => {
    const style = EDGE_STYLE[e.rel];
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.rel,
      labelStyle: { fontSize: 9, fill: "var(--muted-foreground)" },
      labelBgStyle: { fill: "transparent" },
      style: {
        stroke: style.stroke,
        strokeDasharray: style.dashed ? "6 4" : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
    };
  });

  return { nodes, edges };
};

const LEGEND: { label: string; type: ProvNode["type"] }[] = [
  { label: "Term", type: "term" },
  { label: "Entity", type: "entity" },
  { label: "Activity", type: "activity" },
  { label: "Person", type: "person" },
  { label: "Model", type: "software" },
];

export const ProvenanceGraph = ({
  nodes: provNodes,
  edges: provEdges,
}: {
  nodes: ProvNode[];
  edges: ProvEdge[];
}) => {
  const { nodes, edges } = useMemo(
    () => layout(provNodes, provEdges),
    [provNodes, provEdges],
  );

  const [selected, setSelected] = useState<ProvNode | null>(null);

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      setSelected(provNodes.find((n) => n.id === node.id) ?? null);
    },
    [provNodes],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs flex-wrap">
        {LEGEND.map(({ label, type }) => (
          <span key={type} className="flex items-center gap-1">
            <span
              className="inline-block size-3 border border-black/25"
              style={{
                background: NODE_STYLE[type].background,
                borderRadius: NODE_STYLE[type].borderRadius > 10 ? 6 : 2,
              }}
            />
            {label}
          </span>
        ))}
      </div>
      <div className="h-[480px] border rounded-md bg-background">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={onNodeClick}
          onPaneClick={() => setSelected(null)}
          fitView
          minZoom={0.2}
          nodesDraggable
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {selected && (
        <Card className="!py-3">
          <CardHeader className="!pb-0">
            <CardTitle className="text-base">{selected.label}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {selected.detail && (
              <pre className="text-wrap font-sans">{selected.detail}</pre>
            )}
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
  );
};
