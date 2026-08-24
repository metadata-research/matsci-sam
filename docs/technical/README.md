# Technical documentation

These notes are for developers changing the code and assume the setup in the
[developer guide](../../developing.md). They are repository documentation. The
served documentation is divided between the user guide in `docs/guide/` and
the knowledge organization reference in `docs/reference/`.

- [The statement ledger](knowledge-organization-ledger.md) covers the schema,
  the checks, the invariants, the predicate registry, the export, and the
  tests that verify their consistency.
- [The LLM layer](llm-layer.md) covers the client, the prompt registry, the
  provenance stamp, model identities, and how to add a structured call.
- [Examples of use](examples.md) covers independent example contributions,
  featured-example history, compatibility projections, legacy records, and the
  tests that protect those contracts.
- [The graph layer](graph-layer.md) covers the named graphs, the projector
  and its hooks, running the Fuseki store and the Jena validators locally,
  the SHACL shapes, what CI checks, and the paper queries.
- [Studies and the walkthrough](studies.md) covers the study and survey
  tables, the plan of a walkthrough, the position rule and where it is
  enforced, the vote event backfill, the support-based outcome, and the tests.
- [Pilot tooling](pilot-tooling.md) covers the curation script and its
  manifest, the driver and its checkpointing, the persona accounts and
  prompts, the environment, and the verifier.

Read the statement-ledger note before changing a ledger table. Several rules
are enforced in more than one layer, and the tests verify that those layers
agree.
