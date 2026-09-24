# Metadata access

Download vocabulary content or contribution history for use in other tools.
Public exports include accepted metadata descriptions. Proposals awaiting
review and declined additions are restricted to their author and site
administrators.

## Download a record

Open a term and select **Advanced** under **View**. **SKOS** downloads its
current vocabulary description. **JSON-LD** provides the same description in
another data format. Open **Provenance** for its contribution history and
history downloads.

Choose a definition or revision page when you need one candidate or exact
wording. The [identifier guide](/docs/identifiers) explains these citation
choices.

For a larger download, use [all vocabularies](/vocabulary.ttl),
[tags and collections](/tags.ttl), or the [combined dataset](/dataset.ttl).
The combined download includes vocabulary, classification, and MatCore field
specifications. Histories are available separately through provenance.

## Metadata on dictionary entries

Select **Metadata** on a term to read or contribute descriptions of its use.
[Term metadata](/docs/term-metadata) explains scope, field associations,
optional evidence, and review. The [field catalog](/metadata/fields) and
[examples](/metadata/examples) explain the available fields.

## Named graphs

A named graph is one part of the published dataset. Available graph documents
include [vocabulary](/graphs/vocabulary), [classification](/graphs/kos),
[provenance](/graphs/provenance), and [MatCore](/graphs/matcore).
[Dataset information](/dataset) describes the publication.

Use the read-only [SPARQL service](/sparql) to query the dataset where that
service is enabled. Downloads remain available independently of the query
service and can be opened in your own RDF tools. Exported graph content can
reflect the most recent generated projection rather than a change just made
in the interface.

## Resource identifiers

Retain the persistent identifier shown for the resource when citing or linking
it from another system. The identifier distinguishes a term from a definition,
revision, or metadata field. See [Identifiers and citation](/docs/identifiers).

<a id="application-metadata-vocabulary"></a>

## Application metadata terms

[SKOS and metadata](/docs/reference/skos-and-metadata) explains the meaning of
published concepts and descriptions. The repository
[metadata publication reference](https://github.com/metadata-research/matsci-sam/blob/dev/docs/technical/metadata-publication.md)
lists download addresses, properties, graph contents, and serialization rules.
