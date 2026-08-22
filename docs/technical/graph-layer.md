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

All under `lib/graph/`.

**`names.ts`** holds the five graph names, their IRIs under the identifier
base, the dataset IRI and the endpoint URL. The endpoint is at the
application origin, because a query client POSTs to it and a POST does not
follow the redirect of a persistent namespace.

**`documents.ts`** renders the four content graphs from the serializers the
Turtle routes already use. The per-term provenance body is rendered with
`vocabularyTriples: false`, which leaves the three triples the vocabulary
graph also states to that graph, so the four graphs are pairwise disjoint.
`countTriples` counts distinct triples with n3, which is what the store
holds.

**`provenance-dataset.ts`** holds the emitters that read across the
database, an assertion per `statements` row, a vote event per act, a study
per `studies` row, and one block per agent those name. The agent rule is
here too. A model is named by its own IRI, and anyone else by the hash node
the per-term body already uses, so the dataset graph and the per-term
document name one agent.

**`void.ts`** renders the meta graph, the `void:Dataset` and `sd:Service`
description with one block per graph, the triple counts and the projection
time.

**`projector.ts`** holds the write side. `markGraphsDirty` sets a flag and
arms a timer that fires five seconds after the last mark, so a burst of
writes becomes one rebuild. `projectGraphs` builds the five documents,
parses each with n3 before the first write, then replaces each graph whole
with a PUT over the Graph Store Protocol, the meta graph last. A failure
sets the flag again and throws. `sweepGraphs` projects when the flag is set
and logs a failure in place of throwing. The state is on `globalThis`,
because Next reloads modules in development and every copy must share one
flag and one timer.

## The write path

A write never waits for a projection and never fails because of one. The
`baseProcedure` middleware in `trpc/init.ts` marks the graphs dirty after a
mutation resolves, `upsertAIDefinitionRecord` in `lib/crud.ts` does the same
after its transaction because the generation path runs outside tRPC, and
the `close` step of `scripts/pilot/run.ts` projects directly when projection
is enabled. `instrumentation.ts` at the repository root marks the store
stale at boot and sweeps every five minutes, so a store that missed a mark
or was down for a rebuild catches up.

## Environment

| Variable                         | Meaning                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GRAPH_PROJECTION_ENABLED`       | `true` to project. Anything else disables the projector, the boot mark and the sweep. `graphs:export` works regardless.                               |
| `FUSEKI_DATASET_URL`             | The dataset, for example `http://127.0.0.1:3030/matsci-sam`. The Graph Store Protocol is `/data?graph=<iri>` under it and the query service `/query`. |
| `FUSEKI_USER`, `FUSEKI_PASSWORD` | HTTP Basic credentials for the writes.                                                                                                                |
| `IDENTIFIER_BASE_URL`            | The base every graph IRI and the application namespace are minted under.                                                                              |

## Scripts

`pnpm graphs:project` runs one projection and prints the counts, and exits
with an error when projection is not enabled. `pnpm graphs:export [dir]`
writes the five documents to disk, `graphs-export/` by default, and needs
only the database. That directory is ignored by git, because an export can
hold real names. `pnpm test:graph` is the pure fixture test and, with
`--export <dir>`, writes the fixture graphs and the three documents that
break one shape each. `pnpm test:graph-db` needs the database and a live
store. It projects, compares the store with the counts the projector
reported and with the database, and runs the paper queries.

`project-graphs.ts` and `test-graph-db.ts` import `dotenv/config` before
anything else, because `lib/site.ts` reads `IDENTIFIER_BASE_URL` and
`NEXT_PUBLIC_SITE_URL` when it loads and the database module, which loads
`.env`, is reached later. Without that import a script on a workstation
mints every IRI under the default site URL.

## Running a store locally

A workstation runs the store as a user service from a pinned Fuseki
distribution under the home directory, with the same entry point, flags and
access rules as the hosts. The internal workstation setup document covers
it.

For a throwaway store, which is what CI uses, Jena 6.2.0 needs Java 21.
Download `apache-jena-6.2.0.tar.gz` and `apache-jena-fuseki-6.2.0.tar.gz`
from the Apache mirror, check them against the SHA-512 values in
`.github/workflows/pr-verify.yml`, unpack them, and put the Java and the
Jena `bin` directories on the path. The paper queries name no graph and
read the union default graph, which a dataset started with `--mem` does not
provide. `scripts/fuseki-test-dataset.ttl` is an assembler for an in-memory
TDB2 dataset that does, with a query endpoint and a Graph Store endpoint
under `/matsci-sam`. Start it with a password file, one line of
`user: password, role`:

```sh
printf 'projector: <password>, admin\n' > fuseki-passwd
fuseki-server --config=scripts/fuseki-test-dataset.ttl --port 3030 \
  --localhost --ping --passwd=fuseki-passwd --auth=basic
```

`--passwd` with `--auth=basic` protects every endpoint, queries included, so
`test:graph-db` sends the credentials on its reads as well. A host answers
queries anonymously and takes writes from one account. With a server up,
set the four variables in `.env` and run `pnpm graphs:project` or
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
enforces. A rule added to a shape needs a line in the matching negative
document in `scripts/test-graph.ts`, so CI keeps proving the shape can fail.

## What CI checks

The `verify` job runs `pnpm test:graph`. The `graph` job exports the
fixture graphs, checks every document and shape with `riot --validate`, and
runs `shacl validate` for each shape against the merged fixture graphs,
which must conform, and against the document written to break it, which
must not. The `db-invariants` job, after the ledger test, starts Fuseki
from the assembler with a throwaway password, exports the graphs from the
migrated database, validates them the same way, and runs
`pnpm test:graph-db`. Both jobs pin Jena 6.2.0 by SHA-512, cache the
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
