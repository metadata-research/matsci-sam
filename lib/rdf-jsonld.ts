import { Parser } from "n3"

// Expanded JSON-LD preserves the Turtle graph, including historical revisions.
export function turtleJsonLd(turtle: string) {
  const nodes = new Map<string, Record<string, unknown>>()
  const id = (term: { termType: string; value: string }) =>
    term.termType === "BlankNode" ? `_:${term.value}` : term.value
  for (const quad of new Parser().parse(turtle)) {
    if (!["NamedNode", "BlankNode"].includes(quad.subject.termType))
      throw new Error("Unsupported RDF subject")
    if (!["NamedNode", "BlankNode", "Literal"].includes(quad.object.termType))
      throw new Error("Unsupported RDF object")
    const subject = id(quad.subject)
    const node = nodes.get(subject) ?? { "@id": subject }
    nodes.set(subject, node)
    const property = quad.predicate.value
    const object = quad.object
    const value =
      object.termType === "Literal"
        ? {
            "@value": object.value,
            ...(object.language
              ? { "@language": object.language }
              : { "@type": object.datatype.value })
          }
        : { "@id": id(object) }
    const values = (node[property] ??= []) as unknown[]
    values.push(value)
  }
  return [...nodes.values()]
}
