# The knowledge organization model

MatSci-SAM organizes terms into vocabularies. Definitions explain those terms,
while topics, facets and collections provide different ways to group them.
Term metadata adds usage guidance, field associations and related concepts.
Each contribution retains its scope and attribution.

## Vocabulary schemes and definitions

A vocabulary is a named set of concepts. The [vocabulary page](/vocabulary)
lists the default vocabulary and community vocabularies. Two vocabularies can
use the same label for different concepts. Each term has its own identifier
and definitions.

A definition is one contributed interpretation of a term. Other contributors
can publish alternative definitions. A new version preserves the definition
identity and records revised wording. The **Default definition** is selected
by the public ranking rule. It does not replace the other definitions or imply
editorial approval.

## Concept schemes

Topics classify definitions. A contributor can create a topic and assign it
to their own definition. A topic on a definition also appears in the metadata
of its containing term.

Facets classify terms. Site administrators assign the Processing, Structure,
Properties and Performance facets. A term can have several facets. These
categories follow the materials science organization described by
[Greenberg et al. (2023)](https://doi.org/10.1007/978-3-031-39141-5_18).

Topics and facets can have definitions, alternative labels and scope notes.
A definition explains meaning. A scope note explains when to use a category.
Broader and related links connect categories within their scheme.

## Equivalent topics and terms

A topic creator or site administrator can link a topic to an equivalent term
when the scheme permits it. The topic retains its identifier and displays the
linked definitions. A topic cannot classify a definition of the same term to
which it is linked as equivalent.

This explicit equivalence differs from **Related external concept** metadata.
A related-concept contribution records relevant context without asserting that
the two concepts mean the same thing.

## Collections

A collection is a named, unordered set of terms. It can include terms from
several vocabularies. Membership leaves each term in its original vocabulary.

Site administrators manage administrator collections. Contributor collections
accept membership changes from signed-in contributors when that creation mode
is enabled. Retired collections retain their membership history.

## Statement ledger

Classification and relation records identify who contributed them and when.
A withdrawal preserves the earlier record and adds who withdrew it and when.
Imported records can lack attribution that was not recorded originally.

The separate [Term metadata](/docs/term-metadata) workflow supports information
about a whole term or one exact definition revision. Revision metadata stays
with that version when its wording changes. Site administrators review metadata
proposals before they enter public exports.

[The statement ledger contract](https://github.com/metadata-research/matsci-sam/blob/dev/docs/technical/knowledge-organization-ledger.md)
documents relation types, storage rules and derived RDF statements.
