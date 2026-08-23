# MatCore and the vocabulary

MatSci-SAM publishes three families of identified thing. They share one
identifier grammar and appear in the same RDF documents.

| Family | What it describes | Where it is identified |
| --- | --- | --- |
| Terms | materials science terminology | `/vocabulary/{term}` |
| Concepts | topics and facets that classify terms | `/tags/{scheme}/{concept}` |
| MatCore elements | metadata fields for describing a dataset | `/metadata/matcore#{element}` |

The first two are vocabulary. A term is a word the community defines, and a
concept is a label used to file terms. A MatCore element is a field in a
metadata record about a computational dataset, transcribed from Greenberg et
al. (2025). An element is a slot a depositor fills in, and it is not a
concept in any scheme.

## The element set

Each element is an `rdf:Property` with an English label and comment, the key
as printed in the source figure under `matsci:sourceKey`, and `matsci:required`
stating whether the paper marks it required.

The two tiers of the standard are published as `matsci:MetadataProfile`
resources. Minimal holds eighteen elements and applies to every computational
dataset. DFT holds nine and is optional. A profile lists its elements with
`dcterms:hasPart`, and each element names its profile with `dcterms:isPartOf`.

A `dcterms:Standard` resource records what the transcription is taken from,
`arXiv:2502.07106v1` of February 10, 2025, with its title and source URL. The
tables are preliminary and this is not an official or current MatCore release.

The element set is served as a named graph at `/graphs/matcore` and is
included in `/dataset.ttl`. [MatCore metadata](/metadata/matcore) presents the
same elements as a page, with one synthetic example record.

## Where the vocabulary supplies a value

One element draws its values from the dictionary. `material` declares the
concept scheme as its range.

```turtle
<…/metadata/matcore#material> a rdf:Property ;
  rdfs:label "Material"@en ;
  rdfs:range <…/vocabulary> .
```

A depositor recording a material names a term from the vocabulary instead of
writing free text. The range says where the values of the element come from.
MatSci-SAM holds no dataset records, so no document here links a dataset to
a term.

## The Dublin Core crosswalk

MatSci-SAM states this crosswalk. The 2025 paper places MatCore in the Dublin
Core lineage and publishes no element-by-element mapping, so a consumer reading
these relations is reading a claim of this project.

Seven of the twenty-seven elements have a Dublin Core counterpart.

| Element | Dublin Core property | Relation |
| --- | --- | --- |
| `creator` | `dcterms:creator` | `owl:equivalentProperty` |
| `title` | `dcterms:title` | `owl:equivalentProperty` |
| `date` | `dcterms:date` | `owl:equivalentProperty` |
| `description` | `dcterms:description` | `owl:equivalentProperty` |
| `source-citation` | `dcterms:bibliographicCitation` | `owl:equivalentProperty` |
| `doi` | `dcterms:identifier` | `rdfs:subPropertyOf` |
| `license` | `dcterms:license` | `rdfs:subPropertyOf` |

A subproperty relation marks an element that narrows the Dublin Core property.
A DOI is one kind of `dcterms:identifier`, and a MatCore license is a
`dcterms:license` restricted to SPDX values.

The other twenty elements have no counterpart, among them the nine that
describe a density functional theory calculation, such as `xc-functional`
and `k-points`.

Each relation is stated on the element, and no triple in these documents has
a Dublin Core property as its subject.

## Types in the RDF

A term is a `skos:Concept` and a MatCore element is an `rdf:Property`. These
documents declare no OWL classes. An element is not typed
`owl:DatatypeProperty` or `owl:ObjectProperty`, and the RDF states no datatype
for the value of an element. The source paper gives none.
