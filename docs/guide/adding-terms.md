# Adding a term

Sign in, complete your name in the profile editor, and open **Contribute**
under **Participate**. Check the destination vocabulary on the form.
**Working in** selects a community vocabulary. **Everything** uses the
default MatSci-SAM vocabulary.

## Confirm, write, review

1. Enter the term and select **Confirm term and find references**. This opens
   the writing step and looks up ChEBI once. Typing does not trigger lookups.
2. Write the definition. Name the broader class, then the characteristics that
   distinguish the concept. Select **Add example** to describe a use of the term.
   **Add citation**, **Attach file**, and **Help me write** open tools below the
   form when you need them.
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

## Simple and Advanced views

**Simple** opens with the writing form and a few optional actions. **Advanced**
adds ChEBI matches, matches across available ontologies, and the selected term's
hierarchy to the right of the form. These panels stay visible together; on
small screens they stack below the main column. Switching views preserves your
writing, source choices, and tool settings, and keeps the form the same width.
Viewing an ontology match does not assert that your term means the same thing.

Advanced also shows a toolbar directly below the form: **Wolfram lookup**,
**AI assistance**, **Add citation**, and **Attach file**. A selected tool opens
inside the same panel. Simple's optional actions open that tool without showing
the whole toolbar.

## Writing with assistance

For model assistance, select **Help me write** in Simple or **AI assistance**
in Advanced, then **Suggest a definition**. Your editor stays visible and
editable while the model works and while you inspect its preview below the
form. You can use the same flow with an empty editor. **Assistant context**
lists included inputs; **Inspect input text** shows their full text. Your
nonblank definition is included by default. **Use my definition draft** and
**Use my example** control optional writing inputs. Use **Remove** or
**Clear optional context** without deleting your writing, references or
citations. The checkboxes let you include those inputs again.

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
when opened. In Add, select **Advanced** to see the matches. The closest ChEBI
candidate opens with its definition, entry identity, release and licence.
Check that its meaning fits your term: possible matches may describe different
concepts. **Other matches** opens alternative candidates, each with its own
**Show definition** action. Existing-term contribution forms retain their
compact reference status and manual reveal. Showing or hiding text changes no
citation or assistant input.

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

Check **Interpreted as** and the assumptions before using a result. The
**Overview** shows identity and basic properties, or the principal result for
other queries. **More properties** lets you expand additional sections.
Formulas and units use readable notation, and tables retain measurement
conditions and qualifications. **Change interpretation** opens the available
alternatives without starting another lookup until you request it.

**Open in Wolfram|Alpha** opens the saved query on Wolfram's live website,
including its query options. Use it for diagrams, plots and fuller exploration;
the website may change independently of the response saved in SAM.
**Original response** retains the complete unmodified text and offers
**Copy original response**.

Each useful section has **Copy section** and **Add to definition**. Both keep
the interpretation, actual assumptions and local conditions with the selected
section. Adding attaches a citation to the complete saved response and provides
Undo. Copying alone does not attach a citation. Diagram URLs, provider code and
interpretation-option instructions stay out of section insertions.
Results are stored for the prototype while long-term terms are under discussion.

Use **Refine lookup** to change the context or units and retrieve a new result.
When Wolfram offers alternative interpretations, you can select one while
refining the same query. Changing the query clears that interpretation choice.
Canceling refinement or a failed request preserves the previous result. Up to
five Wolfram lookups remain available under **Saved Wolfram lookup** for the
confirmed term; switching or refining keeps earlier source selections.

ChEBI and Wolfram work independently. In Add, ChEBI stays in the right column
of Advanced while Wolfram opens below the form. Closing a tool preserves its
query and results. Existing-term contribution forms retain their separate
reference workspace and return control on small screens. Wolfram's
**Add to assistant context** includes the full original response in a later
request. Each complete response remains the reference for citation and model
input, including when you copied or added only a section. A result enters the review
shortlist only when displayed; a lookup finishing in a closed view does not
mark it as consulted.

While a new-term model suggestion is loading or being compared, its panel
remains open below the editor in both views. Accept or dismiss the suggestion
before switching tools. Reference queries, results and selections are preserved.

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


## Attach a file

In Add, **Attach file** accepts a PDF, PNG, or JPEG up to 5 MB. You can attach
three files to one contribution. Give each a title and explain how it relates
to the term. Choose **Example** when it illustrates the meaning, or **Source**
when it supports your definition. A source can also include a citation and page
or section reference.

Files remain private while you write. During review, select **Publish** for
each file you want readers to download; source files selected for publication
also become citations for this exact definition revision. Files are never sent
to the assistant. An example file is published as your separate example
contribution and remains available when the definition wording changes.

Unselected files remain private and expire after 24 hours. **Other pending
files** lets you recover an upload for the same term or remove an unused upload
after refreshing or starting another term. You can hold six pending files at a
time. Published files retain their original content as part of the contribution
record.
