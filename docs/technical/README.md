# Technical documentation

Notes for someone changing the code. They assume the
[developer guide](../../developing.md) for setup, and they are not served on
the site. The two served layers are the user guide in `docs/guide/` and the
knowledge organization reference in `docs/reference/`. Keep the three apart.

- [The statement ledger](knowledge-organization-ledger.md) covers the schema,
  the checks, the invariants, the predicate registry, the export, and the
  tests that hold them together.
- [The LLM layer](llm-layer.md) covers the client, the prompt registry, the
  provenance stamp, model identities, and how to add a structured call.
- [The graph layer](graph-layer.md) covers the named graphs, the projector
  and its hooks, running the Fuseki store and the Jena validators locally,
  the SHACL shapes, what CI checks, and the paper queries.

When a change touches a table in the ledger, read the first note end to end
before editing. Most of its rules are enforced in more than one place on
purpose, and the tests fail loudly when the places disagree.
