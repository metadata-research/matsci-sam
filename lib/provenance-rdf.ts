import "server-only"

import type { buildTermProvenance } from "./provenance"
import { termUri } from "./skos"

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
  const node = (id: string) => `<${base}${encodeURIComponent(id)}>`
  const metaProperty = (key: string) =>
    `<${base}metadata/${encodeURIComponent(key)}>`

  const lines: string[] = [
    "@prefix prov: <http://www.w3.org/ns/prov#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    ""
  ]

  for (const n of prov.graph.nodes) {
    const statements = [`a ${TYPE_MAP[n.type]}`, `rdfs:label ${lit(n.label)}`]
    if (n.detail) statements.push(`prov:value ${lit(n.detail)}`)
    if (n.meta)
      for (const [key, value] of Object.entries(n.meta))
        if (value !== null)
          statements.push(`${metaProperty(key)} ${lit(String(value))}`)

    lines.push(`${node(n.id)} ${statements.join(" ;\n  ")} .`)
  }

  lines.push("")
  for (const e of prov.graph.edges)
    lines.push(`${node(e.source)} prov:${e.rel} ${node(e.target)} .`)

  return lines.join("\n") + "\n"
}
