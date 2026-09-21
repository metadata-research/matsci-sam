# AI-assisted suggestions

MatSci-SAM provides model drafts within **New term** and **Suggest an alternative**.
A response is a preview until you choose to apply it. You review and edit the
text before publication. The published record identifies the contributor and
model behind an applied draft.

## Suggest a definition for a new term

1. Open **Contribute**, enter the term and check the destination vocabulary.
   Select **Confirm term and find references** to open the writing step.
2. Write a definition or leave the editor empty to request help starting.
   You may add an **Example of use** directly below it. **Assistant context**
   lists included items; your nonblank draft is included by default. Use
   **Include in assistant context** beside the example when it will help.
   **Remove** or **Clear optional context** omits inputs without deleting text
   or citations; **Include my draft** restores a removed draft input.
   Choose an available **Definition assistant**, then select **Suggest a
   definition**. Keep writing while the request runs if you wish.
3. Inspect the preview alongside your still-editable definition. On narrow
   screens, the two are stacked. The response leaves your current text in
   place. **Use this draft** replaces that current text with the model's text.
   **Keep my writing** discards the preview and preserves your latest text.
4. Edit the applied draft if needed, then select **Review definition**. Check
   the model attribution, sources and optional example.
5. Select **Publish new term** when ready.

An empty editor stays visible through the same steps. You can start writing
while the model works; a failed request leaves that writing intact. The model
request keeps its original input even if you edit before the response arrives.
**Context for this request** shows that unchanged snapshot and assistant. The term remains
required even when you clear all optional inputs.
Reference tools are unavailable during comparison and retain their state for
when you return to them.

Applying a draft offers **Undo model draft**, which restores the text, source
choices and attribution from immediately before acceptance, including edits
made while waiting or reviewing the preview. An applied model remains
credited when you edit its wording.

To request a fresh draft, select **Rework from my earlier writing** and confirm
**Return to my earlier writing**. This removes the applied draft and your edits
to it, and restores the writing from immediately before you accepted it. You
can instead choose **Keep this contribution**. The same choice protects model
attribution when you edit the confirmed term.

A published model draft credits you and the named model. An optional example
you write receives separate attribution. Selecting the example as context lets
the model consider your intended usage; it does not give the model control of
that example. Applying, undoing or discarding a definition suggestion leaves
your example intact. The model generates definition text only.

## Assistant choice and context

**Definition assistant** offers the deployment assistant, such as Gemma, and
Wolfram Agent One when an administrator has configured, validated and enabled
it. SAM remembers your preference for later requests. The choice is fixed
while a request runs and stays attached to its response and provenance.
Unavailable choices explain their status; SAM never silently substitutes
another provider. Study requests use the assistant fixed by their protocol.
API keys are managed by the server, not entered into contribution forms.

Agent One's final answer appears directly as an editable suggestion, including
any source links it returns. Review the answer before using it. Those links
are part of the model output; they do not automatically become attached source
citations. Internal reasoning and tool data are excluded from the draft.

To try another assistant, keep your writing and dismiss the unused preview,
then choose again. After applying a draft, use Undo or Rework before requesting
another. Changing a preference does not change an earlier draft's attribution.

Confirming a term looks up ChEBI candidates. **Show definition** reveals a
candidate without adding a citation or assistant input. On a displayed ChEBI
or Wolfram entry, **Add to assistant context** includes the exact stored source
in the next request. Wolfram lookup remains an independent factual-reference
tool with either definition assistant.

**Assistant context** shows compact labels for included items. **Inspect input
text** expands their read-only text. Remove individual optional inputs or clear
them together without erasing writing, saved receipts or citations. Up to six
sources and 24,000 source-text characters may be included. A request records
its selected sources and contributor input at submission; later edits, lookups
or context changes cannot alter it.

Publication review lists only attached **Citations**, independently of model
inputs. Both ChEBI and Wolfram **Add to definition** attach a citation after
successful insertion. **Remove citation** undoes that declaration without
changing the writing; insertion Undo restores the previous writing and choices.
Viewing and Copy attach nothing. Use **Cite without inserting** on a source,
or **Add a citation** during review to cite a previously opened source.
Adding source text never adds it to assistant context automatically.

Applying a model draft replaces your writing and clears its citation choices;
Undo restores both. Inspect the proposed definition even when references were
supplied: the record establishes what was sent, not which facts the model
relied on or whether its answer is correct. [Adding a term](/docs/adding-terms)
explains the reference tools.

<a id="suggest-a-revision-to-a-definition"></a>

## Suggest an alternative to a definition

Open a current definition and select **Suggest an alternative**. The action is
also available in **Discussion** and study Position steps. The term and source
revision are fixed by that action.

1. Describe the error, ambiguity, or missing distinction in **What should
   change?** **Assistant context** shows the required term,
   source definition, your feedback and any selected reference inputs.
   You can remove optional sources here. **Clear feedback** beside the feedback
   editor erases your critique; enter new feedback before requesting a draft.
2. Select **Draft alternative with a language model**. The request includes the
   term, source revision, your critique and selected reference entries.
   **Context for this request** retains the submitted snapshot and assistant through review.
3. Inspect the preview and its model attribution. Select **Use this draft**
   to open an editable alternative, or **Keep my feedback** to discard the
   preview while retaining your critique.
4. Edit the applied text and select **Review alternative**. Review the exact
   model inputs and your attached citations.
5. Select **Publish alternative**. **Back to writing** returns to the editor.

**Undo model draft** returns an applied alternative to its preview. **Discard
draft** leaves the original definition unchanged and publishes nothing.

Publication creates a separate definition starting at version 1, credited to
you and the model. The original remains available. The record links the new
definition to its exact source revision, critique, prompt, and stored model
output. Request a new draft if the source revision changes before publication.

In a study, begin with **Suggest an alternative**. Publication also records
your Position and completes the step without casting a vote. ID4 round two
then advances to the next unfinished step. Studies with a separate Review
round allow votes and comments there. See
[the Position step](/docs/studies#the-position-step).

## Keep the actions distinct

**Suggest an alternative** leads to **Review alternative** and
**Publish alternative**. It creates a separate definition starting at version 1, linked
to the source definition.

**Create a new version** on your own definition leads to **Review new version**
and **Publish new version**. It keeps the same definition identifier and adds
the next version to its history. Previous versions remain available.

Use **Comment** for discussion, **Propose a replacement** for a candidate you
write to supersede another, and **Add example** for an example of use. These
actions do not request model output. A study proposal is an independent
definition for the current term.

[Community review and revisions](/docs/community#editing-and-proposing-definitions)
explains editing. [Provenance](/docs/provenance) describes the published record.
