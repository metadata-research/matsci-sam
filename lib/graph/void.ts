import { TTL_PREFIXES, en, turtleBlock } from "../kos-export"
import { identifierBaseUrl } from "../public-identifiers"
import { lit } from "../rdf-literal"
import { SITE_NAME } from "../site"
import {
  CONTENT_GRAPH_NAMES,
  datasetIri,
  graphIri,
  sparqlEndpointUrl
} from "./names"
import type { ContentGraphName, GraphName } from "./names"

/*
 * The meta graph: a VoID description of the dataset and a SPARQL service
 * description of the endpoint, with one block per named graph. It is the
 * one graph that says when the projection ran and how large each graph is,
 * so it is written last and from the counts of the documents that were just
 * built. Pure: the projector and the fixture test both render it.
 */

export const META_PREFIXES = `@prefix void: <http://rdfs.org/ns/void#> .
@prefix sd: <http://www.w3.org/ns/sparql-service-description#> .
@prefix formats: <http://www.w3.org/ns/formats/> .

`

const GRAPH_DESCRIPTIONS: Record<GraphName, string> = {
  vocabulary:
    "The dictionary: the concept scheme, each term as a concept, and its definitions and their revisions.",
  kos: "The knowledge-organization layer: concept schemes, concepts with their hierarchy and external mappings, and collections.",
  provenance:
    "The PROV-O record: how each revision came to be, the assertions of the statement ledger, voting acts and studies.",
  matcore:
    "The MatCore element set with its Dublin Core crosswalk and the snapshot it transcribes.",
  meta: "This description: the dataset, its named graphs, their triple counts and the time of projection."
}

export type MetaGraphInput = {
  // ISO 8601, the moment the content graphs were built.
  projectedAt: string
  counts: Record<ContentGraphName, number>
}

const dateTime = (value: string) =>
  `${lit(new Date(value).toISOString())}^^xsd:dateTime`

export const metaGraphTurtle = ({ projectedAt, counts }: MetaGraphInput) => {
  const total = CONTENT_GRAPH_NAMES.reduce((sum, name) => sum + counts[name], 0)
  const contentIris = CONTENT_GRAPH_NAMES.map((name) => `<${graphIri(name)}>`)

  const dataset = turtleBlock(datasetIri, [
    "a void:Dataset, sd:Dataset",
    `dcterms:title ${en(`${SITE_NAME} graph`)}`,
    `dcterms:description ${en(
      "The vocabulary, its knowledge organization, its provenance and the MatCore element set, projected from the application database."
    )}`,
    `dcterms:publisher ${lit("Metadata Research Center, Drexel University")}`,
    `dcterms:modified ${dateTime(projectedAt)}`,
    `void:sparqlEndpoint <${sparqlEndpointUrl}>`,
    `void:dataDump <${identifierBaseUrl}/dataset.ttl>`,
    `void:triples ${total}`,
    `void:subset ${contentIris.join(", ")}`,
    `sd:namedGraph ${[...contentIris, `<${graphIri("meta")}>`].join(", ")}`
  ])

  // The endpoint is addressed at the application origin, because a POST
  // does not follow the redirect of a persistent identifier namespace.
  const service = turtleBlock(sparqlEndpointUrl, [
    "a sd:Service",
    `sd:endpoint <${sparqlEndpointUrl}>`,
    "sd:supportedLanguage sd:SPARQL11Query",
    "sd:resultFormat formats:SPARQL_Results_JSON, formats:Turtle",
    "sd:feature sd:UnionDefaultGraph",
    `sd:defaultDataset <${datasetIri}>`
  ])

  const graphs = CONTENT_GRAPH_NAMES.map((name) =>
    turtleBlock(graphIri(name), [
      "a sd:NamedGraph, void:Dataset",
      `sd:name <${graphIri(name)}>`,
      `rdfs:label ${en(name)}`,
      `dcterms:description ${en(GRAPH_DESCRIPTIONS[name])}`,
      `void:triples ${counts[name]}`,
      `void:inDataset <${datasetIri}>`
    ])
  )

  const meta = turtleBlock(graphIri("meta"), [
    "a sd:NamedGraph",
    `sd:name <${graphIri("meta")}>`,
    `rdfs:label ${en("meta")}`,
    `dcterms:description ${en(GRAPH_DESCRIPTIONS.meta)}`,
    `void:inDataset <${datasetIri}>`
  ])

  return (
    TTL_PREFIXES +
    META_PREFIXES +
    [dataset, service, ...graphs, meta].join("\n")
  )
}
