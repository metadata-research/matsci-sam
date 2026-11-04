import type { ProvEdge, ProvNode } from "../../lib/provenance"

// The six-node topology that exposed the overlapping attribution/derivation
// labels on the published grid-spacing proposal. No private records are copied.
export const metadataGraph: { nodes: ProvNode[]; edges: ProvEdge[] } = {
  nodes: [
    {
      id: "revision:2",
      label: "Revision 2",
      type: "entity",
      detail: "Each spacing entry includes its direction, value and unit."
    },
    { id: "revision:1", label: "Revision 1", type: "entity" },
    { id: "reference", label: "Reference 0.3.0", type: "entity" },
    { id: "person", label: "Materials contributor", type: "person" },
    { id: "submission", label: "Proposal submitted", type: "activity" },
    {
      id: "citation",
      label: "Citation 1",
      type: "entity",
      detail: "NIST FiPy documentation: Grid2D"
    }
  ],
  edges: [
    {
      id: "author",
      source: "revision:2",
      target: "person",
      rel: "wasAttributedTo"
    },
    {
      id: "previous",
      source: "revision:2",
      target: "revision:1",
      rel: "wasDerivedFrom"
    },
    {
      id: "baseline",
      source: "revision:2",
      target: "reference",
      rel: "wasDerivedFrom"
    },
    {
      id: "submitter",
      source: "submission",
      target: "person",
      rel: "wasAssociatedWith"
    },
    {
      id: "submitted",
      source: "revision:2",
      target: "submission",
      rel: "wasGeneratedBy"
    },
    { id: "cited", source: "revision:2", target: "citation", rel: "references" }
  ]
}

export const definitionGraph: { nodes: ProvNode[]; edges: ProvEdge[] } = {
  nodes: [
    ...metadataGraph.nodes,
    { id: "term", label: "Solid electrolyte", type: "term" },
    { id: "generation", label: "Definition suggested", type: "activity" },
    { id: "model", label: "Gemma", type: "software" },
    { id: "source", label: "Uploaded source", type: "entity" }
  ],
  edges: [
    ...metadataGraph.edges,
    {
      id: "term-definition",
      source: "term",
      target: "revision:2",
      rel: "wasDerivedFrom"
    },
    {
      id: "generated",
      source: "revision:1",
      target: "generation",
      rel: "wasGeneratedBy"
    },
    {
      id: "model-generation",
      source: "generation",
      target: "model",
      rel: "wasAssociatedWith"
    },
    { id: "context", source: "generation", target: "source", rel: "used" },
    {
      id: "cited-source",
      source: "revision:2",
      target: "source",
      rel: "references"
    },
    {
      id: "source-author",
      source: "source",
      target: "person",
      rel: "wasAttributedTo"
    }
  ]
}
