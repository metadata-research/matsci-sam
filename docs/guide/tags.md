# Tags

Topics classify definitions. PSPP facets classify terms. Collections gather
terms for a purpose. Use **Tags** under **Vocabulary** to browse these groups.

![Topics, facets, and collections](/images/docs/tags-index.png)

## Topics

Create a topic with **Add Tag**. Name matching ignores case and surrounding
spaces. A duplicate name returns the existing topic or its merged replacement.

The definition author manages topics with the pencil beside the tag badges.
Select a topic to attach it and select it again to remove it. The record
retains the original assertion and any retraction.

![Topics and examples on a definition](/images/docs/definition-tags.png)

Topics remain attached through later definition revisions. A topic page lists
the definitions classified under it. Metadata exports also derive the topic
on the containing term.

## Facets

PSPP groups terms under Processing, Structure, Properties, and Performance.
The classification follows [Greenberg et al. (2023)](https://doi.org/10.1007/978-3-031-39141-5_18).

| Facet       | Scope                                                                |
| ----------- | -------------------------------------------------------------------- |
| Processing  | How a material is made, shaped, or treated                           |
| Structure   | Arrangement of material constituents, from atoms to macroscopic form |
| Properties  | Measurable characteristics, such as thermal or mechanical behavior   |
| Performance | Behavior in service under specified conditions and over time         |

Read the scope note on the facet page before assigning it. A term may have
several facets. Administrators assign them with the pencil beside the facet
chips on a term page. Select an assigned facet again to remove it.

![Facets assigned to a term](/images/docs/term-facets.png)
![Terms classified under a facet](/images/docs/facet-page.png)

## Topics that are also terms

A topic creator or administrator can link a topic to an equivalent dictionary
term from the topic page. The optional link is one-to-one. It is refused if
the topic already classifies a definition of that term.

![A topic linked to a vocabulary term](/images/docs/tag-bridge.png)

The topic retains its identifier and displays the linked definitions.
The exports publish `skos:exactMatch` in both directions.

## Scope notes and tag changes

A definition states what a concept means. A scope note guides its use in
classification. Administrators can edit a tag definition, scope note, and
alternative labels. A merge retires a tag, redirects its identifier, and
moves active statements to the replacement with both assertions retained.

## Collections

Create a collection with **New collection** when your account has permission.
On its page, use **Edit details**, **Add a term**, or the remove control beside
a member. The address is fixed from the initial title.

Administrator-created collections accept membership changes from
administrators. Contributor-created collections accept them from any signed-in
contributor when that creation mode is enabled. Administrators can retire and
restore collections.

Retirement removes a collection from the index and retracts active membership
statements. Its address and assertion history remain. A restored collection
starts empty.

**Collections** follows the selected community worklist. **Show everything**
expands that view for one request. The Tags page lists collections across the
site. Collections may reference terms from any hosted vocabulary.

## Tag pages and identifiers

Scheme pages use `/tags/{scheme}`. Tag pages use `/tags/{scheme}/{tag}`.
Facet pages list terms and topic pages list definitions. Slugs remain fixed.
Merged tags redirect to their replacements. Retired tags without replacements
show their status. Numeric legacy tag links redirect to readable paths.

## Metadata

Tag schemes are `skos:ConceptScheme` resources, tags are `skos:Concept`
resources, and collections are `skos:Collection` resources. Classification
uses `dcterms:subject`. Download `/tags.ttl` for schemes, tags, and collections.
[Metadata access](/docs/metadata-access) lists the exports, and the
[reference](/docs/reference/knowledge-organization) explains the model.
