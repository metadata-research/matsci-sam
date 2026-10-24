# MatCore and the vocabulary

A vocabulary concept explains an idea. A metadata field specifies information
to record about something. A field value supplies that information for a
particular record.

For example, density functional theory is a concept that can be defined in
MatSci-SAM. Method is a field in a computational dataset description. A
researcher can record density functional theory as the method used for a
particular calculation. The concept, field and calculation record have
different identities.

## MatCore source versions

MatCore describes metadata for computational materials datasets.
[Greenberg et al. (2025)](https://arxiv.org/abs/2502.07106v1) present a Minimal
profile and additional profiles for particular computational methods.
The [2025 reference catalog](/metadata/matcore) includes the Minimal and density
functional theory profiles from the preliminary February 10, 2025 version,
`arXiv:2502.07106v1`.

The Minimal profile contains 18 elements, of which 13 are required and five
optional in that source. The DFT profile adds nine elements, of which three
are required and six optional. These requirements apply to the corresponding
dataset descriptions.

Communities with MatCore enabled can browse a preserved snapshot of the
[MatCore 0.3.0 standard](https://matcore.org/standard-document-content.html).
Its seven sections cover the common core, DFT, molecular dynamics, many-body
perturbation theory, machine learning, phase field and derived properties.
Once installed for an authorized members-only community, its Vocabulary view
presents 248 preserved source entries. The full source text is installed
separately and is not distributed in the application repository. A
contributor can propose a change to one entry without importing a whole set
of drafts. Browsing creates no private working copies. The optional bulk
importer remains available under **My work**. The common core and DFT appear
first for review.

The two source versions have separate identities. Community proposals and
later MatCore source snapshots do not change the meaning of the 2025 catalog
identifiers.

## Reference catalogs

The 2025 catalog lists its 27 elements, source keys and requirement markers.
It also includes a synthetic DFT example.
The [field catalog](/metadata/fields) identifies the source version for each
field specification.

The catalog also lists a separate [experimental proposal](/metadata/experimental)
for processing method and deposition temperature. Those fields are local
proposals for discussing experimental metadata, independent of MatCore and
ICoN-PCL.

## Field development

A community can develop vocabulary concepts and metadata fields in the same
workspace. Metadata development is optional. MatCore support is a separate
choice. A field proposal combines an explanatory definition with a field
specification. The specification records the field path, data type, value
form, format, requirement, repeatability, allowed values, units, examples,
guidance and notes. Data type describes a value or its items. Value form
distinguishes a single value, a list and an array. Repeatability describes
whether the field itself may occur more than once. Rules apply within their
parent context and, when selected, a standard profile. For example, a child
can be required when its optional parent is present. An unspecified rule
remains distinct from an optional rule. Older List value types remain readable
without rewriting saved drafts or source baselines. An absent value form or
separate Notes value is not inferred from source prose.

The preserved source baseline retains the source wording, location, version
and attribution. **Propose a change** creates a private working copy of the
selected source entry. **Continue my draft** resumes an existing copy,
including one created by an earlier bulk import, without replacing its edits
or contribution history. These drafts represent work in progress, not earlier
versions of the MatCore standard.

Contributors edit their private proposals and supply citations for changes.
A new local field can use a MatCore profile as context without being attributed
to the imported standard. A field can also be independent of MatCore, with no
profile, imported occurrence or baseline. Its citations and contribution
history still accompany each revision.

Publication creates a MatSci-SAM proposal visible to readers of the community. Each specification revision
identifies the definition revision that explains it. Source attribution and
supporting citations remain separate, and earlier published revisions remain
available. JSON downloads identify the selected revision and its profile
context, sources and history. For independent fields, the profile context
and imported source records are absent. The export does not invent a standard
association.

Source snapshots and local proposal revisions have separate identities.
Editing, publishing or reviewing a proposal leaves the source snapshot
unchanged. Adding a later snapshot does not automatically update existing
drafts or proposals. Each keeps its original source association. The current
workflow does not move proposed changes between source versions.

Site administrators record local review decisions against an exact revision.
Acceptance in MatSci-SAM does not establish adoption by the MatCore team. The
[workflow guide](/docs/matcore-workflow) explains draft editing, publication,
revision and withdrawal.

## Vocabulary and Dublin Core

The MatSci-SAM vocabulary can supply concepts for metadata field values. The
preliminary MatCore source leaves the choice of vocabulary for its Material
field values open.

Some general fields in the 2025 catalog correspond to Dublin Core properties,
including creator, title and description. The catalog exports record those
mappings.
The [publication contracts](https://github.com/metadata-research/matsci-sam/blob/dev/docs/technical/metadata-publication.md)
provide the mapping table and profile representation.

## Dictionary metadata

The **Usage & metadata** page on a term supports two field associations. **Used as a
value for** identifies a field where the concept can supply a value.
**Describes a metadata field** links an explanatory entry to the specification
of that field. Both associations describe a dictionary entry.

A contribution can apply to a whole term or an exact definition revision.
Simple view adds usage notes and field associations for the whole term.
Advanced adds the choice of a definition revision, alternative labels, related
external concepts, and a source name, link, version and language. The draft
remains when you change views.

Contributors submit proposals for site administrator review. A field
specification explains the field, while evidence supplied with a contribution
supports the particular claim about a term. The two sources can differ.
[Term metadata](/docs/term-metadata) explains submission and review.
[Metadata examples](/metadata/examples) show field associations for DFT and
atomic layer deposition.
