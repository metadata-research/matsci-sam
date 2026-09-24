# MatCore and the vocabulary

MatSci-SAM publishes vocabulary concepts and MatCore metadata elements.

| Family           | What it describes                         | Identifier pattern                                       |
| ---------------- | ----------------------------------------- | -------------------------------------------------------- |
| Terms            | materials science terminology             | `/vocabulary/{term}` or `/vocabulary/{community}/{term}` |
| Concepts         | topics on definitions and facets on terms | `/tags/{scheme}/{concept}`                               |
| MatCore elements | metadata fields for describing a dataset  | `/metadata/matcore#{element}`                            |

Terms and classification tags are SKOS concepts. Topics classify definitions,
and facets classify terms. MatCore elements are fields for computational
dataset metadata ([Greenberg et al., 2025](https://arxiv.org/abs/2502.07106v1)).

## MatCore profiles

Greenberg et al. present MatCore as a two-tier metadata model for computational
materials datasets. The Minimal MatCore Metadata profile provides fields common
to every dataset. The second tier adds fields for density functional theory
(DFT), classical molecular dynamics, GW/BSE, machine learning, and derivative
methods (see Figure 1). MatSci-SAM represents the Minimal and DFT profiles from
the preliminary `arXiv:2502.07106v1` snapshot dated February 10, 2025.

The Minimal profile contains 18 elements. The 13 required elements are
`creator`, `title`, `date`, `description`, `material`, `calculation-type`,
`simulation-conditions`, `method`, `software-code`, `matcore-version`,
`matcore-id`, `matcore-date`, and `license`. The five optional elements are
`disclaimer`, `software-files`, `Source-citation`, `doi`, and `funding` (see
Figure 3).

The DFT profile is the optional second tier for density functional theory. Its
three required elements are `xc-functional`, `potential`, and `basis-set`. The
six optional elements are `calculation-physics`, `k-points`, `k-smearing`,
`Self-consistent-field-convergence`, `state-occupations`, and
`relaxation-convergence` (see Figure 5).

## MatSci-SAM representation

[MatCore metadata](/metadata/matcore) presents the 27 element definitions and
one synthetic DFT example. The catalog preserves the source spelling of each
key and its requirement marker. The descriptions are concise paraphrases of
the source tables.

MatSci-SAM assigns each element a normalized identifier under
`/metadata/matcore#` and publishes it as an `rdf:Property` with an English label
and comment. The RDF also records the source key, requirement status, and
profile membership. The Minimal and DFT profiles are `matsci:MetadataProfile`
resources, and a `dcterms:Standard` resource identifies the source snapshot.

The MatCore element set is available as a named graph at
[`/graphs/matcore`](/graphs/matcore) and as part of
[`/dataset.ttl`](/dataset.ttl).

## Vocabulary and Dublin Core

MatCore elements identify fields in computational dataset metadata. Vocabulary
terms identify materials science concepts. MatSci-SAM suggests its vocabulary as a source of concepts for the `material`
element using `matsci:recommendedValueScheme`. This is project guidance, not
a controlled-value requirement from the paper.

```turtle
<…/metadata/matcore#material> a rdf:Property ;
  rdfs:label "Material"@en ;
  matsci:recommendedValueScheme <…/vocabulary> .
```

This recommendation names the default MatSci-SAM concept scheme at `/vocabulary`.
Community vocabularies have separate scheme IRIs at
`/vocabulary/{community}`.

The MatSci-SAM RDF layer also maps seven general MatCore elements to Dublin
Core.

| Element           | Dublin Core property            | Relation                 |
| ----------------- | ------------------------------- | ------------------------ |
| `creator`         | `dcterms:creator`               | `owl:equivalentProperty` |
| `title`           | `dcterms:title`                 | `owl:equivalentProperty` |
| `date`            | `dcterms:date`                  | `owl:equivalentProperty` |
| `description`     | `dcterms:description`           | `owl:equivalentProperty` |
| `source-citation` | `dcterms:bibliographicCitation` | `owl:equivalentProperty` |
| `doi`             | `dcterms:identifier`            | `rdfs:subPropertyOf`     |
| `license`         | `dcterms:license`               | `rdfs:subPropertyOf`     |

## Dictionary metadata

The [metadata field catalog](/metadata/fields) brings together this frozen
MatCore snapshot and a separately labeled [experimental proposal](/metadata/experimental).
[Examples](/metadata/examples) distinguish a concept, a field describing a
research record, and a value recorded for a particular dataset or activity.

Each term has a Metadata page with Simple and Advanced views. Simple provides
usage notes and links to fields. Advanced exposes source details and optional
related concepts. Information can describe the whole term or one exact
definition revision; revising a definition does not silently move its metadata.
Contributors propose additions, and curators decide what to publish.

A term used as a field value remains a vocabulary concept. A dictionary entry
explaining a metadata field links to its specification; it does not become that
property. Ontology previews do not create relationships. Saved related-concept
links are explicit, independently sourced, and do not assert equivalence or
class membership.
