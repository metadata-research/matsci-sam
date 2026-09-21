# Term reference resources

SAM owns contributor lookup receipts; ONT owns pinned open ontology snapshots.
The ChEBI adapter reads ONT `/grounding` with `sources=chebi`. The independent
Wolfram adapter calls CAG Results at
`https://services.wolfram.com/api/cag/v1/WolframAlphaResult`, using the server-only
`WOLFRAM_API_KEY`. Requests send the confirmed term, optional entered context,
preferred units and any explicitly selected provider interpretation. The
definition draft is not sent. Agent One definition drafting is a separate
assistant profile with its own server credential and readiness check.

## Contribution workspace

New terms follow **Confirm term → Write definition → Review and publish**.
**Confirm term and find references** commits the client contribution context
and starts one ChEBI lookup. Typing does not. Existing-term actions inherit
their fixed term and source revision; deliberately opening the action starts
that lookup. Confirmation neither creates a term nor asserts an ontology
mapping. Wolfram requires its own **Retrieve Wolfram resources** action.
The Discussion feed opens a workspace only when a contributor selects
**Start an alternative**. Reading the feed does not initiate lookups.

The form owns both provider states above responsive and contextual views.
Switching tools does not refetch or lose receipts. Generation guards reject
stale callbacks after the term, vocabulary or source revision changes. The
responsive shell uses available container width, including embedded forms.
Narrow tool views replace the main area. A status strip remains in the active
writing or review step. Pending-provider completion never navigates, inserts
text, selects evidence or silently adds citation rows.

ChEBI initially shows the closest candidate's name and **Show definition**.
Each candidate behind **Other matches** has its own reveal action. Reveal and
consulted-entry state live in the workspace owner, so responsive remounts
preserve them. Show/Hide changes no model input or citation. Wolfram becomes
locally consulted only when its result is actually displayed, not when a
hidden lookup completes. Consulted state is a UI shortlist, not a new persisted
interaction event or proof that a person read a source.

**Copy** changes the clipboard and records the existing successful interaction.
**Add to definition** appends text, returns to the editor and provides Undo;
for both providers a successful insertion attaches a removable citation. Failed
insertion attaches nothing. **Cite without inserting** attaches a citation
explicitly. **Add to assistant context** independently selects the full stored
entry for a later model request. No action infers use from text or the clipboard.
Undo for a source insertion expires after another text edit or an explicit
source-selection change, so it cannot replace newer writing or choices.

Review renders only attached **Citations** with Remove actions. **Add a
citation** opens a snapshot of already consulted entries with direct Cite
controls. Further consulted entries require **Review newly opened sources**;
late arrivals do not add interactive rows automatically. Existing attachments
remain visible regardless of consulted state. Final attachments become revision
citations at publication. Copy/Add timestamps remain client-reported
interaction evidence, not proof of cognitive use. Matching labels do not
assert concept equivalence.

**Suggest a definition** reserves a preview area when the request starts and
keeps the current definition editor visible and editable through loading and
preview. Editor and suggestion sit side by side in the full writing area on
wide screens and stack on narrow screens. The same layout supports an empty
editor. Reference tool launchers are disabled during comparison; provider
state remains owned by the form and is preserved.

Request-time contributor text and source snapshots remain immutable. A model
response never overwrites subsequent editor changes. **Use this draft**
explicitly replaces the current editor text and captures that immediate
pre-acceptance writing and source selections for Undo/rework. **Keep my
writing** discards an unused preview without replacing the latest contributor
text; request errors likewise preserve it. Undo/rework restores the
pre-acceptance writing and attribution, rather than the request-start text.
Publication accepts one applied suggestion, so another generation requires
an explicit return to that saved writing. An applied suggestion cannot be
retargeted to a different term.
Existing-term model revisions similarly require explicit preview application
and a separate review before publication.

The optional `expectedVocabularySlug` guard rejects new-term publication and
model requests if the active destination changed after confirmation. It does
not replace contributor access checks. Existing source-revision and study
validation remain authoritative for inherited actions. The source-action changes require no migration. Assistant configuration and
preferences use the separate migration described below.

