# Quick start

MatSci-SAM is a collaborative dictionary for materials science terminology.
This page follows the ordinary path from a new term through to its recorded
history. Each step links to the guide page that covers it in full.

## Sign in

Select **Login** in the navigation bar. Sign-in uses Google or a verified email
address, and an ORCID iD can be linked to the account afterwards. Reading the
dictionary requires no account. Adding a definition, voting, and commenting
each require one.

[Account access](/docs/account-access) describes the sign-in methods and linked
ORCID iDs.

## Add a term

Open **Contribute** and fill in the term, a definition, and an example of use.
Name the class of thing first, then what distinguishes it from its neighbours.

![The Contribute form, showing the workflow choice above the term, definition, and example fields](/images/docs/quickstart-contribute.png)

Choose one of the two AI workflows before publishing. **Publish and compare**
adds your definition and, for a term nobody has defined before, requests a
separately attributed model definition alongside it. **Publish, then refine**
adds your definition on its own and offers a refinement control on the
definition page.

[Adding a term](/docs/adding-terms) covers both workflows and the form in
detail.

## Compare the definitions

A term can have several definitions from different contributors. The term page
orders them from highest to lowest score, with the vote arrows to the left of
each card.

![The term page for passivation, with three definitions, vote arrows, status chips, and the model attribution on the AI definition](/images/docs/quickstart-term.png)

A definition written by a model names that model and its exact version, so a
reader can tell machine text from human text. The chip beside each definition
reports the net score of the current revision as proposed, community-reviewed,
or stable. Those labels report activity in the pilot community. They do not
certify scientific correctness.

[Community review and revisions](/docs/community) explains voting, score, and
status.

## Comment on a definition

Each definition has its own comment thread. Every comment records the revision
that was visible when it was posted, which preserves the context a later edit
would otherwise remove.

![A definition page scrolled to its comment thread](/images/docs/quickstart-comments.png)

A comment on the current revision of a model-written definition also joins the
term-level model context, and the application requests an updated definition in
the background. The comment box states this before you post.

## Ask for a revision

The **Discussion** page lists the eight most recently added terms. Enter what
should change and select **Suggest revision**. The application sends the
definition, the example, and your feedback to the locally hosted model, then
returns a preview on the same card.

![The Discussion page, with a feedback box and the Suggest revision and Post comment controls](/images/docs/quickstart-revise.png)

Accepting the preview publishes another definition for the term, credited to
you with the named model as a coauthor. **Post comment instead** records your
feedback without publishing a definition. Any signed-in contributor can use
this one-step workflow. The author of a definition also has a longer
multi-round panel, described in [AI refinement](/docs/ai-refinement).

## Follow the record

Each writing, edit, model generation, comment, and vote is recorded. The
provenance page for a term presents that history as a timeline and as a W3C
PROV-O graph available for download.

![The provenance timeline for passivation, listing term creation and each revision in order](/images/docs/quickstart-provenance.png)

Definitions and revisions keep stable addresses, so a citation continues to
resolve to the exact text it referred to.

[Provenance](/docs/provenance) describes the recorded history, and
[Identifiers and citation](/docs/identifiers) describes the address scheme.

## Where to go next

The [User guide](/docs/guide) documents every feature, including search,
tagging, contributor profiles, and metadata downloads. The
[Knowledge organization](/docs/reference) pages describe the model behind
terms, tags, and collections, together with the SKOS and PROV-O vocabularies
used to publish it.
