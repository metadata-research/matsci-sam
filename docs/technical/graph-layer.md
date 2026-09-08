# The graph layer

PostgreSQL is the system of record. Jena Fuseki can store a projection as
five named graphs and answer SPARQL over their union.
[Metadata access](../guide/metadata-access.md) describes the public documents.
Host installation and access rules belong in operations documentation.

## Modules

| Module under `lib/graph/` | Responsibility                                                  |
| ------------------------- | --------------------------------------------------------------- |
| `names.ts`                | Graph names and resource IRIs                                   |
| `documents.ts`            | Four content graph serializers and triple counts                |
| `provenance-dataset.ts`   | Assertions, vote events, studies, and agent visibility          |
| `void.ts`                 | Dataset description in the meta graph                           |
| `projector.ts`            | Dirty state, projection, retries, and last successful documents |

## The write path

`tRPC` middleware marks graphs dirty after successful mutations.
`upsertAIDefinitionRecord` marks them after its transaction. A debounced task
projects them independently of the application write. `instrumentation.ts`
marks them at startup and sweeps every five minutes to retry failures.

Dirty state is process-local. External SQL or scripts require an explicit
`pnpm graphs:project`, a later dirty mark, or a restart to refresh the store.
The pilot close step projects directly.

Projection validates documents before writing each content graph, then the
meta graph, through the Graph Store Protocol. A failure leaves dirty state
for retry. `/graphs/{name}` and `/dataset` use the last successful documents
held by that application process. They build from PostgreSQL on request
before a successful projection or when no store is configured.

## Environment

| Variable                         | Meaning                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `GRAPH_PROJECTION_ENABLED`       | Set to `true` for automatic projection and sweeps        |
| `FUSEKI_DATASET_URL`             | Dataset root, such as `http://localhost:3030/matsci-sam` |
| `FUSEKI_USER`, `FUSEKI_PASSWORD` | HTTP Basic credentials for store access                  |
| `IDENTIFIER_BASE_URL`            | Resource and graph IRI base                              |

Store writes use `/data?graph=<iri>` and queries use `/query` under the dataset
root. The public `/sparql` endpoint requires separate host forwarding.
Prerendered pages retain the identifier base used during the build.

## Scripts

| Command                    | Requirements and result                                                                |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm graphs:project`      | Enabled projection and a reachable store. Prints counts                                |
| `pnpm graphs:export [dir]` | Database only. Writes five documents, default `graphs-export/`                         |
| `pnpm test:graph`          | Pure fixtures, with optional `--export <dir>` for positive and negative documents      |
| `pnpm test:graph-db`       | Migrated database and live store. Compares projected counts and executes paper queries |

Graph exports may contain contributor names and are ignored by Git.
Scripts import `dotenv/config` before modules that read the identifier base.
`lib/site.ts` resolves that configuration at module load.

## Running a store locally

Use the Jena and Java versions and SHA-512 checksums recorded in
`.github/workflows/pr-verify.yml`. Add their executable directories to PATH.
`scripts/fuseki-test-dataset.ttl` configures an in-memory TDB2 dataset with a
union default graph, query and Graph Store endpoints, a timeout, and disabled
federated queries.

Create a password file with one `user: password, role` line, then start Fuseki.
Replace the placeholder password before use.

```sh
printf 'projector: <password>, admin\n' > fuseki-passwd
fuseki-server --config=scripts/fuseki-test-dataset.ttl --port 3030 \
  --localhost --ping --passwd=fuseki-passwd --auth=basic
```

Basic authentication protects queries as well as writes. Set the projection
flag, dataset URL, and credentials in the local environment, then run
`pnpm graphs:project` or `pnpm test:graph-db`.

## Validating with Jena

The shapes in `shapes/` mirror database constraints and release invariants.
Validate the merged graphs because vocabulary records reference tags in the
KOS graph. Use the identifier namespace named by the shapes.

```sh
IDENTIFIER_BASE_URL=https://w3id.org/matsci-sam pnpm graphs:export graphs-export
riot --validate graphs-export/*.ttl shapes/*.ttl
riot --output=ttl graphs-export/vocabulary.ttl graphs-export/kos.ttl \
  graphs-export/provenance.ttl graphs-export/matcore.ttl graphs-export/meta.ttl \
  > graphs-export/merged.ttl
shacl validate --shapes shapes/kos.shacl.ttl --data graphs-export/merged.ttl
```

Inspect `sh:conforms` in the report. The Jena command can exit zero even when
violations are reported. Assertion shapes validate `rdf:reifies` as
`sh:TripleTerm`. A new shape rule needs a matching negative fixture and a
checked `sh:resultMessage` in CI.

## What CI checks

The `verify` job runs the pure graph test. The `graph` job parses fixture RDF
and validates shapes against conforming and intentionally invalid documents.
It checks the planted violation messages.

The `db-invariants` job seeds an empty migrated database through shared
application write paths, rechecks invariants, and validates the exports.
It starts an authenticated disposable Fuseki store and runs
`pnpm test:graph-db --seeded`. Seeded mode requires positive entity counts
and a result from each paper query. Version, checksum, and namespace checks
are defined in the workflow.

## The paper queries

`scripts/graph-queries/` contains five queries over the union default graph.
`test:graph-db` executes each and reports its row count. It substitutes the
configured base when testing a projection under another identifier namespace.