Clarification exchanges (9d) and on-page ontology graphs are later increments.
The current model response contract returns a definition, not a conversation
turn; retrieving a ChEBI candidate does not establish a SAM placement.

## Wolfram lookup and refinement

The default is the unqualified term, automatic interpretation and metric
units. Optional context is a query hint, not a result filter. The options form
shows the effective query before retrieval. Generic domain and intended-meaning
presets are omitted: adding those phrases can reduce relevance or produce no
result. Native interpretation alternatives come from the returned source and
are offered only while refining the same base input. Changing that input clears
the prior assumption choice.

**Refine lookup** opens an explicit edit state; retrieval creates a new receipt.
Canceling or a failed retrieval preserves the prior result. The workspace keeps
up to five Wolfram receipts alongside the ChEBI receipt for a confirmed context.
Switching saved results and retrieving another result preserve existing review
citations and model-input selections by receipt identity. New results start
unselected. The consulted-source shortlist gate also applies to refinements.
Changing the confirmed contribution context still clears its workspace state.

The result view puts interpretation and assumptions first, then renders
recognized headings and property/value rows. Unrecognized content remains
readable text, and **Original response** exposes the complete returned source
text. Formatting is deterministic presentation, not a generated summary or a
change to stored evidence. **Copy section** includes the source interpretation
and assumptions with that section. It does not create an excerpt reference or
select a citation. Each complete response remains one reference and one model
input; section copying does not reduce the source text sent when that reference
is selected for a model request.

## Stored provider evidence

Wolfram receipts retain the effective query/context, units, selected native
assumptions, exact response, SHA-256, retrieval time and response UUID when
supplied. The recorded request endpoint and source link retain the effective
query and request options; credentials are excluded. Reopening a receipt uses
its saved request settings. Results are factual context, including
interpretations, assumptions and units; they are not labelled as
open dictionary definitions. `usageStatus=prototype` and a null licence record
the prototype arrangement without inventing an open licence. Retention has no
automatic expiry. ChEBI keeps its release and CC-BY-4.0 metadata. Owners can
reopen a receipt through `termReferences.getLookup`, filtered by provider;
raw response bodies and uncited history are not public.

ChEBI display, Copy and Add convert supported formula formatting to plain
text, for example `TiO<small><sub>2</sub></small>` becomes `TiO₂`. This does
not change the stored publisher text, its hash, or the source snapshot sent
to a model. Source content remains escaped text; it is never executed as HTML.

Migration 0057 introduced receipts, entries and revision citations. Migration
0058 adds Wolfram response metadata, entry kind/usage status, nullable licence,
and model input snapshots. Migration 0059 adds nullable `inputExample` and
`userPrompt` snapshots to AI suggestions. The latter is the complete user
message sent for each new-term or revision request; historical rows remain
null without reconstruction. Publication binds receipts to the term atomically
with the revision; ownership and term mismatch fail the transaction.

## Model inputs and contributor declarations

Before a model request, **Assistant context** lists included items beside the
model action. **Inspect input text** expands their read-only text. New-term
requests require the confirmed term. A nonblank draft defaults to included;
a removed draft can be restored with its Include action. The optional example
is excluded until **Include in assistant context** is clicked beside its
editor. Revision requests require the term, exact source definition and
critique. **Clear feedback** explicitly erases critique; Remove and **Clear
optional context** never erase writing, saved receipts or citations.

References enter this list only through **Add to assistant context** on a
revealed/displayed entry. The adding action enforces both the six-source and
24,000-character bounds and reports a reason when blocked. The server still
loads owned, term-matched snapshots by ID, never browser replacement text.
Suggestions store the exact sources, serialized evidence block and complete
user message. Included draft/example fields are stored separately; omitted
inputs remain null. Example context informs only the definition and never
changes the definition-only output schema.

**Context for this request** freezes the submitted text and chosen assistant
through preview, application and review. Later edits, lookups, context removal
or preference changes cannot alter it. New-term responses reconcile the visible
snapshot to server-confirmed draft, example, user-message and reference inputs.
The stored system prompt treats source text as untrusted data and preserves
ambiguity.

