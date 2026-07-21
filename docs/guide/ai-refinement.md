# AI refinement

When you add a term with the interactive toggle on, your definition page
shows a **Refine with AI** button. Refinement is a conversation about
your definition, held in place on the page rather than in a chat window.

## The loop

1. Click Refine. The model reads your definition and example and drafts
   a suggested revision. The first round after the site has been idle can
   take up to half a minute while the model loads. The wait survives a
   page refresh.
2. The suggestion appears as a card, with changed wording highlighted
   against your current text. You have three choices.
   - **Accept suggestion** publishes the revision.
   - **Keep mine** closes the round with your original standing.
   - **Re-evaluate** sends your feedback and requests another pass. Type
     what should change first, for example "mention that the
     transformation is diffusionless".
3. Each new round appears as its own card. Decided rounds collapse into
   one-line history entries you can expand later.

If a round fails because the model is unavailable, the card says so
plainly and offers a Retry button.

## What accepting does

An accepted suggestion becomes a **separate definition**, credited to you
and to the model by name, in the style of a co-authored commit. Your
original definition is never overwritten. The two definitions link to
each other, and the refined one shows a "Refined" badge wherever it
appears. Readers can vote on either.

You can refine again after a round is decided, and the model sees the
whole earlier conversation, including what you told it before.

Every request, suggestion, decision, and piece of feedback is recorded in
the term's [provenance](/docs/provenance).
