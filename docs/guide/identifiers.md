# Identifiers and citation

Choose an identifier according to what you want to cite.

| Resource   | Use                                               |
| ---------- | ------------------------------------------------- |
| Term       | The concept, with its changing set of definitions |
| Definition | One candidate, following later edits              |
| Revision   | Exact definition text at a recorded version       |

## Identifier paths

The default vocabulary uses `/vocabulary`. Community vocabularies add a
community slug. Definition and revision paths extend the term path.

```text
/vocabulary/{term}
/vocabulary/{community}/{term}
/vocabulary/{community}/{term}/definitions/{number}
/vocabulary/{community}/{term}/definitions/{number}/revisions/{version}
```

Omit `{community}/` for a term in the default vocabulary. Two vocabularies
can use the same label for distinct concepts with independent definitions.
A collection reference retains the identifier of the owning vocabulary.

## Term slugs

A term receives a readable slug at creation. For example, "density functional
theory (DFT)" becomes `density_functional_theory_dft`. A suffix such as `_2`
distinguishes a collision within one vocabulary. It is not a rank.
The assigned slug remains fixed when a display label changes.

[Identifier policy](/docs/reference/identifier-policy#slugs) specifies the
normalization and namespace rules.

## Definition and revision numbers

Definitions receive permanent creation-order numbers within a term.
Each definition has its own revision sequence, so Definition 1 and Definition 2
can each have revision 1. An author edit or restoration increments the revision
number and retains the definition number. Votes and model attribution do not
change these numbers.

Numeric legacy routes, such as `/definition/{id}`, redirect to readable paths.
Use the readable identifier in new citations.

## Tags, facets and collections

```text
/tags/{scheme}
/tags/{scheme}/{tag}
/collections/{collection}
```

For example, `/tags/pspp/processing` identifies the Processing facet.
Community topics use `/tags/topics`. Slugs remain fixed. A merged tag
redirects to its replacement, and a retired tag without a replacement
retains a status page. Numeric legacy tag links redirect to readable paths.

## Live rank lookup

Append `/rank/{rank}` to a term path to open the candidate at that rank.
For example, `/vocabulary/id4/data/rank/1` follows the leading candidate.
The destination can change with votes and new revisions. Use a definition or
revision identifier for a citation that must identify one candidate.

## Citation

Retain the persistent `https://w3id.org/matsci-sam` identifier shown on the
page. These patterns illustrate the three citation choices.

```text
https://w3id.org/matsci-sam/vocabulary/id4/data
https://w3id.org/matsci-sam/vocabulary/id4/data/definitions/{number}
https://w3id.org/matsci-sam/vocabulary/id4/data/definitions/{number}/revisions/{version}
```

Replace placeholders with the displayed numbers. Cite the term for a dataset
field or glossary concept. Cite a revision for a quotation or reproducible
analysis of exact wording. A revision fixes definition text, while the page
may also display examples added later.

## Machine-readable forms

Request `text/turtle` or `application/ld+json` at a readable vocabulary,
term, definition, or revision address. A 303 response points to the matching
`/skos.ttl` or `/skos.jsonld` document. Term history uses `/provenance`,
`/provenance.ttl`, and `/provenance.jsonld`.

The RDF names the canonical candidate with `matsci:canonicalDefinition` and
its active revision with `matsci:currentRevision`.
[Metadata access](/docs/metadata-access) lists other exports.

## Persistent resolution

The w3id namespace redirects to the website serving MatSci-SAM. Retain the
w3id in citations even when the browser displays a different website address.
The website location can change independently of the identifier.

Ordinary edits preserve definition and revision addresses. Exceptional
administrator cleanup permanently removes test definitions and revisions.
Removed numbers are not reassigned. See the
[stability policy](/docs/reference/identifier-policy#stability).
