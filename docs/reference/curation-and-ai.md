# Curation and AI

The vocabulary is built by people and, in bounded ways, by language models.
This page states who may do what, how the meaning of a tag is protected as the
vocabulary evolves, and the place of a model in the process. Parts of the
model workflow are designed and not yet built, and those are marked.

## Who may assert what

A contributor writes definitions and examples of use. A contributor creates
topics and attaches them to definitions they wrote. A contributor who created
a topic may also declare that topic the same concept as a term.

A curator assigns facets to terms, declares a tag the same concept as a term
where the scheme allows it, edits the definition, scope note and alternative
labels of a tag, and merges one tag into another. A scheme says for itself
whether its concepts may be bridged, which is a claim about what the concepts
are, so it binds a curator as much as a contributor. In this implementation a
curator is an administrator.

Collections are governed separately. A collection states who may change its
membership, so a curator-owned collection accepts curator changes only and a
contributor-owned one accepts anybody signed in. Whether a contributor may
create a collection at all is a deployment setting, off by default.

A term is not owned. Nobody has standing to classify a term with an open
topic, which is why topics attach to definitions and facets are the only
term-level classification. The one term-level statement a contributor may
make is the link between a topic they created and a term, and a curator can
retract it.

Every assertion made through the application records who made it and when. A
withdrawn assertion is retracted rather than deleted, and the retraction
records who withdrew it and when. Statements carried over from the tagging
tables that preceded the ledger are marked as migrated, and some of them name
no asserter, because the earlier tables recorded none.

## Tags stay cheap

A tag never needs a term. A bare label is a legitimate resting state. A tag
that needs explaining gets a scope note. A tag that is the same concept as a
term is linked to it. Most tags stay at the first level by design, because
classification that costs too much does not get done.

## Protecting meaning over time

A tag is a stable identifier for a meaning that moves. Statements filed under
a tag in one year and in the next may mean different things, and nothing in
the tag itself records that. Three rules hold against it.

A label or a scope note is edited only to correct it. A tag whose meaning has
genuinely changed is retired and replaced. The old tag keeps its identifier
and points at the new one, statements already filed under the old tag keep
meaning what they meant, and new statements attach to the new tag. The
merge operation implements the case where one tag is absorbed into another,
which moves the statements across. Retiring a tag and leaving its statements
in place is policy that no operation performs yet.

A tag linked to a term is never pinned to one revision of the term. The link
is to the term, and a curator can retract it if the definitions of the term
move somewhere the curator did not intend.

Drift is measured rather than discovered late. Each revision records the size
of its own change, so a report for curators lists the linked tags whose terms
were substantially rewritten after things were filed under them. The report
points, and a curator decides.

## Language models

A model that contributes is an author. It appears under a name such as
MatBot Gemma 4, the name opens its profile, and the profile gives the exact
version it runs under, its publisher, what it has contributed, and the
prompts it worked from. One profile covers one version, because two versions
of one family produce different text and a definition can only be traced to
the version that wrote it. "MatBot" marks the author as a machine, so the
interface does not repeat the fact beside it.

A model generates and returns. A person decides. In the interactive
refinement workflow the author asks for a suggestion, the model returns one,
and the author accepts it, keeps the original, or asks again. An accepted
suggestion is attributed to the author and the named model together. A
term-level automatic definition is generated for a term that has none,
attributed to the model alone, and stands beside the human definitions to be
voted on like any other. A comment on such a definition schedules another
generation, so the model can revise its own entry in the light of discussion.

Output from a model is stored before anyone acts on it, together with the
model name and the exact prompt that produced it. That record is what makes
the attribution trustworthy, because a browser cannot claim that a model
wrote text it did not.

## Tag proposals and review

This workflow is designed. The storage for it exists in the database, and no
part of the application writes to it or reads from it yet. The paragraphs
below describe the intended process, not the present one.

A proposed tag is stored before anyone decides on it. A model reads it
against the existing tags and returns a verdict, approve, merge into a named
tag, or decline, with reasons, its name and the prompt it ran under. A
curator acts on the proposal with one click. Review and decision are separate
facts, so a curator may decide without a review and a review may sit
undecided, and the agreement between the two is a measurement the system
keeps from the first proposal.

A curator may later enable delegated approval for the narrow class of
proposals where model verdicts and curator decisions have agreed. A delegated
approval is attributed to the identity of the model, which for this purpose
holds the moderator role, and every other proposal still waits for a person.
The setting ships off and is turned on from evidence in the agreement record
rather than in advance. Judgements made by a person, suggested by a model,
and delegated to a model are separable in the data without reconstruction,
because each one names its asserter.
