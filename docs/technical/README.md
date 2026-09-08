# Technical documentation

These notes describe implementation contracts for developers. Begin with the
[development setup](../../developing.md). The [documentation index](../README.md)
links to contributor instructions and the metadata reference.

## Data and publication

- [Statement ledger](knowledge-organization-ledger.md): schema, authorization,
  invariants, and RDF export.
- [Examples of use](examples.md): immutable contributions and featured-selection
  history.
- [Graph layer](graph-layer.md): projection, Fuseki, SHACL, and graph checks.
- [Canonical definitions and identifiers](w3id-canonical-term-proposal.md):
  ordering, readable routes, content negotiation, and compatibility limits.

## Contributions and studies

- [LLM layer](llm-layer.md): prompts, model identities, generation stamps, and
  publication boundaries.
- [Studies and walkthrough](studies.md): steps, Position recording, protocol
  amendments, exclusions, and invariants.
- [Study help and workflow](study-help-and-workflow.md): shared guide excerpts,
  authentication return paths, and draft state.
- [Pilot tooling](pilot-tooling.md): curation manifests, simulated participants,
  checkpoints, and verification.

Read the relevant contracts before changing a write path. Schema checks,
application rules, and release invariants often enforce the same relationship.
