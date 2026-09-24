# The provenance model

Provenance records who contributed information, what they used and how a
published definition changed. Each term has a history across its definitions
and revisions. Open **Advanced**, then **Provenance**, to inspect that record.
[Provenance](/docs/provenance) explains the graph and timeline controls.

## What the record contains

A revision preserves the text of one definition version. Its history identifies
the preceding version and, where applicable, a separate source used for a
restoration or derived alternative. A proposed replacement identifies the
definition it is intended to supersede. The earlier contribution remains.

Publication records the contributor. An accepted assistant suggestion also
identifies its original answer and recorded model or service. Later edits
retain their own text and attribution without implying another model request.

Examples are independent contributions linked to the definition and exact
revision displayed when they were added. Selecting a featured example changes
compact display without changing definition text or votes. Files selected for
publication retain their example or source role and exact revision association.

Imported records identify gaps in their history. Earlier examples may lack an
independent author, exact source revision or publication time. Some imported
comments and votes have an inferred revision association. Missing facts are
not reconstructed as observed events.

## Reference and assistant evidence

A citation records a contributor's declared source for a definition revision.
An assistant input records material supplied with an accepted request.
A source link returned in an assistant answer belongs to that answer and does
not automatically become either a contributor citation or an assistant input.

Published evidence retains the available source identity, retrieved text and
version details. The original assistant answer remains separate from the
wording published by the contributor. A citation or input record does not
establish that every claim in the definition was verified.

Ontology previews show external labels and hierarchy without saving a
relationship. **Related external concept** metadata is an explicit contribution
with its own scope, attribution and optional source. It does not assert
equivalence or class membership. See [References](/docs/references) and
[Term metadata](/docs/term-metadata).

## People and models

Authors, editors, commenters and assertion authors remain attributed even when
their profiles are private. Models have distinct attribution.
The per-term view labels votes "A community member" and omits voter identity.
The dataset graph identifies a voter only for a public profile or AI account.

Private lookup history, raw provider envelopes, credentials and private
configuration records are excluded from public provenance. Published prompts
and source evidence can be part of the contribution history.

## Assertions, vote events and studies

An accepted metadata contribution retains its author, scope, source and review
history. Withdrawal removes its current fact while preserving that history.
Unreviewed and declined proposals are excluded from public RDF. Only site
administrators accept or decline metadata proposals.

Vote changes and withdrawals record events. Backfilled votes identify their
historical limitations. Study activities identify their study and step,
while membership rosters and invitations remain private.

## The two views

Vocabulary exports describe current meaning and classification. Provenance
exports describe contribution history, including accepted metadata that was
later withdrawn. Metadata about an exact revision stays with that revision
when a new version is published.

[The publication contracts](https://github.com/metadata-research/matsci-sam/blob/dev/docs/technical/metadata-publication.md)
document RDF mappings, source snapshots, legacy records and privacy rules.
