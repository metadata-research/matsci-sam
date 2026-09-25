# References

Use reference tools to compare meanings, insert text, or cite a source while
writing a definition. The available sources and assistants depend on the site
configuration. A missing result leaves you free to write and publish.

## ChEBI matches

1. Confirm a new term, then select **Advanced** under **View**.
2. Read the opened ChEBI match, including its identity, definition, release,
   and licence. Check that the meaning fits your term.
3. Open **Other matches** to compare candidates. Select **Show definition**
   for a candidate you want to inspect.

ChEBI matches and **Matches across ontologies** appear beside the form on a
wide screen. The hierarchy shows the asserted parents of the selected ontology
concept. On small screens these panels appear below the form.

![Advanced Add with ontology matches and hierarchy beside the form and tools below it](/images/docs/help-add-advanced.png)

Use the [Metadata page](/docs/term-metadata#advanced-view) to propose a link
to a related concept. Reference tools preview source concepts without saving
ontology relationships.

Contribution dialogs for existing terms use a compact reference workspace.
Open a candidate definition there before using its actions.

## Use a source in your definition

| Action | Effect |
| --- | --- |
| Add to definition | Inserts text and attaches a citation |
| Copy | Copies text without attaching a citation |
| Cite without inserting | Attaches a citation without changing the definition |
| Add to assistant context | Includes the source in a later model request |

Insertion offers Undo to restore the previous writing and citation choices.
Use **Cite without inserting** when you paraphrase a source or paste copied
text. Source text and your final definition remain separately recorded.

## Wolfram lookup

Open **Wolfram lookup** in the Advanced toolbar. Check **Query to send**, the
preferred units, and any optional research context, then select **Retrieve
Wolfram resources**. The lookup uses the confirmed term and chosen options.
Your definition text is not sent with this lookup.

Read **Interpreted as** and the assumptions before using the result.
**Overview** contains the principal information. Expand **More properties**
for additional sections. Values retain their units and stated conditions.

![A Wolfram result with its interpretation, readable properties, and link to Wolfram|Alpha](/images/docs/help-wolfram.png)

**Open in Wolfram|Alpha** opens the query on the live Wolfram website for plots,
diagrams, and further detail. That page can change independently of the saved
response. **Original response** contains the complete returned text, with
**Copy original response** available.

A section has **Copy section** and **Add to definition** actions. An insertion
includes its interpretation and conditions and attaches a citation to the
complete saved response. Copying alone attaches no citation.

Use **Refine lookup** to change context or units. **Change interpretation**
opens alternatives when available. Retrieve again to apply the changes.
Canceling or a failed request preserves the previous result. **Saved Wolfram
lookup** selects an earlier result for the confirmed term. Closing the tool
preserves its query and results.

Wolfram lookup provides reference information. Wolfram Agent One is a separate
[definition assistant](/docs/ai-refinement#assistant-choice-and-context).

## Citations and assistant inputs

Review **Citations** before publication. **Remove citation** removes a source
from the published citation list without changing your text. **Add a citation**
opens previously displayed references, each with a **Cite** action. Use
**Review newly opened sources** to refresh an already open shortlist.

A viewed or copied source is not automatically cited. **Add to definition**
does attach a citation. Citations belong to the published revision, so choose
the sources used when creating a new version.

**Add to assistant context** includes the selected reference in the next model
request. For Wolfram, it includes the complete saved response even if you
inserted only one section. Assistant inputs and citations are independent.
Adding text or a citation does not select an assistant input.

Applying a model draft replaces your writing and clears its citation choices.
Undo restores both. Review citations again before publishing the new wording.
Files can also support a definition. See [Files and examples](/docs/files-and-examples).
