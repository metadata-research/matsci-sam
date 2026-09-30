# Study help and workflow

`docs/guide/studies.md` supplies both the public guide and contextual study
help. The run page renders the Markdown on the server and passes selected
sections to `components/studies/help.tsx`.

## Help excerpts

`lib/study-help.ts` selects seven IDs for level two headings.

```text
help-in-the-study
terms-used-in-the-study
the-position-step
reviewing-the-definitions
the-closing-questions
saving-and-returning
study-and-vocabulary-workflows
```

Each excerpt ends at the next level two heading. `studyHelpTopic` selects a
starting topic from the step kind. Instructions use the text for the study.
`studyHelpSectionsFor` includes only the topics used by the active protocol.

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
authentication and required profile setup. `normalizeAuthReturnTo` permits those
routes and invitation routes, while rejecting external URLs, unrelated paths,
query strings, and fragments. Email tokens bind the return path to the token
digest. ORCID authorization keeps the normalized return path in OAuth state
bound to the session and revalidates it on callback. An ORCID iD must already be
connected to a SAM account to sign in. An unrecognized iD follows the guidance
for account creation. Study enrollment remains a separate action.

Authentication does not grant membership. The overview and run page use the
same enrollment rule. See the [study protocol](studies.md#id4-round-two-amendment)
for the supported enrollment paths.

## Protocol and instructions

The shared generator supports an arbitrary collection, study instructions, and
optional closing questions. It creates instructions, Position steps, Review
steps, then questions. The active protocol can filter that sequence without
changing stored records. [Studies and the walkthrough](studies.md#the-position-rule)
defines the protocol and compatibility behavior.

The Position view prioritizes the earliest definition attributed to a model and
shows scores and discussion. It provides neither blinded presentation nor
randomized candidate order. Study instructions must account for those cues.
Stored questions, exclusions, and responses remain independent of guide text.

The stored `presentation` for a study selects Simple or the legacy interface
with full detail for its participants. The walkthrough overrides the view
preference stored in the browser, and presentation changes are refused after
activity is recorded. A Simple study does not initiate reference or ontology
lookups. See [the study page contract](studies.md#the-pages) for the setting and
its locks.
