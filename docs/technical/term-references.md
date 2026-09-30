# Term reference resources

SAM stores contributor lookup receipts. ONT stores versioned open ontology
snapshots. The reference adapter queries ONT `/grounding` without a source
filter. Any cleared source with definitions can contribute to the response, up
to eight entries. ONT controls ranking. SAM preserves the returned order, source
title, release and licence. Entries require a stated licence. The provider id
stays `chebi` in the database and router for compatibility, and the formula
formatting in `lib/reference-text.ts` applies to ChEBI entries only. The
independent Wolfram adapter calls CAG Results at
`https://services.wolfram.com/api/cag/v1/WolframAlphaResult`, using
`WOLFRAM_API_KEY` stored on the server. Requests send the confirmed term,
optional entered context, preferred units and any explicitly selected provider
interpretation. The definition draft is not sent. Agent One definition drafting
is a separate assistant profile with its own server credential and readiness
check.

## Contribution workspace

New terms follow **Confirm term → Write definition → Review and publish**.
**Confirm term**, labelled **Confirm term and find references** in Advanced,
commits the client contribution context. One reference lookup starts once the
term is confirmed and Advanced is visible. A Simple study excludes this lookup.
Actions for existing terms inherit the fixed term and source revision, and
opening an action in Advanced starts the lookup. Typing and confirmation create
no term or ontology mapping. Wolfram requires its own
**Retrieve Wolfram resources** action. The Discussion feed opens a workspace
only when a contributor selects **Start an alternative**. Reading the feed does
not initiate lookups.

The form stores state for both providers above the responsive and contextual
views. Tool changes preserve receipts without refetching. Generation guards
reject stale callbacks after the term, vocabulary or source revision changes.
The responsive shell uses available container width, including embedded forms.
Add uses `AddDefinitionWorkspace` for new terms. Simple and Advanced share one
mounted form with identical column sizing. Advanced reveals persistent reference
definition and ontology context panels to the right, stacking at narrow
container widths. `DefinitionToolbox` merges the selected tool and toolbar
beneath the form. Simple includes **Attach an example file** and a reduced
**Help me write** control below the editor. Citations, source files and the
other tools are Advanced. The view choice is stored per browser in the
`matsci-sam-view` cookie, which the root layout loads, and only pages with a
view control apply it. Inherited contribution forms keep the earlier responsive
workspace, narrow tool views and status strip. Provider responses update lookup
results. Navigation, text insertion, evidence selection and citation attachment
require separate contributor actions.

The reference lookup in Advanced Add reveals the first candidate once per
visible lookup. The workspace records the candidate in its local consulted list.
Citation and model input selection remain separate actions. Hiding it or
switching views preserves that choice. Inherited forms initially show the name
of the closest candidate and **Show definition**. Each candidate behind
**Other matches** has its own reveal action. The workspace stores reveal state
and the consulted list across responsive remounts. Show/Hide leaves model input
and citations unchanged. A Wolfram result enters the consulted list when
displayed. The list is local to the interface and records no persistent
interaction event.

**Copy** changes the clipboard and records the existing successful interaction.
**Add to definition** appends text, returns to the editor and provides Undo. For
both providers a successful insertion attaches a removable citation. Failed
insertion attaches nothing. **Cite without inserting** attaches a citation
explicitly. **Add to assistant context** independently selects the full stored
entry for a later model request. Source use is recorded through explicit
selection. Undo for a source insertion expires after another text edit or an
explicit change to source selections.

Review renders only attached **Citations** with Remove actions.
**Add a citation** opens a snapshot of already consulted entries with direct
Cite controls. Further consulted entries require
**Review newly opened sources**. Late arrivals do not add interactive rows
automatically. Existing attachments remain visible regardless of consulted
state. Final attachments become revision citations at publication. Copy/Add
timestamps record interactions reported by the client. Matching labels do not
assert concept equivalence.

**Suggest a definition** reserves a preview area when the request starts and
keeps the current definition editor visible and editable through loading and
preview. Add keeps the assistant tool below the editor during loading and
comparison, including when switching views. Inherited forms retain their preview
beside the editor on wide screens and stacked preview on narrow screens. The
same layout supports an empty editor. Tool launchers are disabled during
comparison. The form preserves provider state.

Contributor text and source snapshots recorded at request time remain immutable.
Editor changes made during generation remain in the editor. **Use this draft**
replaces that text and saves the writing and source selections immediately
before acceptance for Undo/rework. **Keep my writing** discards an unused
preview and preserves the latest contributor text. Request errors also preserve
it. Undo/rework restores the saved writing and attribution from immediately
before acceptance. Publication accepts one applied suggestion, so another
generation requires an explicit return to that saved writing. An applied
suggestion cannot be retargeted to a different term. Model revisions for
existing terms require explicit preview application and a separate review before
publication.

