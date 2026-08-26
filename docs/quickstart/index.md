# Quick start

MatSci-SAM is a collaborative dictionary for materials science terminology.
The steps below take a new term from contribution to its recorded history.
Each section links to the corresponding page of the user guide.

## Sign in

Select **Login** in the navigation bar. Sign-in uses Google or a verified
email address. You can link an ORCID iD to the account later.
Anyone can read the dictionary without an account. An account is required to
add a definition or example, vote, or comment.

[Account access](/docs/account-access) describes the sign-in methods and linked
ORCID iDs.

## Add a term

Open **Contribute** and fill in the new term and its definition. Name the
broader class first, then what distinguishes the term from its neighbours.
If the term already exists, open its vocabulary page and choose one of the
actions there instead.

Select **Draft with a language model** to generate editable text. Review and
edit the draft before publishing. The published definition is attributed to
you and the named model.

![The New term form with its definition field and optional AI suggestion control](/images/docs/quickstart-contribute.png)

[Adding a term](/docs/adding-terms) covers the contribution actions and the
form in detail.

## Compare the definitions

A term can have several definitions from different contributors. The term page
orders them from highest to lowest score, with the vote arrows to the left of
each card.

![The term page for passivation, with three definitions, vote arrows, status chips, and the model attribution on the model-authored definition](/images/docs/quickstart-term.png)

A definition written by a model names that model and its exact version, so a
reader can tell machine text from human text. The chip beside each definition
reports the net score of the current revision as proposed, community-reviewed,
or stable. Those labels report activity in the pilot community. Scientific
assessment comes from the definitions and their discussion.

[Community review and revisions](/docs/community) explains voting, score, and
status.

## Comment on a definition

Each definition includes a comment thread. The application records every
comment against the revision visible when it was posted.

![A definition page scrolled to its comment thread](/images/docs/quickstart-comments.png)

A comment stores exactly the text you post. It does not alter the definition
or start model work.

## Ask for a revision

On a current definition, select **Suggest a revision**, explain what is wrong
or missing, and prompt the configured language model to draft new wording. The
application sends the term, source definition, and your feedback to the model.
The editable preview appears before anything is published. The same action is
available in the **Discussion** feed and in a study walkthrough.

![The Discussion page, with separate Suggest a revision and Comment controls](/images/docs/quickstart-revise.png)

Publish the reviewed draft to create a separate voteable candidate, linked to
the exact source revision. The source remains available. The new candidate is
credited to you, with the named model as a coauthor. Discarding the draft
publishes nothing. Use the separate **Comment** action when the feedback should
remain discussion only.

[Discussion](/docs/discussion) covers the feed, and [AI-assisted
suggestions](/docs/ai-refinement) covers the two contribution actions that can
prompt a language model for a draft.

## Replace or illustrate a definition

Select **Propose a replacement** when you want to write a different candidate
that should supersede the current definition. The proposal and its target both
remain visible for comparison and voting.

Select **Add example** to contribute a usage example to a particular
definition. A definition can have several examples. Its page shows all of
them, while one featured example represents the definition in compact views.
Adding or featuring an example does not create a definition revision or reset
its votes.

## Follow the record

The application records term creation, definition publication, derivation and
replacement links, AI suggestions that are used, examples, comments, and
votes. The provenance page for a term presents the published history as a
timeline and as a W3C PROV-O graph available for download.

![The provenance graph for passivation, including definitions, examples, AI-assisted activity, comments, and the timeline](/images/docs/quickstart-provenance.png)

Definitions and revisions keep stable addresses, so a citation continues to
resolve to the exact text it referred to.

[Provenance](/docs/provenance) describes the recorded history, and
[Identifiers and citation](/docs/identifiers) describes the address scheme.

## Where to go next

The [User guide](/docs/guide) covers search, tagging, communities and
studies, contributor profiles, and metadata downloads in full. The
[Knowledge organization](/docs/reference) pages describe the model behind
terms, tags, and collections, together with the SKOS and PROV-O vocabularies
used to publish it.