Typed contributor notes may independently contain copied text; SAM does not
infer a source selection from that text. Selecting a reference does not claim
the model used every fact or that its answer is correct. The model input record
is inspectable during review, separately from contributor source declarations.

Published revision 1 exposes accepted suggestion inputs under **Sources
supplied to the model**. Contributor declarations appear separately under
**Cited references**. The PROV activity uses `prov:used` for actual model inputs
and the revision uses `dcterms:references` for contributor declarations.
An included example has its own input entity with `prov:used` from generation
and `prov:wasAttributedTo` the requesting contributor. It is distinct from any
independently published example, which retains its human authorship and does
not acquire a model generation stamp. Accepted provenance also exposes the
exact user-message entity. Supplying an example does not claim the model
authored it, or that the eventual published example is unchanged from the input.
Discarded drafts retain their private input evidence without public attribution.
Later revisions do not inherit declarations or claim another model request;
their original revision keeps its evidence. Legacy suggestions are not
backfilled.

## Definition assistant profiles

`default` preserves the deployment's Ollama/FLAME configuration and displays
its configured model identity; `agent-one` uses the dedicated Wolfram Agent
One adapter. Browsers submit only these approved profile identifiers, never
endpoints or credentials. The factual CAG lookup is independent of either
choice and continues to use its separate key.

Agent One requires the protected server-only `WOLFRAM_AGENT_ONE_API_KEY`.
Admin AI & services exposes a definition-output validation action, enablement
and the default profile. Validation exercises the actual definition adapter,
not only a generic chat connection. It is bound to the configured credential
and adapter settings by a private digest; changing those settings requires a
new successful test. A failed retest removes readiness. Only a configured,
validated, enabled Agent One profile is selectable. No automatic fallback is
performed when a chosen assistant becomes unavailable.

Migration `0060_definition_assistants.sql` adds the administrator policy and
validation state plus each contributor's preferred assistant. Preferences
apply to ordinary new-term and revision requests. Study requests remain fixed
to the deployment profile, enforced on the server. Configuration is captured
before asynchronous policy reads; the request keeps its producing profile,
service and available returned model identity in stored inference metadata.
A response is attributed to Wolfram Agent One without guessing an undisclosed
underlying LLM. Provider output must validate against the definition schema
before it can become a suggestion. Keys and private validation digests are
excluded from client responses and provenance.

Agent One availability depends on the dedicated server credential and a
successful administrator validation for the current adapter configuration.
CURRENT-DEV-STATE records the local validation and activation state.

## Limits and verification

Retrieval requires a contributor profile. Limits are five calls/minute and one
in-flight call per contributor **per provider**, with at most 100 limiter
records per app process. Multi-instance deployments need a shared limiter for
global limits. Both adapters bound responses to 128 KiB and refuse redirects.
ChEBI additionally limits five entries/15 seconds, validates source IRIs and
licence. Wolfram limits text to 60,000 characters/25 seconds, with up to five
saved lookup receipts per contribution context. Review can retain those five
receipts plus ChEBI. A model request uses at most six selected entries and
24,000 source-text characters; a formatted long response still counts in full.
All external text renders as escaped text, without remote images or executable
markup. Provider-specific failures do not prevent manual writing or the other
lookup.

Verify source limits with `node --import tsx scripts/test-source-context-limits.ts`.
Also run `pnpm test:model-prompt-inputs`, `pnpm test:references`,
`pnpm test:references-db` (migrated local
database; fixtures roll back), and existing contribution, revision and graph
tests. Browser checks cover confirmation, visible previews, explicit
application/Undo, retrieval and refinement, original-response preservation,
whole/section Copy, successful/failed Add, reveal/consulted state, citation
attachment/removal, context limits, immutable shortlist contents, publication,
ownership, stale responses, provider failure and responsive layouts. Prompt
checks cover explicit inclusion/exclusion, clearing without deleting writing
or citations, immutable submitted text, independently authored examples and
the required inputs of revision requests.

For constrained local verification, use `pnpm build --webpack`: the Next config
limits workers to two and enables webpack memory optimizations. Wrap each
build/check in a process-tree memory limit; do not run a build alongside a dev
server or browser. A production preview avoids development compiler overhead.
