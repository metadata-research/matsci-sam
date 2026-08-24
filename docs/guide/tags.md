# Tags

Tags organize the vocabulary by subject. Each tag is a concept in a tag
scheme. MatSci-SAM uses community topics on definitions and PSPP facets on
terms. Each tag has its own page and is published as a `skos:Concept` in the
metadata exports.

![The Tags page with facet cards, topics, and collections](/images/docs/tags-index.png)

## Topics

A topic is a subject heading such as "Heat treatment" or "Electronic
structure". Signed-in contributors create topics from **Tags**, under
**Vocabulary** in the navigation bar, with **Add Tag**. Name matching ignores
case and surrounding spaces, so a second "heat treatment" returns the existing
topic. A merged topic returns its replacement.

![A definition with its topic badges and the author controls](/images/docs/definition-tags.png)

The author of a definition manages topics on the definition page. The pencil
next to the tag badges opens the topic picker. Selecting a topic attaches it,
and selecting it again removes it. Removal records a retraction alongside the
original assertion and its attribution.

Topics stay attached to the stable definition through later revisions. A
topic page at `/tags/topics/{topic}` lists the definitions filed under it.
The metadata exports also publish those topics on the containing term as
derived statements.

## Facets

Facets classify the term concept, not one definition of it. MatSci-SAM uses the
PSPP scheme, named for Processing, Structure, Properties, and Performance. The
scheme follows the facet analysis of
[Greenberg et al. (2023)](https://doi.org/10.1007/978-3-031-39141-5_18), where
processing establishes structure, structure gives rise to properties, and
properties determine performance in service.

| Facet       | What it groups                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Processing  | Terms for how a material is made, shaped, or treated, including synthesis, forming, heat treatment, and joining                                        |
| Structure   | Terms for the arrangement of the constituents of a material at any scale, from atomic and crystal structure through microstructure to macroscopic form |
| Properties  | Terms for measurable characteristics that follow from structure, including mechanical, thermal, electrical, optical, and chemical behavior             |
| Performance | Terms for how a material behaves in service under the conditions and over the time imposed by an application                                           |

Each facet page includes a scope note that states what belongs under the facet.
A term for behavior in service may take Properties as well as Performance.

![A term page with its facet chip under the identifier line](/images/docs/term-facets.png)

Administrators assign facets from the term page. The pencil beside the facet
chips opens the list. Selecting a facet attaches it, and selecting it again
removes it. A term may have several facets.

![A facet page listing the terms assigned to it](/images/docs/facet-page.png)

A facet page at `/tags/pspp/{facet}` lists the terms assigned to that facet.

## Topics that are also terms

A topic and a vocabulary term can identify the same concept. "Corrosion" can
be a subject heading for definitions and a term in the dictionary. The
contributor who created the topic or an administrator can link them from the
topic page.

![A tag page showing the linked term](/images/docs/tag-bridge.png)

A linked topic keeps its page and identifier and presents the definitions of
the term. The metadata exports state the link in both directions with
`skos:exactMatch`. The link is optional and one-to-one.

Equivalent-term links are available for topics. The link requires that the
topic is not used to classify a definition of the target term.

## Scope notes and tag changes

A scope note states what belongs under a tag in classification. A definition
states what the concept means. For example, "Degradation in service, not
surface finish" tells a contributor how to apply the tag.

Administrators can edit the definition, scope note, and alternative labels of
a tag. A semantic replacement uses a merge, which retires the original tag,
redirects its identifier, and moves its active statements to the replacement.

## Collections

A collection is a named set of terms gathered for a purpose. MatSci-SAM
publishes it at `/collections/{collection}` as a `skos:Collection`. A
membership policy controls changes. An administrator-created collection
accepts changes from administrators. When a deployment enables contributor
creation, a contributor-created collection accepts changes from any signed-in
contributor. Administrators retire and restore collections.

Create a collection from the Collections page with **New collection**, which
takes a title and an optional description. On the collection page, **Edit
details** changes the title or description, **Add a term** searches the
vocabulary, and the control beside a member removes it. The address is derived
from the initial title and remains fixed. Use the collection page to manage
membership.

Retirement removes a collection from the Collections index while its address
continues to resolve. The Turtle export marks it `owl:deprecated`. Retirement
also retracts active membership statements and retains their assertion records.
Restoration starts with an empty membership.

The [Collections](/collections) page and the individual collection pages are
public. Selecting a community narrows the Collections page to the collections
on its worklist. **Show everything** displays all collections for one request.
The collections section of the Tags page always lists all collections, so it
may list more than the scoped Collections page. See [Communities and
scope](/docs/communities).

## Tag pages and identifiers

The **Tags** page provides the facet schemes, topics, and collections. Each
scheme has a page at `/tags/{scheme}`, and each tag has a page at
`/tags/{scheme}/{tag}`. A scheme page lists its tags with the number of terms
filed under each. A facet page lists terms, and a topic page lists definitions.

These paths are the tag identifiers used in the metadata exports. A tag keeps
its path when it is merged or retired. A merged tag redirects to its
replacement, and a retired tag without a replacement displays its retired
status. Older links of the form `/tags/{number}` redirect to the readable path.
[Identifiers and citation](/docs/identifiers) describes the identifier grammar.

## Metadata

The [knowledge organization](/docs/reference) pages describe the model behind
tags, their SKOS representation, and the curation model for metadata consumers.

Each tag scheme is a `skos:ConceptScheme`, each tag is a `skos:Concept` in that
scheme, and each collection is a `skos:Collection`. A term or definition names
its tags with `dcterms:subject`. `/tags.ttl` publishes every scheme, tag, and
collection, and each term record includes the tags it refers to. [Metadata
access](/docs/metadata-access) lists the endpoints.
