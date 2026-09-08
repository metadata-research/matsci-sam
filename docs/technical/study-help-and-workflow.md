# Study help and workflow

`docs/guide/studies.md` supplies both the public guide and contextual study
help. The run page renders the Markdown on the server and passes selected
sections to `components/studies/help.tsx`.

## Help excerpts

`lib/study-help.ts` selects seven level-two heading IDs.

```text
help-in-the-study
terms-used-in-the-study
the-position-step
reviewing-the-definitions
the-closing-questions
saving-and-returning
study-and-vocabulary-workflows
```

Each excerpt ends at the next level-two heading. `studyHelpTopic` selects a
starting topic from the step kind. Instructions use the study-specific text.
`studyHelpSectionsFor` omits Review help for ID4 round two.

Preserve these IDs when editing the guide. `pnpm test:surveys` runs
`scripts/test-study-help.ts` against the rendered Markdown and checks topics,
section boundaries, and links.

## Draft state

The help dialog leaves the activity mounted. Excerpt links use a new tab with
`noopener noreferrer`. A participant can return to the unfinished form without
submitting it. Navigation or a reload can still lose unsubmitted text because
forms have no draft autosave. Completed actions persist in PostgreSQL.

## Authentication and enrollment

Study overview and activity sign-in links retain their return path through
authentication and required profile setup. `normalizeAuthReturnTo` permits
those routes and invitation routes, while rejecting external URLs, unrelated
paths, query strings, and fragments. Email tokens bind the return path to
the token digest.

Authentication does not grant membership. ID4 round two allows a separate
`surveys.join` action while open and prepared. Other studies require existing
membership or an invitation. The overview and run page apply the same rule.

## Protocol and instructions

The shared generator supports an arbitrary collection, study instructions,
and optional closing questions. It creates instructions, Position steps,
Review steps, then questions. ID4 round two filters the active sequence to
omit Review while preserving stored steps and earlier activity. See
[Studies and the walkthrough](studies.md#id4-round-two-amendment).

The Position view prioritizes the earliest model-authored definition and
shows scores and discussion. It provides neither blinded presentation nor
randomized candidate order. Study instructions must account for those cues.
Stored questions, exclusions, and responses remain independent of guide text.
