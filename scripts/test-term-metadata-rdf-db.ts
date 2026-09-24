import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { DataFactory, Parser, Store, type Quad } from "n3"
import {
  db,
  usersTable,
  termsTable,
  termMetadataAssertionsTable
} from "../drizzle"
import {
  addTermMetadata,
  reviewTermMetadata,
  retractTermMetadata
} from "../lib/term-metadata"
import {
  createDefinitionWithInitialRevision,
  publishDefinitionRevision
} from "../lib/definition-revisions"
import { deleteDefinitionRows } from "../lib/definition-purge"
import { buildTermSkos, termTurtle, type SchemeDocument } from "../lib/skos"
import { buildTermProvenance } from "../lib/provenance"
import { provenanceBodyTurtle, provenanceTurtle } from "../lib/provenance-rdf"
import {
  loadProvenanceDatasetData,
  ProvenanceDatasetView,
  provenanceDatasetBlocksTurtle
} from "../lib/graph/provenance-dataset"
import {
  vocabularyGraphTurtle,
  kosGraphTurtle,
  matCoreGraphTurtle,
  provenanceGraphTurtle
} from "../lib/graph/documents"
import {
  DEFAULT_VOCABULARY_SLUG,
  identifierBaseUrl,
  revisionUri,
  termUri
} from "../lib/public-identifiers"
import { metadataAssertionUri } from "../lib/term-metadata-rdf"
import { turtleJsonLd } from "../lib/rdf-jsonld"
import type { KosData } from "../lib/kos-export"

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
const SKOS = "http://www.w3.org/2004/02/skos/core#"
const PROV = "http://www.w3.org/ns/prov#"
const XSD = "http://www.w3.org/2001/XMLSchema#"
const m = (key: string) => `${identifierBaseUrl}/metadata#${key}`
const emptyKos: KosData = {
  schemes: [],
  concepts: [],
  collections: [],
  statements: [],
  terms: []
}
const parse = (turtle: string) => new Parser().parse(turtle)
const key = (q: Quad) =>
  JSON.stringify([
    q.subject.termType,
    q.subject.value,
    q.predicate.value,
    q.object.termType,
    q.object.value,
    q.object.termType === "Literal" ? q.object.language : "",
    q.object.termType === "Literal" ? q.object.datatype.value : ""
  ])
const keys = (quads: Quad[]) => new Set(quads.map(key))
const objects = (store: Store, subject: string, predicate: string) =>
  store.getObjects(subject, predicate, null)
function assertJsonLdEquivalent(turtle: string) {
  const reconstructed: Quad[] = []
  const ref = (id: string) =>
    id.startsWith("_:")
      ? DataFactory.blankNode(id.slice(2))
      : DataFactory.namedNode(id)
  for (const node of turtleJsonLd(turtle)) {
    for (const [predicate, raw] of Object.entries(node)) {
      if (predicate === "@id") continue
      for (const value of raw as Record<string, string>[]) {
        const object = value["@id"]
          ? ref(value["@id"])
          : value["@language"]
            ? DataFactory.literal(value["@value"], value["@language"])
            : DataFactory.literal(
                value["@value"],
                DataFactory.namedNode(value["@type"] ?? `${XSD}string`)
              )
        reconstructed.push(
          DataFactory.quad(
            ref(node["@id"] as string),
            DataFactory.namedNode(predicate),
            object
          )
        )
      }
    }
  }
  assert.deepEqual(
    keys(reconstructed),
    keys(parse(turtle)),
    "Public JSON-LD preserves all Turtle triples and RDF term kinds"
  )
}

