import "server-only"

import type { buildTermProvenance } from "./provenance"
import {
  applicationMetadataNamespaceUri,
  applicationMetadataUri,
  termUri
} from "./public-identifiers"
import { lit } from "./rdf-literal"

// Serialize the derived provenance graph as W3C PROV-O Turtle. The JSON graph
// the UI renders and this document come from the same builder, so revision
// content and stored lifecycle metadata cannot diverge between representations.
//
// The prefixes and the body are separate so the dataset-wide document
// (lib/graph/provenance-dataset.ts) can state the prefixes once and append
// one body per term. provenanceTurtle, the per-term route, is their
// concatenation and its output does not change.

type Provenance = NonNullable<Awaited<ReturnType<typeof buildTermProvenance>>>

export const PROVENANCE_PREFIXES = `@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix matsci: <${applicationMetadataNamespaceUri}> .

`

export type ProvenanceBodyOptions = {
  // The typing of a definition as matsci:Definition, of its current revision
  // as matsci:DefinitionRevision, and the prov:specializationOf link from
  // that revision are also stated by the SKOS serializer, which describes
  // the current revision only. A per-term document repeats them so it reads
  // alone; the dataset-wide provenance graph leaves them to the vocabulary
  // graph so the two graphs stay disjoint, and keeps them for every other
  // revision, which no other graph types or links to its definition.
  vocabularyTriples?: boolean
}

const TYPE_MAP = {
  term: "prov:Entity",
  entity: "prov:Entity",
  activity: "prov:Activity",
  person: "prov:Person",
  software: "prov:SoftwareAgent"
} as const

export const provenanceBodyTurtle = (
  prov: Provenance,
  { vocabularyTriples = true }: ProvenanceBodyOptions = {}
) => {
  const base = `${termUri(prov.term.slug)}/provenance#`
  const nodeById = new Map(prov.graph.nodes.map((node) => [node.id, node]))
  const node = (id: string) => {
    const graphNode = nodeById.get(id)
    if (graphNode?.rdfBlankNode) return `_:${graphNode.rdfBlankNode}`
    return `<${graphNode?.publicResource?.uri ?? `${base}${encodeURIComponent(id)}`}>`
  }
  const metaProperty = (key: string) => `<${applicationMetadataUri(key)}>`
  // Database identifiers support the private graph builder but are not part
  // of the public metadata contract. Public resources are identified by their
  // term-scoped definition and revision IRIs instead.
  const isPublicMetadataProperty = (key: string) => !key.endsWith("Id")

  // Whether a revision node states the triples the vocabulary graph also
  // states: alone, every revision does; in the graph, only a revision the
  // vocabulary graph does not describe, which is every non-current one.
  const statesVocabularyTriples = (n: Provenance["graph"]["nodes"][number]) =>
    vocabularyTriples || n.meta?.current !== "yes"

  const stableDefinitions = new Set(
    prov.graph.nodes.flatMap((node) =>
      node.publicResource?.specializationOf
        ? [node.publicResource.specializationOf]
        : []
    )
  )

  const lines: string[] = []

  for (const n of prov.graph.nodes) {
    const isExplicitStableDefinition =
      n.publicResource?.uri !== undefined &&
      stableDefinitions.has(n.publicResource.uri)
    const statements = [
      `a ${TYPE_MAP[n.type]}${
        n.publicResource?.specializationOf && statesVocabularyTriples(n)
          ? ", matsci:DefinitionRevision"
          : isExplicitStableDefinition && vocabularyTriples
            ? ", matsci:Definition"
          : ""
      }`,
      `rdfs:label ${lit(n.label)}`
    ]
    if (n.detail) statements.push(`prov:value ${lit(n.detail)}`)
    if (n.meta)
      for (const [key, value] of Object.entries(n.meta))
        if (value !== null && isPublicMetadataProperty(key))
          statements.push(`${metaProperty(key)} ${lit(String(value))}`)

    lines.push(`${node(n.id)} ${statements.join(" ;\n  ")} .`)
  }

  const explicitlyRenderedResources = new Set(
    prov.graph.nodes.flatMap((node) =>
      node.publicResource?.uri ? [node.publicResource.uri] : []
    )
  )
  for (const uri of stableDefinitions)
    if (!explicitlyRenderedResources.has(uri))
      lines.push(
        vocabularyTriples
          ? `<${uri}> a prov:Entity, matsci:Definition .`
          : `<${uri}> a prov:Entity .`
      )

  for (const n of prov.graph.nodes) {
    const resource = n.publicResource
    if (!resource) continue

    if (resource.specializationOf && statesVocabularyTriples(n))
      lines.push(
        `${node(n.id)} prov:specializationOf <${resource.specializationOf}> .`
      )
    if (resource.wasRevisionOf)
      lines.push(
        `${node(n.id)} prov:wasRevisionOf <${resource.wasRevisionOf}> .`
      )
    if (resource.proposesReplacementFor)
      lines.push(
        `${node(n.id)} matsci:proposesReplacementFor <${resource.proposesReplacementFor}> .`
      )
  }

  lines.push("")
  for (const e of prov.graph.edges)
    lines.push(`${node(e.source)} prov:${e.rel} ${node(e.target)} .`)

  return lines.join("\n") + "\n"
}

export const provenanceTurtle = (prov: Provenance) =>
  PROVENANCE_PREFIXES + provenanceBodyTurtle(prov)
