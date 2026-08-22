# The graph layer

Postgres is the system of record. A Jena Fuseki store holds a projection of
it as five named graphs and answers SPARQL over their union. This note maps
the code that builds the graphs and keeps the store current, and says how to
run a store and the validators on a development machine. What the graphs
mean is in `docs/reference/provenance-model.md` and
`docs/guide/metadata-access.md`. The store of a host, its install script,
its unit and its access rules are operations material and are kept out of
this repository.

## Modules

All under `lib/graph/`, each with a header comment that gives its reasons.

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

A write never waits for a projection and never fails because of one. The
`baseProcedure` middleware in `trpc/init.ts` marks the graphs dirty after a
mutation resolves, and `upsertAIDefinitionRecord` in `lib/crud.ts` does the
same after its transaction because the generation path runs outside tRPC.
`instrumentation.ts` at the repository root marks the store stale at boot,
so a store that missed writes while the server was down catches up, and
sweeps every five minutes, which retries a projection that failed in the
running server.

The flag is a fact about one process. A write made by another process is
not seen by the server: the `close` step of `scripts/pilot/run.ts` projects
for itself, and warns and names `pnpm graphs:project` when the store refuses
it, and a write made with `psql` or a script reaches the store when someone
runs `pnpm graphs:project` or at the next mark or restart of the server.

The application does not serve `/sparql`. The host forwards that path to
the query endpoint of the store. `/graphs/{name}` and `/dataset` serve the
documents of the last projection of the running server, and build them from
the database on request where no projection has run.

## Environment

| Variable                         | Meaning                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GRAPH_PROJECTION_ENABLED`       | `true` to project. Anything else disables the projector, the boot mark and the sweep. `graphs:export` works regardless.                               |
| `FUSEKI_DATASET_URL`             | The dataset, for example `http://127.0.0.1:3030/matsci-sam`. The Graph Store Protocol is `/data?graph=<iri>` under it and the query service `/query`. |
| `FUSEKI_USER`, `FUSEKI_PASSWORD` | HTTP Basic credentials for the writes.                                                                                                                |
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

`project-graphs.ts` and `test-graph-db.ts` import `dotenv/config` before
anything else, because `lib/site.ts` reads `IDENTIFIER_BASE_URL` and
`NEXT_PUBLIC_SITE_URL` when it loads and the database module, which loads
`.env`, is reached later. Without that import a script on a workstation
mints every IRI under the default site URL.

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

The shapes under `shapes/` are the published twin of
`drizzle/invariants.sql` and the CHECKs in `drizzle/schema.ts`, and each
file opens with the rules it mirrors. They name the application namespace
under the persistent identifier base, so export under it, and validate the
merged graphs, because a term names tags the kos graph describes:

```sh
IDENTIFIER_BASE_URL=https://w3id.org/matsci-sam pnpm graphs:export graphs-export
riot --validate graphs-export/*.ttl shapes/*.ttl
riot --output=ttl graphs-export/vocabulary.ttl graphs-export/kos.ttl \
  graphs-export/provenance.ttl graphs-export/matcore.ttl graphs-export/meta.ttl \
  > graphs-export/merged.ttl
shacl validate --shapes shapes/kos.shacl.ttl --data graphs-export/merged.ttl
```

Read the report. `shacl validate` prints `sh:conforms true` or one result
per violation, and exits 0 either way. The `rdf:reifies` value of an
assertion is checked with `sh:nodeKind sh:TripleTerm`, which Jena 6.2.0
enforces. A rule added to a shape needs a violation in the matching negative
document in `scripts/test-graph.ts` and its `sh:resultMessage` in the list
the workflow checks, so CI keeps proving that the rule itself can fail.

## What CI checks

The `verify` job runs `pnpm test:graph`. The `graph` job exports the
fixture graphs, checks every document and shape with `riot --validate`, and
runs `shacl validate` for each shape against the merged fixture graphs,
which must conform, and against the document written to break it, which
must report every planted violation by its message. The `db-invariants`
job, after the ledger test, starts Fuseki from the assembler with a
throwaway password, exports the graphs from the migrated database,
validates them the same way, and runs `pnpm test:graph-db`. That database
holds only what migrations seed, no term, statement, vote or study, so the
job proves the round trip and that the queries run, and the fixture graphs
are what proves the content. Both jobs pin Jena 6.2.0 by SHA-512, cache the
tarballs by version, set `IDENTIFIER_BASE_URL` to the persistent base, and
check that the export declares the namespace the shapes name.

## The paper queries

`scripts/graph-queries/` holds the five queries the system paper prints,
one per file, each starting with a comment that says what it answers. They
are written against the union default graph under the persistent identifier
base, with only the terms the reference documentation names and no database
identifier. `test:graph-db` runs each one and prints its row count, and on
a store projected under another base replaces the base a query names with
the one in use.
