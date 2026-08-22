import "server-only"

import { db, termsTable } from "@yamz/db"
import { asc } from "drizzle-orm"
import { Parser, Store } from "n3"
import { TTL_PREFIXES, kosTurtle } from "../kos-export"
import { matCoreBlocksTurtle } from "../matcore-export"
import { buildTermProvenance } from "../provenance"
import { provenanceBodyTurtle } from "../provenance-rdf"
import { loadSchemeDocument, renderVocabularyTurtle } from "../skos"
import type { SchemeDocument } from "../skos"
import type { ContentGraphName } from "./names"
import {
  ProvenanceDatasetView,
  loadProvenanceDatasetData,
  provenanceDatasetBlocksTurtle
} from "./provenance-dataset"

/*
 * The four content graphs as Turtle documents, one per serializer family.
 * Each is a prefix block plus the blocks the family already renders for its
 * route, so a graph states exactly what its route states and the four are
 * pairwise disjoint: the vocabulary graph holds the dictionary, the kos
 * graph the knowledge-organization layer, the matcore graph the element set,
 * and the provenance graph the PROV-O record. The per-term provenance body
 * leaves the three triples the vocabulary graph also states to that graph
 * (vocabularyTriples: false); scripts/test-graph.ts proves the disjointness
 * on fixtures.
 *
 * The pure renderers take what the loaders return; the loaders are the same
 * queries the Turtle routes run. buildContentGraphs is what the projector and
 * the route call.
 */

export const vocabularyGraphTurtle = (document: SchemeDocument) =>
  TTL_PREFIXES + renderVocabularyTurtle(document)

export const kosGraphTurtle = (document: SchemeDocument) =>
  kosTurtle(document.kos)

export const matCoreGraphTurtle = () => TTL_PREFIXES + matCoreBlocksTurtle()

// The provenance graph: one per-term body after another in term id order,
// then the dataset-wide blocks once.
export const provenanceGraphTurtle = (
  termBodies: string[],
  datasetBlocks: string
) =>
  TTL_PREFIXES +
  termBodies.join("\n") +
  (datasetBlocks ? "\n" + datasetBlocks : "")

// A document's distinct triple count, which is what the store will hold:
// a graph is a set, and the agent blocks of the provenance graph repeat a
// person node the per-term body already states. A Quad-valued object (the
// triple term of an assertion) is one term of one triple, so it counts as
// that triple and nothing more.
export const countTriples = (turtle: string) => {
  const store = new Store()
  store.addQuads(new Parser().parse(turtle))
  return store.size
}

// A few terms at a time: buildTermProvenance runs its own batch of queries
// per term, and the pool is shared with the request path.
const TERM_BATCH = 4

export const loadProvenanceGraph = async () => {
  const termIds = (
    await db
      .select({ id: termsTable.id })
      .from(termsTable)
      .orderBy(asc(termsTable.id))
  ).map((row) => row.id)

  const bodies: string[] = []
  for (let i = 0; i < termIds.length; i += TERM_BATCH) {
    const batch = await Promise.all(
      termIds.slice(i, i + TERM_BATCH).map((id) =>
        // Votes are left out of the body and stated once each as vote
        // events; voter nodes are never in the public record.
        buildTermProvenance(id, { anonymizeVoters: true, includeVotes: false })
      )
    )
    for (const prov of batch)
      if (prov)
        bodies.push(provenanceBodyTurtle(prov, { vocabularyTriples: false }))
  }

  const view = new ProvenanceDatasetView(await loadProvenanceDatasetData())
  return provenanceGraphTurtle(bodies, provenanceDatasetBlocksTurtle(view))
}

export const buildContentGraphs = async (): Promise<
  Record<ContentGraphName, string>
> => {
  const document = await loadSchemeDocument()
  return {
    vocabulary: vocabularyGraphTurtle(document),
    kos: kosGraphTurtle(document),
    provenance: await loadProvenanceGraph(),
    matcore: matCoreGraphTurtle()
  }
}
