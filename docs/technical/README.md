# Technical documentation

These notes describe the code, data model, and maintenance procedures for
MatSci-SAM. Begin with the [development setup](../../developing.md). The [documentation index](../README.md)
links to contributor instructions and the metadata reference.

## Data and publication

- [Metadata dictionary](metadata-dictionary-plan.md): source versions, term/revision
  scope, Simple/Advanced views, curation and exports.

- [Metadata publication](metadata-publication.md): document endpoints, RDF
  mappings, named graphs, source evidence and historical attribution.
- [Contribution files](contribution-files.md): upload validation, private pending
  files, publication scope, downloads and cleanup.
- [Statement ledger](knowledge-organization-ledger.md): schema, authorization,
  invariants, and RDF export.
- [Examples of use](examples.md): immutable contributions and featured-selection
  history.
- [Graph layer](graph-layer.md): projection, Fuseki, SHACL, and graph checks.
- [Canonical definitions and identifiers](w3id-canonical-term-proposal.md):
  ordering, readable routes, content negotiation, and compatibility limits.

## Contributions and studies

- [Term reference resources](term-references.md): reference ontology and Wolfram retrieval,
  source snapshots, contributor-declared citations and revision provenance.
- [Inference providers](inference-providers.md): provider settings, OAuth,
  readiness, structured-output testing, switching, and generation provenance.
- [LLM layer](llm-layer.md): prompts, model identities, generation stamps, and
  publication boundaries.
- [Studies and walkthrough](studies.md): steps, Position recording, protocol
  amendments, exclusions, and invariants.
- [Study help and workflow](study-help-and-workflow.md): shared guide excerpts,
  authentication return paths, and draft state.
- [Pilot tooling](pilot-tooling.md): curation manifests, simulated participants,
  checkpoints, and verification.

Before changing a write path, check its schema constraints, application rules,
release invariants, and tests. The notes describe repository behavior; consult
the operations repository for the configuration and release running on a host.
