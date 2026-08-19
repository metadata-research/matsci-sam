# Tags

Tags group the vocabulary by subject. A tag is a concept in a tag scheme,
and the scheme says what kind of tag it is. The pilot has two schemes.
Topics are community tags that authors attach to their own definitions.
Facets are curated tags that administrators attach to a term. Both kinds
have their own pages, and both are published as `skos:Concept` resources in
the metadata exports.

![The Tags page: facet cards, topics by letter, and collections](/images/docs/tags-index.png)

## Topics

A topic is a subject heading such as "Heat treatment" or "Electronic
structure". Signed-in contributors create topics from **Tags** in the
navigation bar, with **Add Tag**. Names are matched without regard to case or
surrounding spaces, so a second "heat treatment" returns the existing topic.
A topic that has been merged into another returns the topic that replaced it.

![A definition with its topic badges and the author's pencil](/images/docs/definition-tags.png)

The author of a definition attaches topics on the definition page. The pencil
next to the tag badges opens a picker that lists every topic. A first
selection attaches a topic, and a second removes it. Only the author can
change the topics of a definition. A removed topic is recorded as withdrawn.
The record of who attached it and when is kept.

Topics stay attached to the stable definition through later revisions. A
topic page at `/tags/topics/{topic}` lists the definitions filed under it.
Topics attached to any definition of a term also appear on the term itself in
the metadata exports, so a data consumer who reads only term records still
finds them.

## Facets

Facets classify the term concept, not one definition of it. The pilot has
one facet scheme, PSPP, named for its four members.

| Facet       | Meaning                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Processing  | How a material is made, shaped or treated, including synthesis, forming, heat treatment and joining                            |
| Structure   | The arrangement of the constituents of a material at any scale, from atomic and crystal structure to macroscopic form          |
| Properties  | Measurable characteristics of a material, mechanical, thermal, electrical, optical or chemical, that follow from its structure |
| Performance | How a material behaves in service under real conditions and over time, including durability, reliability and failure           |

![A term page with its facet chip under the identifier line](/images/docs/term-facets.png)

Administrators assign facets from the term page. A faceted term shows its
facets under the identifier line, and each chip opens the facet page. An
administrator sees a pencil beside the chips that opens the list of facets,
where a first selection attaches a facet and a second removes it. A term may
have several facets, and a facet does not claim that the classification is
complete.

![A facet page listing the terms assigned to it](/images/docs/facet-page.png)

A facet page at `/tags/pspp/{facet}` lists the terms it is assigned to.
Authors cannot attach a facet to a definition, and administrators cannot
attach a topic to a term.

## Tags that are also terms

A tag and a term can be the same concept. "Corrosion" is a subject you file
definitions under, and it is also a thing the dictionary defines. When they
are the same, an administrator, or the contributor who created the tag, can
say so from the tag page.

![A tag page showing the term it is linked to](/images/docs/tag-bridge.png)

A linked tag keeps its own page and identifier and gains the definitions of
the term. The metadata exports state the link in both directions with
`skos:exactMatch`, so a reader who arrives at either one finds the other.
Linking is optional and uncommon. Most tags are subject headings that no one
would write a definition of, and they stay as they are.

A facet is never linked, because a facet classifies a term rather than being
one. A tag is also never linked to a term whose own definitions are filed
under it, since the statement would say that a definition is about itself.

## Scope notes

A tag can carry a scope note: a sentence saying what belongs under it, which
is a different question from what it means. "Degradation in service, not
surface finish" tells a contributor how to use the tag whatever the linked
term goes on to say.

The note matters most as the vocabulary ages. A tag is a stable identifier
for a meaning that moves, so the rule is that a label or a scope note is
edited only to correct it. A tag whose meaning has genuinely changed is
retired and replaced, which keeps every statement already filed under the old
tag meaning what it meant.

## Collections

A collection is a curated named set of terms, published at
`/collections/{collection}` as a `skos:Collection`. Administrators assemble
collections outside the interface. The [Collections](/collections) page lists
them, and each collection page lists the terms it gathers. Anyone can browse
them.

## Tag pages and identifiers

The **Tags** page has three parts: the facet schemes and their facets, then
the topics A to Z with a letter index, then the collections. Each scheme has
a page at `/tags/{scheme}` and each tag a page at `/tags/{scheme}/{tag}`.
A scheme page lists the tags it holds with the number of terms filed under
each. A facet page lists those terms, and a topic page lists the definitions
filed under it. These paths are the tag identifiers used in the metadata
exports. A tag keeps its path
when it is merged or retired. A merged tag redirects to its replacement, and a
retired tag without a replacement shows that it is retired. Older links of the
form `/tags/{number}` redirect to the readable path.
[Identifiers and citation](/docs/identifiers) describes the identifier grammar.

## Metadata

The [knowledge organization](/docs/reference) pages describe the model behind
tags, the SKOS it is published in, and how curation works, for readers who
work with the metadata rather than the pages.

Each tag scheme is a `skos:ConceptScheme`, each tag a `skos:Concept` in it,
and each collection a `skos:Collection`. A term or a definition names its
tags with `dcterms:subject`. Every scheme, tag and collection is available
in one Turtle document at `/tags.ttl`, and each term record includes the
tags it refers to.
[Metadata access](/docs/metadata-access) lists the endpoints.
