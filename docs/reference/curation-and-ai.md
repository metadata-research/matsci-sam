# Curation and AI

The vocabulary is built by people and, in bounded ways, by language models.
This page states who may do what, how the meaning of a tag is protected as the
vocabulary evolves, how a community settles a list of terms in a study, and
the place of a model in the process. Parts of the
model workflow are designed and not yet built, and those are marked.

## Who may assert what

A contributor writes definitions and examples of use. A contributor creates
topics and attaches them to definitions they wrote. A contributor who created
a topic may also declare that topic the same concept as a term.

A curator assigns facets to terms, declares a tag the same concept as a term
where the scheme allows it, edits the definition, scope note and alternative
labels of a tag, and merges one tag into another. A scheme says for itself
whether its concepts may be bridged, and that restriction binds a curator as
much as a contributor. In this implementation a curator is an administrator.

Collections are governed separately. A collection states who may change its
membership, so a curator-owned collection accepts curator changes only and a
contributor-owned one accepts anybody signed in. Whether a contributor may
create a collection at all is a deployment setting, off by default.

A term is not owned. Topics attach to definitions, and facets are the only
term-level classification. The one term-level statement a contributor may
make is the link between a topic they created and a term, and a curator can
retract it.

Every assertion made through the application records who made it and when. A
withdrawn assertion is retracted rather than deleted, and the retraction
records who withdrew it and when. Statements carried over from the tagging
tables that preceded the ledger are marked as migrated, and some of them name
no asserter, because the earlier tables recorded none.

## What a tag requires

A tag never needs a term. A tag that needs explaining gets a scope note. A
tag that is the same concept as a term is linked to it. Most tags stay at
the first level, a label with no scope note and no linked term.

## Protecting meaning over time

A tag is a stable identifier for a meaning that moves. Three rules keep what
is filed under a tag readable as the vocabulary ages.

A label or a scope note is edited only to correct it. A tag whose meaning
has genuinely changed is retired and replaced. The old tag keeps its
identifier and points at the new one, statements already filed under the old
tag keep meaning what they meant, and new statements attach to the new tag.
The merge operation implements the case where one tag is absorbed into
another, which moves the statements across. No operation retires a tag and
leaves its statements in place.

A tag linked to a term is never pinned to one revision of the term. The link
is to the term, and a curator can retract it if the definitions of the term
move somewhere the curator did not intend.

Drift is measured. Each revision records the size of its own change, so a
report for curators lists the linked tags whose terms were substantially
rewritten after things were filed under them.

## Language models

A model that contributes is credited by name. It appears under a name such
as MatBot Gemma 4, the name opens its profile, and the profile gives the
exact version it runs under, its publisher, what it has contributed, and the
prompts it worked from. One profile covers one version, so the profile named
on a definition is the version that generated it. "MatBot" in the name marks
the author as a machine.

A model generates and returns. A person decides. In the interactive
refinement workflow the author asks for a suggestion, the model returns one,
and the author accepts it, keeps the original, or asks again. An accepted
suggestion is attributed to the author and the named model together. A
term-level automatic definition is generated for a term that has none,
attributed to the model alone, and stands beside the human definitions to be
voted on like any other. A comment on such a definition schedules another
generation, so the model can revise its own entry in the light of discussion.

Output from a model is stored before anyone acts on it, together with the
model name and the exact prompt that produced it.

## Studies and agreement

A community can run a study over a collection of terms, and a study can ask
its members to walk the terms in order. The protocol of the pilot settles a
draft list. Each term has a draft, the definition a model generated in an
earlier round, with the comments that round left on it, and a participant
takes one position per term. To accept a candidate is to upvote it. An
amendment is a definition of the participant's own whose first revision
records the revision it started from, and a replacement is one with no such
derivation. Each position is an ordinary act of the vocabulary, a vote or a
definition, that also names the step it was taken for. The walkthrough
adds no assertion of its own beyond the completion of each step and the
answers to its closing questions.

Agreement is a reading of the record, not an assertion in it. For each term
the definition with the most support, the upvotes less the downvotes on its
current revision, is the agreed definition of the group so far, and a tie goes
to the earlier candidate. Nobody declares a definition agreed, and the reading
changes as positions are taken. The outcome of a closed study is computed
from the voting acts as they stood when it closed, over the terms and the
candidates as they stand.

A person belongs to a community for an episode, from the day they were added
to the day they were removed, and may act in a study while that episode is
live and the study is open. The acts that name a study are therefore those
of people who were members during its window. The community, its roster and
its invitations are not published. The study is published as an activity,
with its window and the collection it worked through.

A simulated participant is an account a model is driven under, and its
display name says so. The text it generates, a definition, a comment or an
answer, is stamped with the model and the prompt it came from, as model
output is. Its votes, comments and answers name their actor as simulated,
and a definition it publishes is attributed to the account. The acts of
people, of models writing under their own names, and of simulated
participants are separable in the data without reconstruction.

## Tag proposals and review

This workflow is designed. The storage for it exists in the database, and no
part of the application writes to it or reads from it yet.

A proposed tag is stored before anyone decides on it. A model compares it
against the existing tags and returns a verdict, approve, merge into a named
tag, or decline, with reasons, its name and the prompt it ran under. A
curator acts on the proposal with one click. Review and decision are
separate facts, so a curator may decide without a review and a review may
sit undecided, and the agreement between the two is a measurement the system
keeps from the first proposal.

A curator may later enable delegated approval for the narrow class of
proposals where model verdicts and curator decisions have agreed. A
delegated approval is attributed to the identity of the model, which for
this purpose holds the moderator role, and every other proposal still waits
for a person. The setting ships off, and a curator turns it on from the
agreement record. Each judgement names its asserter.
