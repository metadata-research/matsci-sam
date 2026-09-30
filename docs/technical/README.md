# Technical documentation

These notes describe the code, data model, and maintenance procedures for
MatSci-SAM. Begin with the [development setup](../../developing.md). The
[documentation index](../README.md) links to contributor instructions and the
metadata reference.

## Data and publication

| Document | Contents |
| --- | --- |
| [Metadata dictionary](metadata-dictionary-plan.md) | Source versions, term/revision scope, Simple/Advanced views, curation and exports |
| [Metadata publication](metadata-publication.md) | Document endpoints, RDF mappings, named graphs, source evidence and historical attribution |
| [Contribution files](contribution-files.md) | Upload validation, private pending files, publication scope, downloads and cleanup |
| [Statement ledger](knowledge-organization-ledger.md) | Schema, authorization, invariants, and RDF export |
| [Examples of use](examples.md) | Immutable contributions and the history of featured selections |
| [Graph layer](graph-layer.md) | Projection, Fuseki, SHACL, and graph checks |
| [Canonical definitions and identifiers](w3id-canonical-term-proposal.md) | Ordering, readable routes, content negotiation, and compatibility limits |

## Contributions and studies

| Document | Contents |
| --- | --- |
| [Term reference resources](term-references.md) | Reference ontology and Wolfram retrieval, source snapshots, citations declared by contributors and revision provenance |
| [Inference providers](inference-providers.md) | Provider settings, OAuth, readiness, tests of structured output, switching, and generation provenance |
| [LLM layer](llm-layer.md) | Prompts, model identities, generation stamps, and publication boundaries |
| [Studies and walkthrough](studies.md) | Steps, Position recording, protocol amendments, exclusions, and invariants |
| [Study help and workflow](study-help-and-workflow.md) | Shared guide excerpts, authentication return paths, and draft state |
| [Pilot tooling](pilot-tooling.md) | Curation manifests, simulated participants, checkpoints, and verification |

Before changing a write path, check its schema constraints, application rules,
release invariants, and tests. The notes describe repository behavior. Consult
the operations repository for the configuration and release running on a host.
