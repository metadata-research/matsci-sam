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
 * leaves the typing of the definition and of its current revision, and the
 * specializationOf link of that revision, to the vocabulary graph, which
 * states them (vocabularyTriples: false); every other revision keeps them,
 * because nothing else states them. scripts/test-graph.ts proves the
 * disjointness on fixtures.
 *
 * The pure renderers take what the loaders return; the loaders are the same
 * queries the Turtle routes run. buildContentGraphs is what the projector
 * calls, and buildContentGraph what a route without a projection calls.
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

// One term at a time: buildTermProvenance runs seven queries at once for a
// term, the pool has ten connections by default, and the request path shares
// it. Two terms at once would leave nothing for a write during a rebuild.
const TERM_BATCH = 1

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
        // events, which name a voter only where the profile is public. A
        // model with a profile is named by its own IRI, as those events
        // name it.
        buildTermProvenance(id, {
          anonymizeVoters: true,
          includeVotes: false,
          modelIdentities: true
        })
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

// One content graph, loading only what it needs. The route serves this when
// no projection is available to serve from.
export const buildContentGraph = async (name: ContentGraphName) => {
  switch (name) {
    case "vocabulary":
      return vocabularyGraphTurtle(await loadSchemeDocument())
    case "kos":
      return kosGraphTurtle(await loadSchemeDocument())
    case "provenance":
      return loadProvenanceGraph()
    case "matcore":
      return matCoreGraphTurtle()
  }
}
