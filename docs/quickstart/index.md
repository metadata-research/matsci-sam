# Quick start

MatSci-SAM is a collaborative dictionary for materials science terminology.
The steps below take a new term from contribution to its recorded history.
Each section links to the corresponding page of the user guide.

## Sign in

Select **Login** in the navigation bar. Sign-in uses Google or a verified
email address. You can link an ORCID iD to the account later.
Anyone can read the dictionary without an account. An account is required to
add a definition, vote, or comment.

[Account access](/docs/account-access) describes the sign-in methods and linked
ORCID iDs.

## Add a term

Open **Contribute** and fill in the term, a definition, and an example of use.
Name the broader class first, then what distinguishes the term from its
neighbours.

![The Contribute form, showing the workflow choice above the term, definition, and example fields](/images/docs/quickstart-contribute.png)

Choose one of the two AI workflows before publishing. **Publish and compare**
adds your definition and, for a term with no existing definition, requests a
separately attributed model-authored definition alongside it. **Publish, then refine**
adds your definition and offers a refinement control on the definition page.

[Adding a term](/docs/adding-terms) covers both workflows and the form in
detail.

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

A comment on the current revision of a model-authored definition schedules
another term-level generation. The prompt for that generation
includes the comment. The comment box states this before you post.

## Ask for a revision

The **Discussion** page lists the eight most recently added terms. Enter what
should change and select **Suggest revision**. The application sends the
definition, the example, and your feedback to the configured language model,
then returns a preview on the same card.

![The Discussion page, with a feedback box and the Suggest revision and Post comment controls](/images/docs/quickstart-revise.png)

Accept the preview and it publishes another definition for the term, credited
to you with the named model as a coauthor. **Post comment instead** records
your feedback without publishing a definition. Any signed-in contributor can
use this one-step workflow. An author who chose **Publish, then refine** also
has a longer multi-round panel on the current revision of that definition.

[Discussion](/docs/discussion) covers this feed and the revision workflow, and
[AI refinement](/docs/ai-refinement) covers the multi-round panel.

## Follow the record

The application records term creation, definition publication, revisions,
model generation, comments, and votes. The provenance page for a term presents
that history as a timeline and as a W3C PROV-O graph available for download.

![The provenance timeline for passivation, listing term creation and each revision in order](/images/docs/quickstart-provenance.png)

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
