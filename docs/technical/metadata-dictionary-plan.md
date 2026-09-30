# Metadata dictionary implementation

MatSci-SAM stores attributed metadata about dictionary entries. Definitions,
classification, usage notes, field associations and related concepts retain
separate scope and history. PostgreSQL is authoritative. RDF and named graphs
are projections of those records.

<a id="intended-outcome"></a>

## Metadata page

Contributors use `/terms/{id}/metadata` to submit metadata about a term or its
definitions through form fields. Term and revision identifiers remain unchanged.

Metadata can apply to a whole term or one exact definition revision. A later
revision does not inherit assertions from earlier wording. The page can show
classification and provenance alongside dictionary metadata without changing the
scope of those records.

<a id="sources-and-decisions"></a>

## Catalog sources

The MatCore catalog contains the 27 elements of the Minimal and DFT profiles in
Greenberg et al., *Towards MatCore: A Unified Metadata Standard for Materials
Science*, [arXiv:2502.07106v1](https://arxiv.org/abs/2502.07106v1), February 10,
2025. Figures 3 and 5 specify the fields and requirement markers. This
preliminary source remains a distinct versioned specification.

Processing method and deposition temperature are local experimental proposals
with version `proposal-1`. The catalog labels them separately. They are not
adopted ICoN-PCL or MatCore requirements. DFT and atomic layer deposition
examples illustrate field associations without creating research records or
vocabulary contributions.

A field specification describes the field. Attribution for an assertion belongs
to its contributor, with any supporting source recorded separately.

<a id="implementation-sequence"></a>

## Implementation

### Field registry and interface

`lib/dictionary-metadata.ts` defines five supported fields and the catalog.
`usageNote`, `usedAsValueFor` and `describesMetadataField` appear in Simple.
`alternateLabel` and `relatedConcept` are additional Advanced controls. Simple
defaults to scope for the whole term and shows no source fields. Advanced adds
the scope choice, source name, link and version, and language for text values.
View changes preserve one draft. A value set in Advanced still applies in
Simple, which lists it before submission.

Field associations accept catalog IRIs. Related concepts accept an explicit HTTP
or HTTPS concept IRI, including IRIs in the local identifier namespace. Text
values support optional language tags. `lib/term-metadata-validation.ts`
validates types, source identifiers and source version requirements. The
predicate for related concepts records context without asserting equivalence,
subclass relationships or class membership.

### Assertions and permissions

Migration `0062_term_metadata_assertions.sql` creates attributed assertions with
immutable term or revision scope, field, value and source details. The database
verifies that a selected revision belongs to the term. Independent authors and
source attestations remain separate records. The same author cannot repeat an
active assertion with the same value, scope and source.

Contributors with a completed profile can propose metadata. Site administrators
can accept or decline proposals. Administrator additions are accepted on
submission. Moderators and community stewards have no separate metadata review
permission. Authors and site administrators can withdraw assertions.

The interface labels review actions **Accept** and **Decline**. Stored statuses
are `proposed`, `accepted` and `rejected`. Review resolves a proposal once.
Accepted contents remain immutable, and withdrawal records its actor and time.
Corrections require a separate assertion.

Anonymous readers see accepted metadata and its withdrawal history. A
contributor who has signed in can also see their own proposals and declined
submissions. Site administrators can see the review queue. Unreviewed and
rejected records are excluded from public RDF, including provenance.

### RDF and provenance

`lib/term-metadata-rdf.ts` serializes facts and independently attributed
assertions. Accepted active facts appear at the term IRI or exact revision IRI.
Current vocabulary documents include current revision metadata. Historical
revision metadata remains with its historical revision and provenance.

Accepted assertion histories retain sources, versions, review and retraction
attribution. Ordinary RDF 1.1 reification provides equivalent Turtle and JSON-LD
representations. Identical facts can collapse to one RDF triple while
independent assertion entities remain distinct.

`lib/dictionary-metadata-export.ts` publishes the custom predicates and local
experimental properties in the vocabulary graph. The MatCore graph contains the
preliminary source specification. `matsci:recommendedValueScheme` expresses
project guidance about field values. It does not make a concept scheme an RDF
range class or impose a requirement from the MatCore paper.

[Metadata publication](metadata-publication.md) contains the property tables,
source semantics and contracts for named graphs.

<a id="boundaries-of-the-first-implementation"></a>

## Scope and deferred work

Metadata editing is separate from definition publication. Reference and ontology
previews, Wolfram lookups and assistant requests do not implicitly save semantic
relationships. Contributors publish related concepts through the metadata
workflow. On the Metadata page, **Cite this match** fills the source fields from
an ontology selection, and **Add as related concept** fills a `relatedConcept`
value with its source title and release. An opened mapped concept uses
**Cite this concept** and its own identifier. These actions fill the local
draft. The contributor must review and submit it before an assertion is stored.

The metadata workflow records dictionary assertions. MatCore requirements apply
to dataset profiles. Dataset instances and their creator, date and license
values require a separate workflow.

Deferred work includes arbitrary predicate editing, general ontology equivalence
and subclass editing, full HIVE ingestion, and imports of later MatCore
specifications, including version 0.3.0. Such imports require their own
versioned catalog definitions. Preserve the preliminary 2025 identifiers and
descriptions when adding a later specification.

## Verification

- `pnpm test:dictionary-metadata` checks the field catalog and representation.
- `pnpm test:term-metadata` checks input validation.
- `pnpm test:term-metadata-db` checks authorization, review, withdrawal,
  immutable scope, independent attestations and migration constraints against
  a migrated local database.
- `pnpm test:term-metadata-rdf` and `pnpm test:term-metadata-rdf-db` check public
  filtering, current and historical scope, independent provenance,
  Turtle/JSON-LD equivalence and separation of named graphs.

Browser checks cover term to Metadata navigation, submission, administrator
review, withdrawal history and Simple/Advanced switching without losing draft
values. Existing definition tools and publication remain separate regression
checks. The [contributor guide](../guide/term-metadata.md) describes the public
task.