async function main() {
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(process.env.DATABASE_URL!).hostname
    ),
    "RDF fixture tests only run on localhost"
  )
  // Export loaders use the application's pool. Commit this uniquely named
  // fixture so they can read it, then remove it in finally, including on failure.
  const seed = await db.transaction(async (tx) => {
    const stamp = randomUUID()
    const [author, other, admin] = await tx
      .insert(usersTable)
      .values([
        { name: `RDF author ${stamp}` },
        { name: `RDF independent author ${stamp}` },
        { name: `RDF curator ${stamp}`, role: "admin" }
      ])
      .returning()
    const [term] = await tx
      .insert(termsTable)
      .values({
        term: `RDF metadata ${stamp}`,
        slug: `rdf_metadata_${stamp}`,
        vocabularySlug: DEFAULT_VOCABULARY_SLUG
      })
      .returning()
    const first = await createDefinitionWithInitialRevision(tx, {
      termId: term.id,
      authorId: author.id,
      definition: "The original metadata fixture meaning.",
      example: "",
      changeNote: "Fixture",
      source: "initial"
    })
    return { stamp, term, first, users: [author, other, admin] }
  })
  try {
    const fixture = await db.transaction(async (tx) => {
      const {
        stamp,
        term,
        first,
        users: [author, other, admin]
      } = seed
      const second = await publishDefinitionRevision(tx, {
        definitionId: first.definition.id,
        editorId: author.id,
        definition: "The current metadata fixture meaning.",
        example: "",
        changeNote: "Refine fixture",
        source: "author_edit",
        expectedRevisionId: first.revision.id
      })
      const input = {
        termId: term.id,
        fieldKey: "alternateLabel" as const,
        value: '層 "fixture"',
        language: "ja",
        sourceIri: "https://sources.example/rdf-test",
        sourceLabel: "Contributor reported source",
        sourceVersion: "1"
      }
      const proposed = await addTermMetadata(author.id, input, tx)
      const accepted = await reviewTermMetadata(
        admin.id,
        proposed.id,
        "accept",
        tx
      )
      const independentProposal = await addTermMetadata(
        other.id,
        { ...input, sourceVersion: "2" },
        tx
      )
      const independent = await reviewTermMetadata(
        admin.id,
        independentProposal.id,
        "accept",
        tx
      )
      const secret = await addTermMetadata(
        author.id,
        {
          ...input,
          value: `PRIVATE_PROPOSAL_${stamp}`,
          sourceIri: `https://private.example/${stamp}/proposal`
        },
        tx
      )
      const rejectedProposal = await addTermMetadata(
        other.id,
        {
          ...input,
          value: `PRIVATE_REJECTION_${stamp}`,
          sourceIri: `https://private.example/${stamp}/rejection`
        },
        tx
      )
      const rejected = await reviewTermMetadata(
        admin.id,
        rejectedProposal.id,
        "reject",
        tx
      )
      const historical = await addTermMetadata(
        admin.id,
        {
          termId: term.id,
          definitionRevisionId: first.revision.id,
          fieldKey: "usageNote",
          value: "Applies to original wording only.",
          language: "en"
        },
        tx
      )
      const current = await addTermMetadata(
        admin.id,
        {
          termId: term.id,
          definitionRevisionId: second.revision.id,
          fieldKey: "usedAsValueFor",
          value: `${identifierBaseUrl}/metadata/experimental#processing-method`
        },
        tx
      )
      const retractable = await addTermMetadata(
        admin.id,
        {
          termId: term.id,
          fieldKey: "usageNote",
          value: "This guidance was retracted.",
          language: "en"
        },
        tx
      )
      const retracted = await retractTermMetadata(admin.id, retractable.id, tx)
      const related = await addTermMetadata(
        admin.id,
        {
          termId: term.id,
          fieldKey: "relatedConcept",
          value: "https://ontology.example/deposition"
        },
        tx
      )
      const describes = await addTermMetadata(
        admin.id,
        {
          termId: term.id,
          fieldKey: "describesMetadataField",
          value: `${identifierBaseUrl}/metadata/experimental#processing-method`
        },
        tx
      )
      return {
        term,
        definition: first.definition,
        first: first.revision,
        second: second.revision,
        users: [author, other, admin],
        rows: {
          accepted,
          independent,
          secret,
          rejected,
          historical,
          current,
          retracted,
          related,
          describes
        }
      }
    })
    const { term, definition, rows } = fixture
    const uri = termUri(term.slug, term.vocabularySlug)
    const oldUri = revisionUri(
      term.slug,
      definition.definitionNumber,
      fixture.first.version,
      term.vocabularySlug
    )
    const currentUri = revisionUri(
      term.slug,
      definition.definitionNumber,
      fixture.second.version,
      term.vocabularySlug
    )
    const [skos, prov, loaded] = await Promise.all([
      buildTermSkos(term.id, emptyKos),
      buildTermProvenance(term.id, {
        anonymizeVoters: true,
        includeVotes: false,
        modelIdentities: true
      }),
      loadProvenanceDatasetData()
    ])
    assert.ok(skos)
    assert.ok(prov)
    const currentTurtle = termTurtle(skos, emptyKos)
    const current = new Store(parse(currentTurtle))
    assert.equal(
      objects(current, uri, `${SKOS}altLabel`).length,
      1,
      "Independent attestations collapse only the current fact"
    )
    assert.equal(
      objects(current, uri, `${SKOS}altLabel`)[0].value,
      rows.accepted.value
    )
    assert.equal(
      objects(current, currentUri, m("usedAsValueFor"))[0].value,
      rows.current.value
    )
    assert.equal(
      objects(current, oldUri, `${SKOS}scopeNote`).length,
      0,
      "Old annotations remain historical"
    )
    assert.equal(
      objects(current, uri, `${SKOS}scopeNote`).length,
      0,
      "Retracted annotation is not current"
    )
    assert.equal(
      objects(current, uri, m("usedAsValueFor")).length,
      0,
      "Revision scope is not promoted to the term"
    )
    assert.equal(
      objects(current, uri, m("relatedConcept"))[0].value,
      rows.related.value
    )
    assert.equal(
      objects(current, uri, m("describesMetadataField"))[0].value,
      rows.describes.value
    )
    assert.equal(
      current.getQuads(null, rows.current.value, null, null).length,
      0,
      "No dataset instance values are invented"
    )

    const metadata = (loaded.metadataAssertions ?? []).filter(
      (row) => row.termId === term.id
    )
    assert.equal(
      metadata.length,
      7,
      "Database history loader includes accepted retractions and excludes proposals/rejections"
    )
    assert.ok(metadata.every((row) => row.status === "accepted"))
    const view = new ProvenanceDatasetView({
      ...loaded,
      terms: loaded.terms.filter((row) => row.id === term.id),
      definitions: loaded.definitions.filter((row) => row.id === definition.id),
      revisions: loaded.revisions.filter(
        (row) => row.definitionId === definition.id
      ),
      users: loaded.users.filter((row) =>
        fixture.users.some((user) => row.id === user.id)
      ),
      models: [],
      concepts: [],
      collections: [],
      assertions: [],
      metadataAssertions: metadata,
      voteEvents: [],
      walkthroughComments: [],
      studies: []
    })
    const perTermTurtle = provenanceTurtle(prov)
    const perTerm = new Store(parse(perTermTurtle))
    assert.equal(
      perTerm.getSubjects(`${RDF}type`, m("MetadataAssertion"), null).length,
      7
    )
    const firstAttestation = metadataAssertionUri(uri, rows.accepted.id)
    const secondAttestation = metadataAssertionUri(uri, rows.independent.id)
    assert.notEqual(
      objects(perTerm, firstAttestation, `${PROV}wasAttributedTo`)[0].value,
      objects(perTerm, secondAttestation, `${PROV}wasAttributedTo`)[0].value
    )
    assert.equal(
      objects(perTerm, firstAttestation, m("sourceVersion"))[0].value,
      "1"
    )
    assert.equal(
      objects(perTerm, secondAttestation, m("sourceVersion"))[0].value,
      "2"
    )
    assert.equal(
      objects(
        perTerm,
        metadataAssertionUri(oldUri, rows.historical.id),
        `${RDF}subject`
      )[0].value,
      oldUri
    )
    assert.equal(
      objects(
        perTerm,
        metadataAssertionUri(uri, rows.retracted.id),
        `${PROV}invalidatedAtTime`
      ).length,
      1
    )
    for (const text of [
      currentTurtle,
      perTermTurtle,
      provenanceDatasetBlocksTurtle(view)
    ]) {
      assert.ok(
        !text.includes(rows.secret.value) &&
          !text.includes(rows.rejected.value),
        "Public exports never reveal unreviewed or rejected values"
      )
      assert.ok(
        !text.includes(rows.secret.sourceIri!) &&
          !text.includes(rows.rejected.sourceIri!),
        "Public exports never reveal unreviewed or rejected sources"
      )
    }
    assertJsonLdEquivalent(currentTurtle)
    assertJsonLdEquivalent(perTermTurtle)

    const document: SchemeDocument = {
      kos: emptyKos,
      records: [skos],
      vocabularies: [
        {
          slug: term.vocabularySlug,
          title: "RDF metadata fixture",
          description: null,
          isDefault: true,
          retiredAt: null
        }
      ]
    }
    const graphDocuments = {
      vocabulary: vocabularyGraphTurtle(document),
      kos: kosGraphTurtle(document),
      matcore: matCoreGraphTurtle(),
      provenance: provenanceGraphTurtle(
        [provenanceBodyTurtle(prov, { vocabularyTriples: false })],
        provenanceDatasetBlocksTurtle(view)
      )
    }
    const graphSets = Object.entries(graphDocuments).map(([name, turtle]) => ({
      name,
      triples: keys(parse(turtle))
    }))
    for (let i = 0; i < graphSets.length; i++) {
      for (let j = i + 1; j < graphSets.length; j++) {
        assert.deepEqual(
          [...graphSets[i].triples].filter((triple) =>
            graphSets[j].triples.has(triple)
          ),
          [],
          `${graphSets[i].name} and ${graphSets[j].name} graphs remain disjoint`
        )
      }
    }
    assertJsonLdEquivalent(graphDocuments.vocabulary)
    assertJsonLdEquivalent(graphDocuments.provenance)
    const vocabulary = new Store(parse(graphDocuments.vocabulary))
    assert.equal(
      objects(vocabulary, m("usedAsValueFor"), `${RDF}type`)[0].value,
      `${RDF}Property`,
      "Project metadata predicates are described in the vocabulary graph"
    )
    console.log(
      "Metadata RDF database checks passed: current and historical scope, private review states, independent attestations, four disjoint graphs, and public Turtle/JSON-LD equality."
    )
  } finally {
    await db.transaction(async (tx) => {
      // Term-wide assertions survive definition purge, so remove fixture rows first.
      await tx
        .delete(termMetadataAssertionsTable)
        .where(eq(termMetadataAssertionsTable.termId, seed.term.id))
      await deleteDefinitionRows(tx, seed.first.definition.id)
      await tx.delete(termsTable).where(eq(termsTable.id, seed.term.id))
      await tx.delete(usersTable).where(
        inArray(
          usersTable.id,
          seed.users.map((user) => user.id)
        )
      )
    })
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
