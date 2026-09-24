# MatCore and the vocabulary

A vocabulary concept explains an idea. A metadata field specifies information
to record about something. A field value supplies that information for a
particular record.

For example, density functional theory is a concept that can be defined in
MatSci-SAM. Method is a field in a computational dataset description. A
researcher can record density functional theory as the method used for a
particular calculation. The concept, field and calculation record have
different identities.

## MatCore profiles

MatCore describes metadata for computational materials datasets.
[Greenberg et al. (2025)](https://arxiv.org/abs/2502.07106v1) present a Minimal
profile and additional profiles for particular computational methods.
MatSci-SAM includes the Minimal and density functional theory profiles from
the preliminary February 10, 2025 version, `arXiv:2502.07106v1`.

The Minimal profile contains 18 elements, of which 13 are required and five
optional in that source. The DFT profile adds nine elements, of which three
are required and six optional. These requirements apply to the corresponding
dataset descriptions. They do not require a contributor to fill those fields
when defining a vocabulary term.

## MatSci-SAM representation

[MatCore metadata](/metadata/matcore) lists the 27 elements, their source keys
and requirement markers. It also includes a synthetic DFT example.
The [field catalog](/metadata/fields) identifies the source version for each
field specification.

The catalog also lists a separate [experimental proposal](/metadata/experimental)
for processing method and deposition temperature. Those fields are local
proposals for discussing experimental metadata. They are not requirements
adopted by MatCore or ICoN-PCL.

## Vocabulary and Dublin Core

MatSci-SAM recommends its vocabulary as one source of concepts for the MatCore
Material field. This is project guidance. The preliminary MatCore source does
not require that vocabulary for field values.

Some general MatCore fields correspond to Dublin Core properties, including
creator, title and description. The exported metadata records those mappings.
The [publication contracts](https://github.com/metadata-research/matsci-sam/blob/dev/docs/technical/metadata-publication.md)
provide the mapping table and profile representation.

## Dictionary metadata

The **Metadata** page on a term supports two field associations. **Used as a
value for** identifies a field where the concept can supply a value.
**Describes a metadata field** links an explanatory entry to the specification
of that field. Neither action creates a dataset, sample or calculation record.

A contribution can apply to a whole term or an exact definition revision.
Simple view includes usage notes, field associations, source name and source
link. Advanced adds alternative labels, related external concepts, source
version and language. Changing views preserves the draft.

Contributors submit proposals for site administrator review. A field
specification explains the field, while evidence supplied with a contribution
supports the particular claim about a term. The two sources can differ.
[Term metadata](/docs/term-metadata) explains submission and review.
[Metadata examples](/metadata/examples) show field associations for DFT and
atomic layer deposition.
