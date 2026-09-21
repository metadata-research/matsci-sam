# Provenance

Open **Provenance** near a term heading to inspect its contribution history
as a graph and timeline. Select a graph node for details or download the
record as W3C PROV-O data.

The record includes definition revisions, comments, vote events, examples,
and published AI-assisted work. Revisions record text, editor, time, change
note, and predecessor. A restored revision also identifies the earlier text
it copies.

**Create a new version** adds the next version to the same definition's history
and preserves its earlier versions. **Suggest an alternative** publishes a
separate definition starting at version 1. It links to the source revision,
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

## References and AI assistance

ChEBI and Wolfram lookup provide reference material. Gemma (or the configured
deployment model) and Wolfram Agent One draft definitions. The Wolfram lookup
and Agent One are separate services with separate evidence records.

Published records distinguish three kinds of source evidence:

- **Cited references** are sources the contributor attached to the published
  revision. They retain the retrieved text and available source, release,
  licence, retrieval time and response identifier.
- **Sources supplied to the model** are the exact reference snapshots included
  in an accepted suggestion's request. Inclusion does not establish which
  facts the model used or whether its answer is correct.
- **Sources reported by the assistant** are links returned in the assistant's
  answer, such as Agent One's Wolfram Sources. They are provider claims, not
  independently verified sources or automatically attached citations.

Accepted AI work preserves the submitted draft, example and references when
included, the stored prompts, the assistant's original final answer, and its
relationship to the contributor's published wording. Edits before publication
do not rewrite the original suggestion. Recorded service and model identities
describe the request and available response metadata; Agent One does not imply
a known underlying language model.

Lookups and unused or discarded suggestions stay private unless their evidence
is attached to a published contribution. Successful Copy and Add to definition
actions can record private interaction timestamps. Those actions do not prove
that the person read, retained or used the text. Revealing a definition alone
does not create a citation or public activity.

The ontology context panel previews terms and their asserted parents in
MatSci-ONT. Opening the panel or switching ontologies does not save a mapping
or assert that the SAM term is equivalent to a matched term.

## Votes, comments, and examples

Votes and comments identify a definition revision. A new version starts a
new vote tally. Vote direction changes and withdrawals append events, so the
record retains their sequence. Study actions also identify the study context.

Examples identify the stable definition and the revision displayed when
added. The featured-example history records who selected an example and the
interval it was featured. Example selection leaves definition text and votes
unchanged.

Timelines include example contributions and the recorded start and end of
featured-example intervals. Unknown historical dates remain unknown rather
than becoming reconstructed events. A change in which definition ranks first
is a computed outcome, not another edit or an approval activity.

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
