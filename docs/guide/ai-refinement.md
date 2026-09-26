# AI-assisted suggestions

Request a model draft while adding a term or suggesting an alternative to an
existing definition. Inspect and edit the response before publication. An
applied draft retains model attribution when you change its wording.

## Suggest a definition for a new term

1. Open **Contribute**, check the destination vocabulary, enter the term, and
   select **Confirm term**, labelled **Confirm term and find references** in
   Advanced.
2. Write a definition or leave the editor empty. Select **Help me write** in
   Simple view or **AI assistance** in Advanced.
3. Select **Suggest a definition**. Simple names the assistant and the inputs
   the request sends. In Advanced, check **Assistant context** and choose an
   available **Definition assistant** first. You can continue writing while it
   runs.
4. Inspect the preview. **Use this draft** replaces your current definition
   text. **Keep my writing** dismisses the preview and preserves your latest
   text.
5. Edit the applied draft, select **Review definition**, and check attribution,
   citations, and any example or files. Select **Publish new term** when ready.

A failed request leaves your writing intact. In Advanced, **Context for this
request** shows what was submitted, even if you edited the form while waiting. Accept or dismiss
an unused preview before switching tools. Reference results and selections
remain available afterward.

**Undo model draft** restores the writing, citation choices, and attribution
from immediately before you applied the draft. To request another draft after
editing an applied one, select **Rework from my earlier writing**, then
**Return to my earlier writing**. This removes the applied text and edits to it.
**Keep this contribution** cancels that change.

An example you write is a separate contribution credited to you. Model requests
produce definition text. Applying or undoing a definition draft preserves the
example.

## Assistant choice and context

Advanced shows the assistant and context controls. Simple names the assistant
and the inputs a request sends, including any chosen in Advanced. **Definition assistant** lists the
configured assistants, including Wolfram Agent One when enabled. Unavailable choices show their status. SAM saves
your preference for later requests. A study may specify its own assistant.
The assistant selected for a submitted request stays attached to its response
and published attribution.

**Use my definition draft** includes your writing and is selected by default.
**Use my example** includes the optional example when selected. **Assistant
context** lists the included items. **Inspect input text** shows their full
text. **Remove** and **Clear optional context** omit inputs without erasing your
writing or citations. The term remains required.

Select **Add to assistant context** on an opened ChEBI or Wolfram source to
include it in the next request. Sources are not included by default. Removing
an input leaves any attached citation unchanged. See
[References](/docs/references#citations-and-assistant-inputs).

Applying a model draft clears the citation choices attached to your previous
writing. Review and attach the sources used in the final text. Undo restores
the earlier choices. Source links returned by an assistant remain part of its
answer and do not automatically become your citations.

The recorded inputs show what was sent to the assistant. Check the facts and
source material before publication. Wolfram lookup remains available as a
separate reference tool whichever definition assistant you choose.

<a id="suggest-a-revision-to-a-definition"></a>

## Suggest an alternative to a definition

Open a current definition or study Position step and select **Suggest an
alternative**. In Discussion, select **Start an alternative** under the
**Suggest an alternative** heading. The term and source revision are already
selected.

1. Explain the error, ambiguity, or missing distinction in **What should
   change?** Check the required source definition and your feedback in
   **Assistant context**, along with any optional sources.
2. Select **Draft alternative with a language model**. Inspect the preview and
   its attribution. **Keep my feedback** dismisses it while retaining your
   critique.
3. Select **Use this draft**, edit the alternative, and select **Review
   alternative**. Check the wording, inputs, and citations.
4. Select **Publish alternative**. **Back to writing** returns to the editor.

Publication creates a separate definition starting at version 1, credited to
you and the model and linked to the exact source revision. The original stays
available. Request another draft if that source revision changes before
publication. **Undo model draft** returns the alternative to its preview.
**Discard draft** publishes nothing.

A study alternative also records your Position and completes the step without
casting a vote. Follow the [study instructions](/docs/studies#the-position-step)
for comments and later review.

## Keep the actions distinct

**Create a new version** updates your own definition while preserving its
identifier and earlier revisions. **Suggest an alternative** creates a separate
candidate. Comments, replacements you write, and examples have their own
[contribution actions](/docs/community#editing-and-proposing-definitions).
