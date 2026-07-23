# AI refinement

When you add a definition with **Interactive AI refinement** on, your
definition page shows a **Refine with AI** button. Only the author of the
original definition can use this multi-round refinement panel.

## The loop

1. Select **Refine with AI**. The application sends your term, definition,
   and example to the locally hosted language model. A round can take up
   to half a minute when the model must load. The pending round is stored,
   so a page refresh does not discard it.
2. The suggestion appears as a card, with changed wording highlighted
   against your current text. You have three choices.
   - **Accept suggestion** publishes the revision.
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
later round updates the existing refined definition and records an edit
instead of creating another refined definition.

Every request, suggestion, decision, and piece of feedback is recorded in
the stored [provenance](/docs/provenance) for the term.
