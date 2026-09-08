# Provenance

Open **Provenance** near a term heading to inspect its contribution history
as a graph and timeline. Select a graph node for details or download the
record as W3C PROV-O data.

The record includes definition revisions, comments, vote events, examples,
and published AI-assisted work. Revisions record text, editor, time, change
note, and predecessor. A restored revision also identifies the earlier text
it copies.

A published **Suggest a revision** candidate links to the source revision,
contributor critique, stored model output, prompt, and model. A replacement
identifies the definition it should supersede. Discarded model drafts remain
outside the published vocabulary.

## People and models

Definitions and examples are entities, publication events are activities,
and people and models are agents. The record attributes contributions to
their authors. The per-term view labels votes "A community member". The
[dataset graph uses a separate voter-visibility rule](/docs/reference/provenance-model#people-and-models).

A model profile identifies the recorded runtime tag, publisher, directly
authored definitions, and their prompts. Coauthored definitions credit the
contributor and model on the definition page. A tag identifies the model
configuration requested for a run.

![A model profile with recorded authorship](/images/docs/model-profile.png)

## Votes, comments, and examples

Votes and comments identify a definition revision. An author edit starts a
new vote tally. Vote direction changes and withdrawals append events, so the
record retains their sequence. Study actions also identify the study context.

Examples identify the stable definition and the revision displayed when
added. The featured-example history records who selected an example and the
interval it was featured. Example selection leaves definition text and votes
unchanged.

## Imported records

Some pilot records lack facts that the earlier schema did not store.

| Record                         | Limitation                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Partial revision               | Editor or change note may be unknown                                                                     |
| Legacy example                 | Independent author, exact source revision, contribution time, and selection provenance were not recorded |
| Imported comment or refinement | Revision association is inferred from the recorded time                                                  |
| Imported vote                  | Revision association uses the revision current at migration                                              |
| Backfilled vote event          | One event reconstructs a standing vote when event recording began                                        |

The interface labels imported records and leaves unknown provenance empty.
A backfilled event does not reconstruct all earlier vote changes.

[The provenance model](/docs/reference/provenance-model) describes the RDF
properties and privacy rules. [Metadata access](/docs/metadata-access) lists
downloads. [Community review and revisions](/docs/community) explains editing
and restoration.
