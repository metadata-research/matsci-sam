# MatCore and the vocabulary

MatSci-SAM publishes three families of thing. They share one identifier
grammar and one RDF document, and they mean different things.

| Family | What it describes | Where it is identified |
| --- | --- | --- |
| Terms | materials science terminology | `/vocabulary/{term}` |
| Concepts | topics and facets that classify terms | `/tags/{scheme}/{concept}` |
| MatCore elements | metadata fields for describing a dataset | `/metadata/matcore#{element}` |

The first two are vocabulary. A term is a word the community defines, and a
concept is a label used to file terms. The third is a different kind of thing
altogether. A MatCore element is a slot in a metadata record about a
computational dataset, transcribed from Greenberg et al. (2025). The dataset is
not part of the vocabulary, and the element is not a term.

Keeping them apart matters, because the temptation is to treat every named
thing as a term. A `k-points` element is not a term awaiting a definition. It
is a field a depositor fills in.

## Where the two meet

They meet at one point. Some MatCore elements take a value that should come
from a controlled vocabulary rather than free text, and `material` is the clear
case. The element says as much in RDF.

```turtle
<…/metadata/matcore#material> a rdf:Property ;
  rdfs:label "Material"@en ;
  rdfs:range <…/vocabulary> .
```

`rdfs:range` names the vocabulary as the source of values. It does not assert
that any particular term has been used in any particular dataset. This site
holds no dataset records at all, and the ledger has no subject kind for one. If
deposited datasets are ever recorded here, the link from a dataset to a term
will be an explicit statement rather than something read off the range.

## The Dublin Core crosswalk

The 2025 paper places MatCore in the Dublin Core lineage and observes that core
standards map their properties to it. The paper publishes no crosswalk, so the
relations below are read off the element descriptions and stated by this
project rather than attributed to the source.

Seven of the twenty-seven elements have a Dublin Core counterpart. Five are the
same property and say so with `owl:equivalentProperty`. Two narrow one and use
`rdfs:subPropertyOf`, which is the weaker and more accurate claim. A DOI is one
kind of `dcterms:identifier`, not every kind, and a MatCore license is a
`dcterms:license` restricted to SPDX values.

The remaining twenty elements have no counterpart. `xc-functional` and
`k-points` describe a density functional theory calculation, and no
general-purpose standard carries that meaning. Leaving them unmapped is the
accurate outcome rather than a gap to be filled.

The two tiers, Minimal and DFT, are published as `matsci:MetadataProfile` and
list their elements with `dcterms:hasPart`. They are not SKOS collections. The
range of `skos:member` is a concept or a collection, so using it here would
entail that every element is a concept in this vocabulary, which is the one
thing the element set must not say.

No statement is ever made about a Dublin Core property itself. The crosswalk
points outward from elements this project publishes and never adds triples to
somebody else's namespace.

## What this does not do

None of this makes the vocabulary an OWL ontology. Terms are published as
`skos:Concept`, which in OWL is an individual and not a class, so there is
nothing here to reason over. MatCore elements are `rdf:Property` rather than
`owl:DatatypeProperty` or `owl:ObjectProperty`, because the source paper
specifies no datatypes and choosing one would assert more than the paper
supports.