The optional `expectedVocabularySlug` guard rejects publication of new terms and
model requests if the active destination changed after confirmation. Contributor
access checks also apply. Validation of the source revision and study governs
inherited actions. [Definition assistant profiles](#definition-assistant-profiles)
describes assistant selection.

The model response contract returns a definition in one response. Retrieval of
reference candidates records no semantic placement in SAM.

## Ontology context preview

The reusable `OntologyContextPanel` appears beside the default definition on
published term pages, beside a local draft on `/labs/ontology-context`, and in
Advanced Add. Its contribution variant shows grouped matching terms and the
selected hierarchy as separate persistent cards. Queries begin only when
Advanced is visible and the term is confirmed. Hidden panels retain choices. The
term page searches its fixed term when the panel opens. In the lab,
**Find matches** confirms the search term. Typing alone does not search.
Matching ignores case and surrounding whitespace, while preserving chemical
punctuation and words. Only sources with exact labels appear in the default
selector. A second selector disambiguates multiple candidates within a source.
An empty result says **No exact label match found**.

**Search similar names** switches to label matches containing the search words
and excludes exact matches. The results are based on names, without inferred
semantic relationships. Even a single similar candidate requires an explicit
**Choose a term** selection before a hierarchy request starts.
**Back to exact matches** restores the default search. Switching modes clears
candidate choices. Query keys include the mode so a late exploratory response
cannot replace exact results. Selection is identified by both source key and
entity IRI. Within a mode, the workspace retains the selected candidate for each
source and leaves the draft unchanged. Changing the confirmed term resets to
exact matching.

Neither identical labels nor similar names assert `skos:exactMatch` or
`skos:closeMatch`. The index contains one selected label per source and entity.
Alternative labels require a separate lookup extension. ChEBI CORE excludes the
synonym content available in ChEBI FULL.

The initial hierarchy shows up to three immediate named parents, followed by the
matched term. Additional parents expand inside a bounded list. The asserted
relationships are `rdfs:subClassOf`, `skos:broader` and inverse `skos:narrower`.
Missing parent labels use the identifier. Absent named parents are not presented
as evidence that a concept is a root. Anonymous superclass expressions are
indicated without expanding a graph.

A hierarchy can include up to twenty mappings stated in the source graph between
named entities. Supported predicates are `skos:exactMatch`, `skos:closeMatch`
and `owl:equivalentClass` in either direction. The label of the mapped entry
appears when supplied by the source. The preview lists them as
**Mapped concepts** after the parents. A labelled one opens in place of the
match, so its own parents show, with **Back to the match** to return. A mapping
to the selected match appears as text without an open action. Keyboard focus
moves to **Back to the match** when a mapping opens and returns to the mapping
when it closes. Changing the term, the mode or the selection clears the opened
concept. Actions in the compact variant receive the opened concept with
`explored` set. The Metadata page displays **Cite this concept** for that
concept and **Cite this match** for the original match. The citation records the
selected concept name and link. A source whose graph holds a
`skos:ConceptScheme` and no `owl:Ontology` is named as a vocabulary. An older
ONT states no kind or mappings, and the preview then shows neither. Release and
license stay with the selected source, with an optional link to the full ONT
entity page.

SAM queries the ONT `/candidates` and `/hierarchy` endpoints through
`MATSCI_ONT_URL` configured on the server, passing `mode=exact` or
`mode=similar` explicitly. The response mode must agree with the request and the
match classification of each candidate. `MATSCI_ONT_PUBLIC_URL` independently
controls the optional browser link. The transport URL remains private to the
server. Each request has a deadline of 15 seconds and a 128 KiB response limit.
Candidates are capped at five per source and 32 sources. Parent assertions are
capped at 50 with explicit truncation. The panel groups multiple assertions
about the same parent into one row. ONT excludes mirrors and sources not cleared
for publication, and searches labeled classes and concepts even when they have
no definition.

Queries and source selections create no lookup receipts, revision citations,
model inputs or database records. The test draft remains local to the lab, and
the contribution preview leaves the definition unchanged.

The Metadata page adds explicit draft actions through
`components/metadata/metadata-ontology-context.tsx`. **Cite this match** fills
the source name, concept IRI and release for the assertion.
**Cite this concept** does the same for an opened mapping.
**Add as related concept** fills the `relatedConcept` value and its source title
and release. Both require a separate metadata submission to save anything. The
resulting assertion has its own scope, attribution and review status. It creates
contextual metadata, with no equivalence, class membership or citation on a
definition revision.

Run `pnpm test:ontology-context` for bounded transport and identity checks using
mock responses. Run `pnpm test:preview` in ONT to check source isolation, limits
for each source and asserted hierarchy semantics against isolated Jena fixtures.

## Wolfram lookup and refinement

The default is the unqualified term, automatic interpretation and metric units.
Optional context is a query hint, not a result filter. The options form shows
the effective query before retrieval. Contributors can enter context directly.
The form has no generic presets for domain or intended meaning. Native
interpretation alternatives come from the returned source and are available only
while refining the same base input. Changing that input clears the prior
assumption choice.

**Refine lookup** opens an explicit edit state. Retrieval creates a new receipt.
Canceling or a failed retrieval preserves the prior result. The workspace keeps
up to five Wolfram receipts alongside the reference receipt for a confirmed
context. Switching saved results and retrieving another result preserve existing
review citations and selections for model input by receipt identity. New results
start unselected. Refinements enter the consulted list only after display. A
change to the confirmed contribution context clears the workspace state.

The reading view starts with interpretation and the recorded assumptions. Its
**Overview** selects identity, basic properties and sections containing the
principal result. Other substantive sections remain individually expandable
under **More properties**. Sections containing only graphics link to the Wolfram
website through the saved reference IRI. The link opens a live query, not an
immutable copy of the saved response.

The parser processes plain and Markdown headings, property tables, multiple
columns and continuation rows. Formatting for scientific notation displays
common subscripts and exponents while preserving identifiers. Unknown content
remains escaped text. Graphics URLs, Wolfram code, website footers and machine
interpretation instructions are omitted from the reading view.
**Original response** and **Copy original response** retain them exactly.

**Copy section** and **Add to definition** within a section use readable text
with the source interpretation, recorded assumptions and local conditions. Add
uses the insertion, citation and Undo workflow. Copy leaves citation selection
unchanged. These actions preserve the complete response as one reference and one
model input. Deterministic formatting changes presentation only. Section copying
or insertion does not reduce the source text sent when that reference is
selected for a model request. Reference definitions retain actions for the
complete definition.

## Stored provider evidence

Wolfram receipts retain the effective query/context, units, selected native
assumptions, exact response, SHA-256, retrieval time and response UUID when
supplied. The recorded request endpoint and source link retain the effective
query and request options. Credentials are excluded. Reopening a receipt uses
its saved request settings. Results are factual context, including
interpretations, assumptions and units. They are not labelled as open dictionary
definitions. `usageStatus=prototype` records the prototype arrangement, and a
null licence indicates that no open licence is asserted. Retention has no
automatic expiry. Reference entries keep the release and licence the store
states. Owners can reopen a receipt through `termReferences.getLookup`, filtered
by provider. Raw response bodies and uncited history are not public.

Reference receipts retain the requested term and retrieval time with each
snapshot of publisher text, source IRI, release, licence and content hash. The
first successful Copy and Add reports can record `copiedAt` and `addedToDraftAt`
separately. These private timestamps record the first successful interaction
reported by the client. Later use and citation require their own records.
Revealing and hiding source text adds no persisted event.

For ChEBI entries, display, Copy and Add convert supported formula formatting to
plain text, for example `TiO<small><sub>2</sub></small>` becomes `TiO₂`. This
does not change the stored publisher text, its hash, or the source snapshot sent
to a model. Source content renders as escaped text.

AI suggestions store nullable `inputExample` and `userPrompt` snapshots. The
latter is the complete user message sent for each request for a new term or
revision. Missing historical inputs remain null without reconstruction.
Publication binds receipts to the term atomically with the revision. Ownership
and term mismatch fail the transaction.

## Model inputs and contributor declarations

Before a model request, **Assistant context** lists included items beside the
model action. **Inspect input text** expands their read-only text. Requests for
new terms require the confirmed term. A nonblank draft defaults to included. A
removed draft can be restored with its Include action. The optional example is
excluded until the contributor selects **Use my example** in the Add assistant
tool or **Include in assistant context** in an inherited form. Add also provides
**Use my definition draft** to restore a removed draft input. Revision requests
require the term, exact source definition and critique. **Clear feedback**
explicitly erases critique. Remove and **Clear optional context** preserve
writing, saved receipts and citations.

References enter this list only through **Add to assistant context** on a
revealed/displayed entry. The action enforces limits of six sources and 24,000
characters and reports a reason when blocked. The server loads stored snapshots
by ID and verifies ownership and the term. It rejects replacement text supplied
by the browser. Suggestions store the exact sources, serialized evidence block
and complete user message. Included draft/example fields are stored separately.
Omitted inputs remain null. Example context supplies input for the definition.
The response schema contains only a definition field.

**Context for this request** freezes the submitted text and chosen assistant
through preview, application and review. Later edits, lookups, context removal
or preference changes cannot alter it. Responses for new terms reconcile the
visible snapshot with the draft, example, user message and references confirmed
by the server. The stored system prompt treats source text as untrusted data and
preserves ambiguity.

Typed contributor notes may independently contain copied text. SAM does not
infer a source selection from that text. Reference selection records supplied
input. It does not establish which facts influenced the output or verify its
accuracy. The model input record is inspectable during review, separately from
contributor source declarations.

Published revision 1 exposes accepted suggestion inputs under
**Sources supplied to the model**. Contributor declarations appear separately
under **Cited references**. The PROV activity uses `prov:used` for recorded
model inputs and the revision uses `dcterms:references` for contributor
declarations. An included example has its own input entity with `prov:used` from
generation and `prov:wasAttributedTo` the requesting contributor. It is distinct
from any independently published example, which retains its human authorship and
does not acquire a model generation stamp. Accepted provenance also exposes the
entity containing the exact user message. The input example retains the
contributor attribution. A separately published example can differ from that
input. Discarded drafts retain their private input evidence without public
attribution. Later revisions do not inherit declarations or claim another model
request. Their original revision keeps its evidence. Legacy suggestions are not
backfilled.

The final answer from Agent One may also contain a **Wolfram Sources** section.
Those returned links are output evidence reported by the provider. They are
distinct from the reference snapshots SAM supplied to the request and from
citations the contributor attached at publication. SAM retains the links as
unverified output. Contributor citations require separate selection. The
provenance graph links the entities reported by the provider from the original
answer with `dcterms:references`. They have no automatic association with
request inputs or revision citations. The stored original answer preserves them
even if the contributor edits the definition before publication. Public evidence
for an accepted suggestion relates the original answer to the final revision and
identifies the publishing contributor. The stored acceptance decision occurs at
publication. The **Use this draft** action has no separate recorded timestamp.

## Definition assistant profiles

`default` uses the deployment inference configuration and displays its
configured model identity. `agent-one` uses the dedicated Wolfram Agent One
adapter. Browsers submit the approved profile identifiers. Endpoints and
credentials remain in server configuration. The factual CAG lookup is
independent of either choice and continues to use its separate key.

Contributor preferences apply to requests for new terms and revisions. The
server fixes study requests to the deployment profile. Agent One is selectable
only when configured, validated and enabled. A request retains the selected
profile, service and available model identity throughout publication.

[Inference providers](inference-providers.md#contributor-assistant-choice-and-wolfram-agent-one)
defines configuration, validation, selection and response handling.
[Metadata publication](metadata-publication.md#reference-and-assistant-evidence)
defines public provider evidence and its separation from contributor citations.

## Limits and verification

Retrieval requires a contributor profile. Limits are five calls/minute and one
active call per contributor **per provider**, with at most 100 limiter records
per app process. Deployments with multiple instances need a shared limiter for
global limits. Both adapters bound responses to 128 KiB and refuse redirects.
The reference adapter limits results to eight entries with a deadline of 15
seconds, validates source IRIs and requires a stated licence. Wolfram limits
text to 60,000 characters with a deadline of 25 seconds, with up to five saved
lookup receipts per contribution context. Review can retain those five receipts
plus the reference receipt. A model request uses at most six selected entries
and 24,000 characters of source text. A formatted long response still counts in
full. All external text renders as escaped text, without remote images or
executable markup. Manual writing and the other lookup remain available after a
provider failure.

Verify source limits with `pnpm test:source-context`. Run
`pnpm test:model-prompt-inputs` for prompt inputs and `pnpm test:references` for
provider adapters and source, release and licence display on stored citations.
Run `pnpm test:references-db` on a migrated local database with fixture
rollback, followed by the contribution, revision and graph tests. Browser checks
cover confirmation, visible previews, explicit application/Undo, retrieval and
refinement, preservation of the original response, whole/section Copy,
successful/failed Add, reveal/consulted state, citation attachment/removal,
context limits, immutable shortlist contents, publication, ownership, stale
responses, provider failure and responsive layouts. Prompt checks cover explicit
inclusion/exclusion, clearing without deleting writing or citations, immutable
submitted text, independently authored examples and the required inputs of
revision requests.

For a workstation with limited memory, `pnpm build --webpack` uses the limit of
two workers and webpack memory optimizations in `next.config.ts`. Stop an unused
development server before building, and use the production build for browser
checks when development compilation exceeds available memory. Any process memory
limit depends on the workstation configuration.
