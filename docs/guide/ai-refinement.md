# AI refinement

When you add a definition with **Publish, then refine** selected, your
definition page shows a **Refine with AI** button. Only the author of the
original definition can use this multi-round refinement panel.

## The loop

1. Select **Refine with AI**. The application sends your term, definition,
   and example to the locally hosted language model. A round can take time,
   especially when the model must first load. The pending round is stored, so
   a page refresh does not discard it.
2. The suggestion appears as a card, with changed wording highlighted
   against your current text. Depending on what the model changed, you can:
   - **Accept suggestion** publishes the revision.
   - **Accept definition, keep my example** publishes the suggested definition
     while preserving your example verbatim. This choice appears when the
     model changed the example.
   - **Keep mine** closes the round with your original standing.
   - **Re-evaluate** sends your feedback with a request for another pass.
     Type what should change first, for example "mention that the
     transformation is diffusionless".
3. Each new round appears as its own card. Decided rounds collapse into
   one-line history entries you can expand later.

If a round fails because the model is unavailable, the card says so
plainly and offers a Retry button.

## What accepting does

The first accepted suggestion creates a **separate definition** credited
to you and to the model by name. Your original definition remains
unchanged. The two definitions link to each other, and the refined one
shows a "Refined" label. Readers can vote on either definition.

You can refine the original again after a round is decided. The request
includes the suggestions and feedback from earlier rounds. Accepting a
later round publishes a new revision of the existing refined definition. The
new revision records the accepting author, named model, prompt, accepted
suggestion, and relationship to the preceding revision. It starts with a new
vote tally. Earlier revisions and their vote totals remain available in the
revision history.

A refinement request records the source revision. The application does not
accept the suggestion if that source changes while the round is open. Start a
new round from the latest revision in that case.

Every request, suggestion, decision, and piece of feedback is recorded in
the stored [provenance](/docs/provenance) for the term.

The ordinary **Edit** action uses the same immutable revision mechanism.
[Community review and revisions](/docs/community) describes the revision
record and the handling of votes and comments.
