# The graph layer

Postgres is the system of record. A Jena Fuseki store holds a projection of
it as five named graphs and answers SPARQL over their union. This page
identifies the projection code and the local store and validation procedures.
`docs/reference/provenance-model.md` and `docs/guide/metadata-access.md`
describe the graph semantics. Host installation, service units, and access
rules belong to the operations documentation.

## Modules

The modules under `lib/graph/` divide these responsibilities.

- `names.ts` holds the five graph names, their IRIs, the dataset IRI and the
  endpoint URL.
- `documents.ts` renders the four content graphs from the serializers the
  Turtle routes use, and counts their distinct triples.
- `provenance-dataset.ts` holds the emitters that read across the database,
  assertions, vote events, studies and agents, and the agent rule.
- `void.ts` renders the meta graph.
- `projector.ts` holds the write side: the dirty flag, the debounced
  projection, the sweep, and the documents of the last projection.

## The write path

Mutations complete independently of graph projection. The `baseProcedure`
middleware in `trpc/init.ts` marks the graphs dirty after a mutation resolves.
`upsertAIDefinitionRecord` in `lib/crud.ts` does the same after its transaction
because the generation path runs outside tRPC. `instrumentation.ts` marks the
store stale at boot and sweeps every five minutes. The boot mark projects
changes made during downtime, and the sweep retries failed projections.

The dirty flag is process-local. The `close` step of `scripts/pilot/run.ts`
projects directly and reports `pnpm graphs:project` when the store rejects the
request. Writes made with `psql` or another script reach the store through an
explicit `pnpm graphs:project`, a later dirty mark, or a server restart.

The host forwards `/sparql` to the query endpoint of the store.
`/graphs/{name}` and `/dataset` serve the documents of the last projection in
the running server. Before the first projection, those routes build their
documents from the database on request.

## Environment

| Variable                         | Meaning                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GRAPH_PROJECTION_ENABLED`       | `true` to project. Anything else disables the projector, the boot mark and the sweep. `graphs:export` works regardless.                                                               |
| `FUSEKI_DATASET_URL`             | The dataset, for example `http://localhost:3030/matsci-sam`. The Graph Store Protocol is `/data?graph=<iri>` under it and the query service `/query`.                                 |
| `FUSEKI_USER`, `FUSEKI_PASSWORD` | HTTP Basic credentials for the writes.                                                                                                                                                |
| `IDENTIFIER_BASE_URL`            | The base every graph IRI and the application namespace are minted under. A page prerendered at build time keeps the value it was built with, so a change takes effect with a release. |

## Scripts

`pnpm graphs:project` runs one projection and prints the counts, and exits
with an error when projection is not enabled. `pnpm graphs:export [dir]`
writes the five documents to disk, `graphs-export/` by default, and needs
only the database. That directory is ignored by git, because an export can
hold real names. `pnpm test:graph` is the pure fixture test and, with
`--export <dir>`, writes the fixture graphs and the three documents that
break the shapes. `pnpm test:graph-db` needs the database and a live
store. It projects, compares the store with the counts the projector
reported and with the database, checks that every revision in the union is
typed and linked to its definition once, and runs the paper queries, which
must answer whenever the database holds what they ask about.

`project-graphs.ts` and `test-graph-db.ts` import `dotenv/config` first.
`lib/site.ts` reads `IDENTIFIER_BASE_URL` and `NEXT_PUBLIC_SITE_URL` at module
load, before the database module loads `.env`. This import order gives scripts
the configured identifier base.

## Running a store locally

Jena 6.2.0 needs Java 21. Download `apache-jena-6.2.0.tar.gz` and
`apache-jena-fuseki-6.2.0.tar.gz` from the Apache mirror, check them
against the SHA-512 values in `.github/workflows/pr-verify.yml`, unpack
them, and put the Java and the Jena `bin` directories on the path. The
paper queries name no graph and read the union default graph, which a
dataset started with `--mem` does not provide. `scripts/fuseki-test-dataset.ttl`
is an assembler for an in-memory TDB2 dataset that does, with a query
endpoint and a Graph Store endpoint under `/matsci-sam`, federated query
switched off and a query timeout, the policy a host runs under. Start it
with a password file, one line of `user: password, role`:

```sh
printf 'projector: <password>, admin\n' > fuseki-passwd
fuseki-server --config=scripts/fuseki-test-dataset.ttl --port 3030 \
  --localhost --ping --passwd=fuseki-passwd --auth=basic
```

`--passwd` with `--auth=basic` protects every endpoint, queries included, so
`test:graph-db` sends the credentials on its reads as well. With a server
up, set the four variables in `.env` and run `pnpm graphs:project` or
`pnpm test:graph-db`.

## Validating with Jena

The shapes under `shapes/` are the published SHACL counterpart of
`drizzle/invariants.sql` and the CHECKs in `drizzle/schema.ts`, and each
file opens with the rules it mirrors. They name the application namespace
under the persistent identifier base. Export under that base and validate the
merged graphs because terms name tags described in the KOS graph.

```sh
IDENTIFIER_BASE_URL=https://w3id.org/matsci-sam pnpm graphs:export graphs-export
riot --validate graphs-export/*.ttl shapes/*.ttl
riot --output=ttl graphs-export/vocabulary.ttl graphs-export/kos.ttl \
  graphs-export/provenance.ttl graphs-export/matcore.ttl graphs-export/meta.ttl \
  > graphs-export/merged.ttl
shacl validate --shapes shapes/kos.shacl.ttl --data graphs-export/merged.ttl
```

Inspect the report because `shacl validate` exits 0 for both conformance and
violations. It prints `sh:conforms true` or one result per violation. The `rdf:reifies` value of an
assertion is checked with `sh:nodeKind sh:TripleTerm`, which Jena 6.2.0
enforces. A rule added to a shape needs a violation in the matching negative
document in `scripts/test-graph.ts`. Add its `sh:resultMessage` to the list
checked by the workflow so CI exercises the failure case.

## What CI checks

The `verify` job runs `pnpm test:graph`. The `graph` job exports the
fixture graphs, checks every document and shape with `riot --validate`, and
runs `shacl validate` for each shape against the merged fixture graphs,
which must conform, and against the document written to break it, which
must report every planted violation by its message. The `db-invariants`
job, after the ledger test, seeds the migrated database with
`pnpm seed:ci-graph`, a fixture written through the same `lib/` write paths
the routers and the pilot driver use. It includes definitions by simulated
accounts and by the model identity, a statement of every subject and object kind with a
retraction and a legacy row, a collection, a community, a study, votes with
a withdrawal and one the backfill wrote, and stamped simulated comments. The
seed requires an empty term table, and the invariants are checked again on the
result. The job then starts Fuseki from the assembler with a
throwaway password, exports the graphs, validates them the same way, and
runs `pnpm test:graph-db --seeded`, which requires every entity count to be
above zero and every paper query to answer at least one row. Both jobs pin
Jena 6.2.0 by SHA-512, cache the tarballs by version, set
`IDENTIFIER_BASE_URL` to the persistent base, and check that the export
declares the namespace the shapes name.

## The paper queries

`scripts/graph-queries/` holds the five queries the system paper prints,
one per file, each starting with a comment that says what it answers. They
are written against the union default graph under the persistent identifier
base, with only the terms the reference documentation names and no database
identifier. `test:graph-db` runs each one and prints its row count, and on
a store projected under another base replaces the base a query names with
the one in use.
