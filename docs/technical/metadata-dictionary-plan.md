# Metadata dictionary implementation plan

Status: implemented.

## Intended outcome

MatSci-SAM describes dictionary entries and how they are used in metadata. A
human-readable definition remains part of each entry. A separate Metadata view
makes classification, usage, sources, optional semantic links, and attribution
visible without requiring contributors to author raw RDF.

The metadata dictionary uses the existing architecture:
PostgreSQL is authoritative; RDF and named graphs remain projections. Existing
term identities, competing definition candidates and immutable revisions remain.

## Sources and decisions

- Greenberg et al., _Towards MatCore: A Unified Metadata Standard for Materials
  Science_, arXiv:2502.07106v1, 10 February 2025. The Minimal and DFT profiles appear in Figures 3 and 5. Existing 27-element catalog
  remains explicitly pinned to this preliminary snapshot.
- MatCore's current website presents version 0.3.0. Updating the existing
  transcription to that different specification is a separate versioned import;
  this change does not silently replace the 2025 identifiers or definitions.
- The MatCore reference page already distinguishes dictionary concepts,
  classification concepts, and metadata properties. Maintain that distinction.
- ICoN-PCL supplies realistic experimental examples, not an adopted schema.
  Processing method and deposition temperature are marked as local proposals.
- Previewing an ontology creates no saved assertion. Saving a related concept
  is optional and never implicitly claims equivalence, class membership, or an
  inherited classification.

## Implementation sequence

1. **Field registry and examples.** Describe the small supported set of entry
   metadata. List the pinned MatCore fields and separately labeled experimental
   proposals. Explain concepts, fields, and actual research records using DFT
   and atomic layer deposition. These examples are illustrative, not published
   research records or seeded vocabulary contributions.
2. **Assertions and permissions.** Store usage notes, alternative labels, field
   usage, field descriptions, and related external concepts as attributed
   assertions. Scope each to a whole term or an exact definition revision.
   Contributors propose; curators accept or reject. Authors and curators can
   retract assertions. Independent authors and source attestations remain
   distinguishable. Unreviewed proposals do not appear in public RDF.
3. **Metadata page and editor.** Assemble existing identity, definitions,
   classification and provenance; add the focused editor with Simple and
   Advanced views. Use `/terms/{id}/metadata` as an application view, avoiding
   conflicts with community terms named `metadata`. Canonical entity identifiers
   remain unchanged. Link from term and definition pages and the field catalog.
4. **RDF and provenance.** Export accepted active assertions in Turtle and
   JSON-LD at their correct scope. Preserve accepted assertion histories,
   sources and retractions in provenance. A vocabulary is a concept scheme,
   not a range class: correct the old MatCore value-scheme guidance accordingly.
5. **Validation.** Check authorization, review/retraction lifecycle, revision
   ownership by term, value validation, independent attestations, public/private
   filtering, RDF equivalence and local database constraints. Run build and
   browser checks for term → Metadata → add/propose → display/history/export.

## Boundaries of the first implementation

Actual datasets, samples, experiments and calculations are separate described
resources, not dictionary terms. This feature does not create those records.
MatCore requirements describe a selected dataset profile, not compulsory fields
on every term. Dictionary authorship/date/license must not become dataset
creator/date/license by default.

The existing Add editor, Simple/Advanced layout, ChEBI/ontology context,
Wolfram, AI assistance, attachments and definition revision publication remain
available. Metadata editing is a separate explicit action so source browsing and
ordinary definition publication never silently publish semantic assertions.

General ontology equivalence/subclass editing, editable arbitrary predicates,
full HIVE ingestion and a current MatCore 0.3.0 import remain future extensions.
The new catalog and assertion contract are designed to accommodate them without
changing existing concept identities.

## Verification

The automated checks cover value validation, authorization, review and
retraction, immutable revision scope, independent source attestations, deletion,
and migration constraints. RDF checks cover accepted-only output, current and
historical assertions, Turtle/JSON-LD equivalence, and named-graph separation.

Browser checks cover metadata publication and history, view switching without
losing field or source selections, desktop and mobile layouts, and the existing
source insertion and Undo workflow. Illustrative catalog examples do not seed
contributions into a deployment's database.

Simple is the default presentation. Advanced exposes more controls without
changing draft identity or implicitly saving a relationship. The toolbar remains
below the main Add form, with source matches and hierarchy in the right column
at desktop widths. On narrow screens the metadata sidebar follows the editor.
