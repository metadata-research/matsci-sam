import "server-only"

import type { buildTermProvenance } from "./provenance"
import {
  applicationMetadataNamespaceUri,
  applicationMetadataUri,
  termUri
} from "./public-identifiers"

// Serialize the derived provenance graph as W3C PROV-O Turtle. The JSON graph
// the UI renders and this document come from the same builder, so revision
// content and stored lifecycle metadata cannot diverge between representations.

type Provenance = NonNullable<Awaited<ReturnType<typeof buildTermProvenance>>>

const TYPE_MAP = {
  term: "prov:Entity",
  entity: "prov:Entity",
  activity: "prov:Activity",
  person: "prov:Person",
  software: "prov:SoftwareAgent"
} as const

const lit = (value: string) =>
  `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n")}"`

export const provenanceTurtle = (prov: Provenance) => {
  const base = `${termUri(prov.term.slug)}/provenance#`
  const nodeById = new Map(prov.graph.nodes.map((node) => [node.id, node]))
  const node = (id: string) =>
    `<${
      nodeById.get(id)?.publicResource?.uri ??
      `${base}${encodeURIComponent(id)}`
    }>`
  const metaProperty = (key: string) => `<${applicationMetadataUri(key)}>`
  // Database identifiers support the private graph builder but are not part
  // of the public metadata contract. Public resources are identified by their
  // term-scoped definition and revision IRIs instead.
  const isPublicMetadataProperty = (key: string) => !key.endsWith("Id")

  const lines: string[] = [
    "@prefix prov: <http://www.w3.org/ns/prov#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    `@prefix matsci: <${applicationMetadataNamespaceUri}> .`,
    ""
  ]

  for (const n of prov.graph.nodes) {
    const statements = [
      `a ${TYPE_MAP[n.type]}${
        n.publicResource?.specializationOf ? ", matsci:DefinitionRevision" : ""
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

  const stableDefinitions = new Set(
    prov.graph.nodes.flatMap((node) =>
      node.publicResource?.specializationOf
        ? [node.publicResource.specializationOf]
        : []
    )
  )
  for (const uri of stableDefinitions)
    lines.push(`<${uri}> a prov:Entity, matsci:Definition .`)

  for (const n of prov.graph.nodes) {
    const resource = n.publicResource
    if (!resource?.specializationOf) continue

    lines.push(
      `${node(n.id)} prov:specializationOf <${resource.specializationOf}> .`
    )
    if (resource.wasRevisionOf)
      lines.push(
        `${node(n.id)} prov:wasRevisionOf <${resource.wasRevisionOf}> .`
      )
  }

  lines.push("")
  for (const e of prov.graph.edges)
    lines.push(`${node(e.source)} prov:${e.rel} ${node(e.target)} .`)

  return lines.join("\n") + "\n"
}
