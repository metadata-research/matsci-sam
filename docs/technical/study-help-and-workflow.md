# Study help and workflow alignment

The participant guide at `docs/guide/studies.md` explains the current
walkthrough. Its named sections are also the in-study help topics; the run
page renders them on the server and passes the excerpts to the help dialog.
The dialog opens on the current step's topic. Stored study instructions are
available separately and remain the authoritative task text for that study.

Opening help leaves the activity mounted. Excerpt links open in another tab
so a participant can consult the guide without navigating away from an
unfinished proposal, critique, comment, or answer. Completed actions persist
in the database; in-progress form text still has no draft autosave.

The Sign in actions on study overview and activity pages carry their return
path through authentication and required profile setup. `normalizeAuthReturnTo`
allows these two study routes alongside invitation routes; external URLs,
unrelated paths, query strings, and fragments remain excluded. Email links
bind the return path to the token digest. Returning to a study does not grant
membership or bypass its participation window. Nonmembers are directed to
the person who shared the study link for access.

## Alignment decisions

| Issue                                                    | Decision                                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| No help inside the focused activity                      | Add a contextual help dialog and a study-page guide link                                                                                       |
| Position mistaken for voting or canonical selection      | Define the three concepts separately and document Accept's upvote behavior                                                                     |
| Suggested revision mistaken for an in-place edit         | Explain that the shared suggestion action publishes a separate definition; its existing button label is retained                               |
| A study proposal mistaken for a targeted replacement     | Cross-link the normal contribution guide and explain the absence of a replacement target in Position                                           |
| Single-definition Review disables votes and comments     | Use the same controls as multiple-definition Review, consistent with the written instruction to review each definition                         |
| Generic instructions assume a second round               | Make new fallback instructions independent of prior participation; recognize the exact previous defaults without replacing stored instructions |
| Position and Review ordering differ from canonical order | Document the distinction and preserve the current study ordering                                                                               |
| Saved progress mistaken for draft autosave               | Identify which actions save immediately and when Review completion is recorded                                                                 |

## Studies without an earlier round

The current generator already accepts an arbitrary collection, study-specific
instructions, and optional closing questions. It creates instructions, all
Position steps, all Review steps, then questions. A study can use newly
prepared definitions; a Position step with no available definitions can
collect a first proposal or a skip. No previous study identifier is required.
The second-round requirement was wording, not a relationship in the schema.

The current Position presentation still prioritizes the earliest model-authored
definition and shows existing support and discussion. That is suitable only
when the study protocol permits those cues. Removing these cues, randomizing
or blinding alternatives, changing the sequence, or separating recruitment,
elicitation, and evaluation into rounds requires an explicit protocol design.

Defer those broader study modes until after MTSR. Also revisit whether to offer
a term-level new-definition action outside studies and whether to rename the
overloaded Publish revision button. Neither requires changing the meaning of
existing term, definition, revision, vote, or study records now.

Existing studies keep their stored instructions, questions, selected terms,
exclusions, and responses. These changes add no database migration or content
synchronization. The single-definition Review control change should be
included in the release record when this patch is deployed.
