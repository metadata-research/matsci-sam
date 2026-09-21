# Adding a term

Sign in, complete your name in the profile editor, and open **Contribute**
under **Participate**. Check the destination vocabulary on the form.
**Working in** selects a community vocabulary. **Everything** uses the
default MatSci-SAM vocabulary.

## Confirm, write, review

1. Enter the term and select **Confirm term and find references**. This opens
   the writing step and looks up ChEBI once. Typing does not trigger lookups.
2. Write the definition. Name the broader class, then the characteristics that
   distinguish the concept. An optional **Example of use** sits directly below
   the definition. The model-input panel and action follow; reference tools
   occupy a separate area.
3. Select **Review definition**. Check the definition, model attribution,
   **Citations**, and the optional example. Return to writing to change
   the example.
4. Select **Publish new term**. **Back to writing** returns to the editor
   without publishing.

The form links to the existing term when its label is already defined in the
destination vocabulary. The same label in another vocabulary identifies a
separate concept. **Edit term** returns to confirmation; committing a changed
term clears its reference choices. If a model draft has been applied, the form
first offers to keep that contribution or return to your writing from just
before you accepted the model draft. It does not transfer the model's
attribution to another term.

For model assistance, select **Suggest a definition** beside the editor. Your
editor stays visible and editable while the model works and while you inspect
its preview. You can use the same flow with an empty editor. **Assistant
context** lists included inputs; **Inspect input text** shows their full text.
Your nonblank definition is included by default. **Include in assistant
context** beside the optional example includes it explicitly. Use **Remove**
or **Clear optional context** without deleting your writing, references or
citations. **Include my draft** restores a removed draft input.

Choose an available **Definition assistant** beside the request button. SAM
remembers your preference; study protocols can fix the assistant. An unavailable
assistant explains what is missing. The submitted request keeps its assistant
and input text even if you edit while waiting; switching assistants affects a
later request.

**Use this draft** replaces the text currently in your editor. **Keep my
writing**, or a failed request, leaves your latest writing intact. An applied
draft offers **Undo model draft**, which restores the writing and source
choices from immediately before acceptance. Editing an applied draft keeps
the model credited. To request another draft, explicitly return to that
pre-acceptance writing first. [AI-assisted suggestions](/docs/ai-refinement)
gives the steps.

Publication creates the term and its first numbered definition. An optional
example is stored as a separate contribution linked to revision 1 and credited
to you. If selected as model context, it can help convey the intended meaning;
the model still returns only a definition and never replaces your example.
You can add further examples from the definition page.

## Referencing a ChEBI definition

Confirmation starts a ChEBI lookup; existing-term contribution actions start it
when opened. The compact status beside the active step shows progress and opens
the reference tool. Check that a candidate's meaning fits your term: possible
matches may describe different concepts. The closest candidate initially shows
its name and **Show definition**. Open it to read the definition, entry identity,
release and licence. **Other matches** opens alternative candidates, each with
its own Show definition action. Showing or hiding text changes no citation or
assistant input.

**Add to definition** appends source text, returns to the visible editor and
attaches a citation. Undo restores the previous writing and citation choices.
**Copy** only copies text; SAM does not infer whether you paste or use it.
**Cite without inserting** attaches a citation when you paraphrase or manually
copy a source. **Add to assistant context** supplies that exact entry to a
later model request and shows it in the context list. These are separate actions.

Review shows only attached **Citations**. Use **Remove citation** for a source
you did not retain in the final text. **Add a citation** opens a shortlist of
references you have already opened, with a direct **Cite** action. Retrieved
but unopened ChEBI definitions are not added to this shortlist. If more sources
become available while the shortlist is open, **Review newly opened sources**
updates it deliberately. You may publish with no citations attached.

Published citations retain the original reference text separately from your
definition and identify sources you declared using. Earlier citations stay
with their original revision; choose the sources used when publishing a new
version of your definition. A failed or empty lookup leaves you free to write
your definition. Reference tools also support replacements, new versions and
suggested alternatives.

## Wolfram resources and model inputs

Open **Wolfram lookup**, then select **Retrieve Wolfram resources** for facts
and interpretations from Wolfram|Alpha. The default uses the confirmed term,
automatic interpretation and metric units. You may change the preferred units
or enter optional research context. **Query to send** shows the text before
retrieval. Your definition is not sent to Wolfram.

Check **Interpreted as** and the assumptions before using a result. Headings
and property tables make the response easier to read; **Original response**
shows the complete source text. **Copy section** includes the interpretation
and assumptions with the selected section, so its conditions stay with it.
Results are stored for the prototype while long-term terms are under discussion.

Use **Refine lookup** to change the context or units and retrieve a new result.
When Wolfram offers alternative interpretations, you can select one while
refining the same query. Changing the query clears that interpretation choice.
Canceling refinement or a failed request preserves the previous result. Up to
five Wolfram lookups remain available under **Saved Wolfram lookup** for the
confirmed term; switching or refining keeps earlier source selections.

ChEBI and Wolfram work independently. The tools share one side area on wide
screens. On narrow screens, opening a tool switches to its own view with a
return control. Closing a tool preserves its query and results. Wolfram uses
the same actions as ChEBI: Add inserts text and attaches a citation, Copy only
copies, and Add to assistant context includes the full response in a later
request. Each complete response remains the reference for citation and model
input, including when you copied only a section. A result enters the review
shortlist only when displayed; a lookup finishing in a closed view does not
mark it as consulted.

While a new-term model suggestion is loading or being compared, the writing
area shows your editor and the suggestion together: side by side on wide
screens, stacked on narrow screens. Reference tools are unavailable until you
accept or dismiss the suggestion; their queries, results and selections are
preserved.

For **New term** and **Suggest an alternative**, open a reference and select
**Add to assistant context** to include it. No reference is included by default.
The compact context list supports removal without changing citations or saved
receipts. A request can include up to six sources and 24,000 source-text
characters; the adding action explains when a limit is reached. The term is
always required; alternative requests also require their source definition and
critique.

**Context for this request** preserves the submitted text and assistant through
preview and review. The record shows what was sent, not which facts the
assistant used or whether its answer is correct. Discarding a draft does not
publish its inputs. The factual Wolfram lookup remains available independently
of the definition assistant you choose.

<a id="the-five-contribution-actions"></a>

## The contribution actions

| Action | Result |
| --- | --- |
| New term | A term and its first definition, with optional model drafting |
| Create a new version | The next version of your own definition, keeping its identifier and previous versions |
| Suggest an alternative | A separate definition starting at version 1, drafted by a model from your critique and linked to its source |
| Propose a replacement | A candidate you write, linked to the definition it should supersede |
| Comment | Discussion text attached to the displayed revision |
| Add example | A separately attributed example of use |

**New term** starts on Contribute. The other actions start from a current
definition. A suggested alternative or replacement leaves the original available
for comparison and voting. Comments and examples leave the definition text
unchanged. Only **New term** and **Suggest an alternative** provide model drafting.
Existing-term actions inherit their term and source context rather than asking
you to enter another term.

A study also has **Propose a new definition** for an existing term. It records
your Position without a replacement target. See
[Study and vocabulary workflows](/docs/studies#study-and-vocabulary-workflows).

The primary author can select **Create a new version**, edit their definition,
then select **Review new version** and **Publish new version**. Publication
keeps the same definition identifier and preserves earlier versions in its
history. [Community review and revisions](/docs/community) explains that action,
voting, and examples.
