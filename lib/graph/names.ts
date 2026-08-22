/*
 * The names of the graph layer: five named graphs, the dataset they make up,
 * and the query endpoint. Everything else in lib/graph/ refers to a graph
 * through these helpers so the route, the projector, the meta graph and the
 * tests cannot spell a graph IRI differently.
 *
 * Graph IRIs are minted under the identifier authority, like every other
 * published IRI. The SPARQL endpoint is the one exception: a query client
 * POSTs to it, and a POST does not survive the redirect from a persistent
 * namespace, so the endpoint is addressed at the application origin.
 */

import { identifierBaseUrl } from "../public-identifiers"
import { SITE_URL } from "../site"

export const CONTENT_GRAPH_NAMES = [
  "vocabulary",
  "kos",
  "provenance",
  "matcore"
] as const
export const GRAPH_NAMES = [...CONTENT_GRAPH_NAMES, "meta"] as const

export type ContentGraphName = (typeof CONTENT_GRAPH_NAMES)[number]
export type GraphName = (typeof GRAPH_NAMES)[number]

export const isGraphName = (value: string): value is GraphName =>
  (GRAPH_NAMES as readonly string[]).includes(value)

export const graphPath = (name: GraphName) => `/graphs/${name}`
export const graphIri = (name: GraphName) =>
  `${identifierBaseUrl}${graphPath(name)}`

export const datasetPath = "/dataset"
// The void:Dataset: the union of the named graphs, described at its own IRI.
export const datasetIri = `${identifierBaseUrl}${datasetPath}`

export const sparqlPath = "/sparql"
export const sparqlEndpointUrl = `${SITE_URL}${sparqlPath}`
