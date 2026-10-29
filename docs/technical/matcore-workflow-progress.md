# MatCore workflow progress

## Superego release preparation, October 29, 2026

The user authorized deployment of the community review workflow for shared
testing. Migration 0075 adds six tables for review rounds, immutable item
snapshots, responses, response history, invitations and admissions. It does
not update existing content. The release will use the official backup and
migration rehearsal, then compare every pre-existing table with the frozen
backup. The source worker must be paused during those preservation checks.

The local evidence includes 55 database checks, 17 browser regression groups,
nine member/steward journey groups, shared presentation checks, TypeScript,
authentication and router checks. Full lint has no errors. The production
build, migration and browser acceptance run in CI before merge. Shared-server
acceptance will cover Quick start, review selection, Requested feedback,
mobile responses, save/reload, proposal return and private community access.
Local example records are not part of the source release or database migration.
CI and Superego acceptance are pending. Release identities and host receipts
are recorded in the internal development state.

## Compact mobile review and source guidance, October 29, 2026

Local display changes keep the main field rules in two columns and the review
filters on one row. Mobile spacing is reduced, with 44-pixel response targets.
An empty optional comment is collapsed. Saved or recovered comments open when
the item loads, and reloading a conflicting saved response also opens its
comment. Save guards, response records and revision handling are unchanged.

The shared field summary says Not recorded separately for missing structured
rules when nonblank value guidance exists. Value guidance and field rules
opens the complete specification with guidance near the top. Explicit rules
retain their values, and fields without guidance retain Not specified. No
structured rule is inferred from prose. This is generic display behavior,
with no MatCore-specific branch, migration or source rewrite. The community
and metadata user guides describe the new controls.

Verification passed:

- All 17 groups in the isolated browser regression pass. They cover compact
  320/390-pixel rules, keyboard access to guidance, touch targets, reopening
  saved comments, rapid saves, two-tab conflicts, interrupted saves, lost
  acknowledgements, navigation, proposal return, private access and cleanup.
- Nine groups pass against the actual local Phase Field examples as an ordinary
  member and steward. They include opening the original source guidance,
  saving and reloading with and without a comment, and private proposals.
  Temporary test members, responses and drafts were removed. Fingerprints of
  every existing table match the pre-test state in both browser suites.
- Shared presentation checks pass for MatCore and independent community fields.
  They cover explicit rules, missing rules with prose, blank guidance, legacy
  list values, escaping source text and leaving input payloads unchanged.
- TypeScript, scoped lint and whitespace checks pass. Screenshots at 320, 390
  and 1280 pixels show no horizontal overflow or framework error overlay.
  There were no application page errors or unexpected requests. Chrome reported
  only font preload warnings in the realistic journey. Browser plugin was not
  available, so validation used the existing Playwright harness.

For the same reference field with an empty comment, the 390-pixel page height
fell from 1,782 to 1,383 pixels. Save and next moved from 1,525 to 1,142 pixels
below the page top. At 320 pixels, page height fell from 1,860 to 1,501 pixels.
The core rules occupy 100/120 pixels at those widths, compared with 224 before.

Evidence is under `.matsci-stage/phase-field-review-layout-20261029/` in the parent
workspace, including `before.json`, `after.json`, screenshots,
`member-journey-results.json` and `regression/results.json`. The isolated preview
was stopped. The normal bounded preview is healthy on port 3109, with 23 tasks
and about 2.72 GiB of memory at the final check. No remote site has been changed.
The branch remains uncommitted and unpushed.

## Phase Field member testing and requested feedback, October 29, 2026

The user authorized shared review requests in each community member's My work.
The new Requested feedback section appears before personal drafts. Each open
round shows only the current person's progress and links to the next unanswered
item. Area filtering includes reviews for that area and community-wide rounds.
Completed responses remain available, and closed rounds leave the requested
list. This reuses the existing review records and requires no new migration or
per-person assignment rows. It sends no notifications and creates no private
drafts on behalf of members.

A steward can open Manage reviews from Quick start, name a round, select an area
and response style, clear the initial item selection, search by name, path or
definition, select references/proposals and create the review. Selection remains
intact across searches. The settings form states where the request will appear.
The user guides now describe this workflow.

Member testing found that Suggest a change could stop when the reference already
had a proposal. It now opens a private revision of that proposal or resumes the
member's existing alternative, with the original review return link. Exact
reference snapshots and the existing draft remain intact. Progress refresh is
limited to the requested-feedback query when the section opens, without
invalidating the whole community layout after each vote.

Two realistic proposals are retained in the local MatCore community under Local
example contributor. They clarify `numerical-method.grid-spacing` and correct
the guidance for `numerical-method.time-step-size.value`. MatCore Table PF-5
currently refers to grid spacing in the value guidance for the time-step field.
The proposed correction retains the separate unit field and numerical value.
The grid-spacing proposal requests context for directional or summary measures
and varying meshes. Both keep the original source association, recorded versions
and change rationale. They are local proposals for consideration, not MatCore
approvals. No live site was modified and no example votes are retained.

The retained review, Phase Field spacing and time increments, contains both
reference fields and both proposals. It was created through the steward UI.
A pre-seed database backup is retained outside Git. Existing rows in 11 protected
content/history tables were checked unchanged during seeding, including drafts,
source baseline, revisions, provenance, dictionary entries and survey records.
The subsequent member journey removed its temporary member, responses and private
alternative, then verified all table fingerprints against the pre-test state.

Verification passed:

- Eight realistic browser groups pass against the existing local MatCore data,
  using an ordinary member and a steward at 1280/1440-pixel desktop widths and
  a 390-pixel mobile width. They cover selection, shared requests, personal
  progress, saving/reloading, response labels, private alternatives and return,
  resuming through an existing proposal, attributed organizer results and cleanup.
- The database suite passes 55 checks, including requested-review scope,
  progress isolation, closure, privacy and the pending-proposal return path.
- TypeScript, scoped lint and public-router boundary checks pass. No application page errors or blocked
  unexpected requests occurred in the realistic journey. Chrome emitted font
  preload warnings. Screenshots show no framework overlay or horizontal overflow.
- All 16 groups in the full browser regression pass on the isolated local
  preview, including signup continuation, explicit joining, private access,
  invitation revocation, rapid clicks, conflicts, interrupted saves and fixture
  preservation. The normal preview has email signup disabled, so that check
  requires the isolated configuration. No email or Google provider call was made.
- An intermittent invitation-click failure occurred during extended browser
  runs. Review selection now changes the address without remounting the settings
  page, and invitation creation remains disabled until organizer permissions
  have loaded. The final complete regression passes without click instrumentation.
  The item selector also distinguishes reference and proposal versions.

The mobile response form still requires scrolling below the field rules. Some
structured rule summaries say Not specified while the original specification
contains prose guidance. These were presentation follow-ups, addressed in the
compact review entry above without a baseline rewrite. Evidence is under
`.matsci-stage/phase-field-member-review-20261029/` in the parent workspace.
It includes `examples.json`, `example-review.json`, `member-journey-results.json`
and desktop/mobile screenshots. The isolated test preview was stopped and the
usual bounded local preview restored on port 3109 with its original signup
configuration. Local code remains uncommitted and unpushed.

## Community reviews implementation, October 29, 2026

Implemented and tested locally on `feat/community-review-quick-start`. The shared
community template now starts with Quick start, then Review, Standard or
Vocabulary, My work, People and More. Area selection stays with review and
proposal navigation. Quick start offers Review and respond, Suggest a change
and Continue my work. The same components serve ordinary vocabulary communities.

A review round freezes its target versions and response wording. Organizers
select reference fields, pending metadata proposals or ordinary definition
revisions. The assessment preset uses Suitable as written / Needs revision /
Unable to assess for fields and Support this change / Needs revision / Unable
to assess for proposals; an upvote/downvote preset is also available. The
participant sees one item, optional comments, Save and next, Skip for now and
Not yet reviewed / My responses / All items. Repeated field names show their
path in the item selector. Draft return links save before returning to review.

Responses retain the respondent, exact target, time and edit/withdrawal history.
Repeated requests are idempotent, concurrent edits detect conflicts, and failed
saves can be retried after reload when tab storage is available. Participants
see totals and their own response; organizers can inspect identified responses.
Review responses do not accept proposals or alter existing definition votes
or surveys. Accepted working-version overlays remain in Standard; the initial
review picker distinguishes reference fields and pending proposals.

Conference invitations expire in 1–30 days and can be revoked. Authentication
retains the review destination, followed by an explicit Join action. Admission
grants membership in the whole community, not only the selected area. A public
invitation page exposes no private field content. Closing a round stops further
responses and admissions. Existing invitation and approval paths are preserved.

Migration 0075 adds six tables for rounds, exact target snapshots, current
responses, response events, invitation hashes and admissions. The isolated
local rehearsal preserved all 67 original table fingerprints. Applying 0075
to the existing local MatCore preview database preserved all 68 original tables.
A subsequent local setup created **Phase Field feedback** with 47 reference
fields and promoted only the local community creator's membership from member
to steward so review settings can be tried. The other 67 tables, including
existing drafts, sources, provenance, baseline and survey data, remained equal
to their pre-migration fingerprints. No reference was reimported.

Verification passed:

- 46 new database checks cover snapshots, permissions, saved response versions,
  replayed requests, withdrawals, identified results and bounded admission.
- 14 new browser groups cover desktop/mobile, rapid clicks, saving/reloading,
  two-tab conflicts, interrupted requests, lost acknowledgements, guarded
  navigation, private field drafts and return links, filters, invitation/signup
  continuation, explicit joining, revocation, organizer results and closure,
  ordinary communities, and complete fixture cleanup with preservation checks.
- The existing standards database suite passes 54 checks plus its concurrency
  regression; the existing standards browser suite passes all 13 groups,
  including working versions, proposals, community releases and privacy.
- Authentication plumbing, invitation onboarding, public-router boundaries,
  migration ordering, TypeScript and scoped lint pass. Browser fixtures use
  local sessions; no real Google authorization or email delivery was exercised.

The local preview is available on port 3109 in `matsci-matcore-preview.service`,
with CPU quota 200%, memory limit 6 GiB, no swap, 128-task limit, Node heap
3072 MiB and two worker threads for the configured pools. Its existing dedicated
PostgreSQL cluster runs on port 55447 in `matsci-matcore-db.service`. The isolated
preview on port 3110 has been stopped. Backups and evidence remain outside Git
under `.matsci-stage/community-review-local-20261029/` in the parent workspace,
including `ui/results.json`, `local-review.json` and `preservation-final.json`.

The community and MatCore guides describe the new workflow. No commits have
been pushed and no Superego or Ego changes were made. Before deployment, review
the migration and access changes, run CI, then verify real signup continuation
and conference admission on Superego with an authorized test account.

## Phase Field conference participation design, October 29, 2026

The user requested a simpler community entry for Daniel's conference, with a
shareable route to Phase Field, visible voting, proposed updates and a personal
queue of items not yet reviewed. Votes must identify their respondents. This
does not mean rating contributors.

Read-only Ego review as an ordinary MatCore member confirmed that Phase Field
selection is lost on the Proposals tab. The selected profile has 47 fields. The
metadata proposal component supports comments and steward decisions but no member
vote. Existing definition votes identify their respondents and exact revisions,
but independent metadata proposals do not necessarily have a dictionary revision.
The existing survey walkthrough is tied to dictionary terms and needs a separate
target model for metadata feedback.

The proposed design uses a shared Quick start, area selector, review queue,
response panel and saved progress, with a MatCore adapter for profiles and
versioned field context. A conference link should bypass general setup and retain
the intended review destination through authentication and admission. Private
communities currently reject open join links, so conference admission must be
an explicit policy rather than a filter or navigation shortcut.

The detailed findings, proposed flow, pending choices and acceptance plan are in
[the community interface inventory](community-interface-inventory.md#conference-participation-review-october-29-2026).
The user chose existing fields and proposals, and ordinary MatCore membership
with Phase Field as the conference destination. The user requested less casual
response wording and a configurable review style. The proposed reusable panel
uses Suitable as written / Needs revision / Unable to assess for fields and
Support this change / Needs revision / Unable to assess for proposals. Authorized
organizers select the preset for a round before responses begin. The selected
wording and meaning are retained with each round version. This configuration and
the bounded private-community conference invitation require implementation.
No production records, memberships, votes, proposals or application code changed.

## Community visibility follow-up, October 26, 2026

Browser acceptance found that a public community could not become members-only.
The privacy operation used SPARQL Update, while the deployed Fuseki configuration
provides authenticated Graph Store writes only. The failed operation preserved
the public visibility setting and displayed an error. Existing members-only
content remained inaccessible to anonymous visitors.

The local correction replaces the five owned named graphs with empty Turtle
through the same Graph Store endpoint used by projection. The shared privacy
lock remains held until removal succeeds and the visibility transaction commits.
A failed or partially completed removal still prevents the visibility change.
Unrelated named graphs are outside the request scope.

Validation includes 73 database privacy checks with rolled-back fixtures, rejected
and partially completed remote writes, TypeScript and scoped lint. The graph
database suite passed against a temporary Apache Fuseki 6.2.0 instance using the
query and Graph Store configuration, including removal and reprojection. The
instance was stopped after testing. This correction requires its own CI and
release before the live private-community workflow can pass acceptance.

The UI checks also identified two follow-ups. Metadata drafts have no discard
control, so disposable verification drafts require protected cleanup. Switching
between Working version and Reference resets the selected field. Neither issue
changed existing draft contents or the source baseline during these checks.

## Shared metadata field rules, October 24, 2026

Local work on `feat/metadata-field-rules` makes Requirement, Repeatable field,
Data type and Value form available directly below the definition. All
communities with metadata tools use the same controls. Value form distinguishes
Single value, List and Array independently of field repeatability. Units,
allowed values, example values, value guidance and Notes remain in expandable
details. Information popovers explain the distinctions.

Imported fields show the source rules below the controls and offer an
expandable source/proposal comparison. Published proposals display their main
rules below the definition and retain the full specification and comparison.
Independent fields have no invented source or MatCore context.

Value form and Notes are optional payload properties with no defaults added
to old payloads. Legacy `valueType: list` displays as a List with an unspecified
item type. Only editing the type or form writes the separate representation.
Other missing forms stay unspecified. Source import construction and baseline
fingerprints are unchanged. No database migration or remote deployment is
included. The user and reference guides describe these controls and how older
source notes remain in their original evidence.

Verification passed:

- The production browser suites pass 23 groups: workflow 13 and catalog 10.
  The workflow covers MatCore and independent community fields, first-click
  save/navigation, reload, list/array/single-value changes, repeatability,
  allowed values, units, Notes, two-tab conflicts and interrupted saves.
  Publication, historical revisions and JSON exports retain the rules,
  citations and exact source baseline. Generic fields keep no standard context.
- The catalog remains read-only. Browsing creates no drafts. Propose a change
  resumes the contributor's existing draft, and source rows remain unchanged.
  Desktop, 390-pixel and 320-pixel checks pass, including the expanded source
  comparison, keyboard help and navigation. Screenshots were inspected. Final
  browser runs report no unexpected errors or blocked requests.
- Workflow database tests pass 119 checks and catalog database tests pass 93,
  all with transaction rollback. Compatibility, presentation, source parsing,
  recovery, TypeScript, scoped lint, formatting and guide rendering pass.
  The bounded production build passed, peaking at 3.2 GiB with no swap.
- Final counts and row fingerprints match the initial snapshot across all 67
  public tables, including 248 private drafts, 248 source occurrences and their
  existing workflow history. All temporary browser fixtures were removed.
  The local preview returns HTTP 200 with one process and 11 threads. Its
  two-CPU quota, 6 GiB memory cap, zero swap, 128-task cap, 3 GiB Node heap and
  two-thread worker pools remain applied, with no OOM or task-limit events.

The first browser run ended when Chromium crashed while opening a test tab
under a 128-task test-unit cap. Cleanup and retained-record checks passed.
The rerun used a 256-task cap for the test browser only and reached publication.
It exposed an ambiguous historical-format test locator because the new source
comparison also contains that value. Scoping the assertion to the published
specification fixed the test. The full final suites passed. The preview's
128-task cap was unchanged. Failed-run and final evidence is preserved under
`.matsci-stage/metadata-field-rules-20261024/` outside Git. The Browser plugin
was unavailable, so browser acceptance used the existing Playwright harness.

This remains a local change. A later deployment must ship the updated payload
reader with the editor because older readers reject the new optional keys.
No existing baseline needs rewriting or reimporting.

## Scope

Implement a local metadata-field workspace with Definition, Field specification
and Sources & history tabs, consolidated into each community. Communities can
define independent metadata fields or opt into MatCore. Browse the pinned
MatCore 0.3.0 source as a versioned reference catalog and prepare individual
private proposals, with Minimal and DFT first in the review list. The initial
all-section draft import is preserved; bulk preparation remains a secondary action.
Publication creates a MatSci-SAM proposal; the attributed source baseline is
retained. Ordinary vocabulary entry and the historical 2025 MatCore catalog
remain separate.

The first version supports explicit field rules, citations, saved drafts,
conflict recovery, proposal publication and recorded local review decisions.
Team sharing, assigned review, notifications, AI assistance for field proposals
and general dataset validation are later phases. Their absence must be clear
in the interface. Future team use must preserve existing field identities,
visibility and the authority recorded for each past decision.

## Implementation — 23 October 2026

- Branch: `feat/matcore-workflow`, based on reviewed development code.
- Implemented the private workspace, tabbed editor, proposal review and
  exact-revision JSON export. The ordinary glossary links a published field
  entry to its specification; general ontology lookup stays in the vocabulary
  workflow.
- The pinned source contains seven profiles, 25 tables and 249 source rows,
  resolved to 248 contextual fields. A repeated MD parent row remains source
  evidence. Nested paths, profile inheritance and ambiguous source guidance
  are preserved without inferring missing value types.
- Migration `0070_matcore_field_workflow` adds source releases, contextual
  source occurrences, stable fields, private specification drafts, immutable
  specification revisions and an append-only workflow event history. Drafts
  and revisions independently pin their profile release, including new local
  fields that have no imported field baseline.
- A dedicated local PostgreSQL 17 test cluster was created; no remote database
  is used for implementation or tests.
- The source manifest must preserve nested context, inherited profiles and
  unspecified constraints. Matching short keys do not establish field identity.
- The ordinary import quota remains unchanged. A separate bounded,
  resumable standards import must retain the complete source inventory.
- Complete public reproduction of the source corpus awaits confirmation of
  source reuse/attribution terms. Draft import does not publish its contents.
- Source excerpts are escaped as text. Public proposal review discloses the
  retained baseline and citations; exporting a proposal pins an exact
  definition and specification revision. Local acceptance records the policy
  and reviewer, without claiming upstream MatCore adoption.
- The local preview has a MatCore Development community and vocabulary with
  all 248 drafts owned by an ordinary local developer account. No imported
  field has been publicly published in that retained preview. Temporary
  publication tests use separate fixtures and remove them afterward.

## Verification record

- A fresh PostgreSQL 17 database accepted all 71 migrations and the database
  invariants. The first run exposed a trigger alias collision; it was repaired
  and the full migration rerun from an empty database.
- The 76-check database workflow suite passed with rolled-back fixtures:
  complete resumable import, ownership, save retries, conflicts, publication,
  immutable evidence, local review, historical status, withdrawal, profile
  pins and compatibility with ordinary definition edits and deletion.
- Existing term-draft, private import, vocabulary and term-metadata database
  suites passed, followed by the database invariants.
- Source manifest and parser reproducibility, editor presentation, auth
  return paths, draft queue/navigation, historical dictionary metadata,
  public router surface, migration journal and migration consistency passed.
- Browser regression checks passed private import and repeat import,
  first-click save/navigation, lost-response retry, two-tab conflict recovery,
  explicit publication with baseline/citation provenance and exact JSON,
  specification-only revision and historical mobile viewing. A development
  server run failed its final guard because concurrent development hot reload
  triggered a Next.js initialization error. The rerun against the production
  build passed all eight behavior groups, with no browser errors, provider calls
  or unrelated writes; fixtures were removed and invariants passed.
- The initial browser test found input could arrive before editor hydration.
  Inputs now remain disabled until their save handlers are ready; the
  regression asserts that the first edit replaces the previous value.
- Full TypeScript checks and the production build pass. The bounded build
  used two workers, peaked at 2.6 GiB and used no swap. Full lint reports no
  errors and two existing TanStack compiler warnings.
- Independent review found browser Back could unmount a failed-save editor
  without preserving its unsaved payload. The fix keeps a validated recovery
  copy scoped to the account, draft and browser tab. It preserves the original
  version, requires a confirmed save, and retains copyable writing if another
  tab publishes. Storage failure produces an explicit warning and uses app
  memory for navigation recovery. Unit tests cover Unicode payloads, stale
  editor acknowledgements and reverting text during an unacknowledged save.
- The final production browser run passed both added recovery cases: failed
  save → browser Back → return → explicit save, and return after another tab
  saves a newer version. Conflict cancellation, explicit discard and resumed
  saving passed. Shared term-draft queue, navigation and persistence tests
  also passed after the additive recovery option. Final independent review
  found no remaining actionable issues in the recovery change.
- Final TypeScript, scoped lint and production build passed after the recovery
  change. The production browser evidence is in
  `.matsci-stage/matcore-dev/ui-production-evidence/results.json` (eight passed
  groups, no blocked requests or browser errors, fixture cleanup confirmed).
  Database invariants passed afterward. The retained local database has 248
  private drafts and zero published terms or field revisions.

## Local review

Open `http://127.0.0.1:3109/communities/matcore_development?view=vocabulary`
to browse the source catalog, or select My work for the local developer's
existing drafts. `/metadata/workspace` now offers a workspace chooser.
The dedicated `matsci-matcore-preview.service` runs the verified production
build against the isolated PostgreSQL database on port 55447. It has a two-CPU
quota, 6 GiB memory limit, no swap, 128-task limit, a 3 GiB Node heap and
Rayon/Tokio/UV thread pools of two. The ordinary preview remains stopped.
No periodic monitoring or remote deployment was started.
The final consolidation health check returned HTTP 200; the preview used one
process and 11 threads, about 212 MiB of memory (262 MiB peak), with no OOM or
task-limit events. The final build peaked at 2.5 GiB and used no swap.

The user guide is `docs/guide/matcore-workflow.md`. Review the common core and
DFT drafts locally before preparing a Superego release. Source reuse terms
remain a separate prerequisite for complete public reproduction of the corpus.

## Community workspace consolidation — 23 October 2026

Chris approved implementing the consolidation locally, including metadata
fields without MatCore context. The community is now the workspace; no second
workspace identity was introduced.

- `/communities/[slug]` has Overview, Vocabulary, My work, Collections and
  People views, plus Surveys when relevant. Existing membership, invitation,
  collection and survey controls remain available in their respective views.
- My work resolves the community's vocabulary on the server. Ordinary term
  entry, draft imports, personal term drafts and metadata drafts use that
  destination. Draft/import filtering happens in SQL before list limits;
  drafts remain owner-only. Consolidation grants no new review authority.
- Stewards or site administrators can explicitly enable metadata development.
  MatCore is a separate opt-in; enabling metadata does not import a standard.
  New metadata fields default to no standard context. MatCore profiles are
  available only when that capability is enabled. Standalone vocabularies
  retain an explicit workspace fallback, managed by site administrators.
- Migration `0071_community_metadata_workspace` adds vocabulary settings and
  permits absent standard context as a matched null profile/release pair.
  Imported occurrences still require their original pinned release. Existing
  MatCore workspaces are backfilled from recorded fields, without guessing
  from names. Disabling tools stops new creation/imports while preserving
  existing drafts, revision work and publication.
- Generic fields, public specifications and JSON exports do not claim a
  MatCore baseline or adoption. The reusable editor retains Definition,
  Field specification and Sources & history. General ontology lookup remains
  in ordinary vocabulary entry.
- Existing draft, field and revision URLs and browser recovery keys are
  unchanged. The legacy workspace URL redirects when its vocabulary identifies
  a community, or offers an explicit chooser. Editor return links lead to the
  owning community's My work view. Public historical catalog routes remain.
- Shared drafts, team review queues and notifications remain later work.

### Consolidation verification

- A private full database backup was taken before migration 0071 in
  `.matsci-stage/matcore-dev/community-consolidation/before-0071.dump`.
  After migration, counts and every row fingerprint matched in all **64
  pre-existing public tables**, including the 248 drafts and their provenance.
- All 72 migrations and database invariants pass. The expanded metadata
  database suite passed **114 checks**, with rolled-back fixtures, including
  generic fields, capability changes, ownership, provenance and publication.
- Ordinary term-draft database tests and at-capacity import reads pass. The
  latter cover ten imports, 1,000 rows and 50 drafts, with vocabulary-scoped
  reads and owner isolation (seven list queries, eleven overview queries).
- TypeScript, scoped lint, auth return-path tests, community rules and generic
  editor presentation checks pass. Independent review identified a capability
  locking-order issue; the fix uses the same community/vocabulary/membership
  order as membership changes, with removed-steward regression coverage.
- Independent UI review found two navigation edge cases, both fixed: chooser
  links now resolve the actual community slug by ID; an active profile filter
  remains available when tools are disabled and the result is empty. Focused
  presenter regression tests cover differing community/vocabulary slugs,
  missing mappings and standalone vocabularies.
- The final bounded production build and full TypeScript checks pass. Full
  lint has zero errors and the same two existing TanStack compiler warnings.
  Source-manifest, generic/MatCore presentation and draft-recovery unit checks
  pass. No extra dependencies or inference-provider calls were required.
- The production HTTP/browser suite passed **all 13 behavior groups**:
  all-section/repeated private import; save/navigation; lost-response retry;
  failed-save Back recovery; stale recovery; two-tab conflict recovery;
  MatCore publication/provenance/JSON; historical mobile revision; steward
  metadata-only opt-in; generic-field save/reload; two-community ownership
  isolation and private API denial; generic publication/citation/JSON; and
  ordinary-term create/list/resume/publish in the selected vocabulary.
- Earlier runs exposed harness issues: streamed Next.js not-found responses
  can have HTTP 200, an added fixture membership needed explicit teardown,
  accessible labels made a text selector ambiguous, and resumed term editors
  already pass the confirmation step. The final test checks the private API's
  404/NOT_FOUND and rendered not-found page, uses semantic selectors, asserts
  restored writing, and records cleanup failures separately. The two retained
  fixtures from the first failed cleanup were removed with exact identity and
  ownership guards; preservation checks passed immediately afterward.
- Final browser evidence:
  `.matsci-stage/matcore-dev/community-consolidation/ui-passed-evidence/results.json`.
  It records 13 passing groups, no blocked provider requests, no browser errors
  and successful fixture cleanup. Database invariants passed afterward, and
  a fresh fingerprint comparison again matched **all 64 pre-existing tables**.
  The retained preview still contains 248 private drafts and no published terms
  or field revisions. No remote service, database or release has changed.
- Manual signed-in checks confirmed Overview, Vocabulary, My work, Collections
  and People navigation. The real developer account remains an ordinary
  member. Preview screenshot and one-time health record are in the same
  consolidation evidence directory. Updated user documentation covers the
  unified workspace, explicit capabilities, generic fields and preserved links.

## Header navigation follow-up — 23 October 2026

- Kept the Vocabulary, Participate, Help & Guides and About categories.
  Participate now has one **Community workspaces** directory link. The
  selected-community menu has one **Open workspace** shortcut to My work;
  duplicate All communities and legacy survey-anchor shortcuts were removed.
- Removed the header's **Develop a metadata field** action, which could open
  a workspace without enabled metadata tools. Field creation stays in the
  community's My work view; **Metadata field catalog** clearly names the
  public browsing destination. The account menu now links **My term drafts**
  to personal term/import drafts; field drafts remain within each workspace.
- Clarified the community selector as saved context for browsing and new
  contributions. It retains its existing save/reload behavior, so choosing
  context does not silently navigate away from a draft. Choices disable while
  the change is saving.
- Fixed the two-selected-category issue: community work and legacy private
  workspace routes belong to Participate; public metadata catalog/field
  routes belong to Vocabulary. Creation task selection remains unchanged.
- Updated community documentation and interface-state regressions for the
  current community tabs. Interface-state tests, scoped lint, full TypeScript
  and the bounded production build pass (2.4 GiB peak, no swap).
- The focused production UI suite passed all **seven groups**, covering
  signed-in desktop menus, first-click term-draft navigation, all
  **22 header destinations returning HTTP 200**, saved context switching,
  exactly one active primary category, mobile menu parity/dismissal at
  390 × 844, and anonymous navigation. Desktop viewport was 1440 × 1000.
  The repository Playwright harness was used because the Browser plugin was
  unavailable; manual in-app checks also verified the directory and workspace
  links with no console warnings or errors.
- Evidence: `.matsci-stage/matcore-dev/header-navigation/results.json` and
  `mobile-navigation.png`; the real community menu screenshot is in
  `community-consolidation/header-community-menu.png`. No blocked external or
  provider calls or uncaught browser errors were recorded. Disposable fixtures
  were removed, database invariants passed, and all 64 retained table
  fingerprints still match. The existing 248 drafts and provenance are intact.
  Changes remain local on `feat/matcore-workflow`; no remote deployment.

## Community interface review — 23 October 2026

- Reviewed navigation and surrounding contribution workflows in response to
  Chris's request for in-page navigation and a general usability inventory.
  The [inventory and implementation plan](community-interface-inventory.md)
  records the findings, recommended layout, priorities and acceptance checks.
- In the rendered local My work view at 1280 × 720, the document is 5,195
  pixels tall, with 40 of 248 field drafts on the page. The field list begins
  at vertical position 939 pixels; pagination is only below it. Screenshot
  and DOM measurements are in
  `.matsci-stage/matcore-dev/community-interface-inventory/`.
- Recommend an On this page navigator for long views with several sections,
  compact creation/empty states, contextual return links, and search/filtering
  for long draft and vocabulary lists. Preserve the existing community views
  and metadata editor tabs. The wider source review also covers People,
  imports, Profile and collection detail pages.
- This was a read-only application review and documentation update. The new
  navigation design is not implemented or acceptance-tested. No content,
  services, database rows, draft provenance or remote releases changed.

## Community section navigation — 23 October 2026

Chris approved implementing the first inventory delivery locally: section
navigation, a compact My work layout and contextual return links.

- Added a reusable On this page navigator to My work and eligible People
  views. It uses a sticky side column on desktop and a bounded expandable
  control on small screens. The selected section is marked without adding
  history entries during scrolling. One-section views omit the navigator.
- Section links preserve the current query, use stable IDs and share the
  existing arrival highlight. Targets receive keyboard focus; permitted
  collapsed settings open when targeted. Search-parameter changes now trigger
  arrival handling, including transitions between community views.
- Compact My work actions and empty states bring saved metadata work forward;
  workspace configuration follows contributions. MatCore imports remain
  available to permitted contributors. Disabled creation tools preserve
  access to existing drafts and proposals.
- Return links carry the originating community, profile filter, result page
  and section through ordinary draft creation/resume, metadata drafts, guided
  imports and import review. Server resolution checks the record's actual
  vocabulary; invalid return destinations fall back to a trusted local path.
  Existing save-before-navigation and recovery guards are retained.
- The local MatCore page at 1280 × 720 now places the field-draft heading at
  489 pixels, previously 939; the first field row begins at 665 pixels. Manual
  checks confirmed a section jump focuses the heading at 96 pixels below the
  viewport top and applies the arrival highlight. Existing 248 drafts remain
  private. Screenshot: `community-sections/matcore-work-desktop.png` under
  `.matsci-stage/matcore-dev/`.
- Navigation/authentication helper tests, interface-state checks, metadata
  presentation, term queue/persistence and field recovery unit checks pass.
  Scoped lint and the final bounded production build pass; the build peaked
  at 2.6 GiB with no swap. Independent source review found an offscreen focused
  heading could incorrectly remain current at the page bottom; this was fixed
  and added to the browser regression.
- Browser acceptance first passed desktop section jumps, passive scrolling,
  fragment history, People view transitions and 390-pixel mobile navigation.
  A later field-return check exposed duplicate fragments in the installed
  Next.js route cache after revisiting an initially anchored URL. Save failure
  and retry preserved writing. Community return links now use ordinary document
  navigation after a successful save, avoiding that route-cache path. This
  applies to term drafts, already-published drafts, metadata fields, guided
  setup and import review; global fallback links retain client navigation.
  Independent review confirmed that failed/conflicted saves still block return.
- Final browser acceptance passes all **nine groups** at 1440 × 1000 desktop
  and 390/320 × 844 mobile, with empty-state checks at 1280 × 720. Coverage
  includes pointer and keyboard jumps, focus/highlight, direct and repeated
  fragments, passive scrolling, Back/Forward, query-plus-fragment transitions,
  bounded mobile navigation and reduced motion. Contextual returns preserve
  filters/page/section through a real pending term save and a deliberately
  failed metadata save followed by retry. Import returns, member/anonymous
  visibility, disabled creation and compact empty states also pass.
- Browser plugin not available; used the existing Playwright fixture helpers
  and added `pnpm test:community-sections-ui`. The final run has no unexpected
  browser errors, provider calls, external requests or unrelated application
  writes. One network failure is deliberately injected to verify recovery.
  A premature URL assertion in the harness was corrected to wait for the term
  editor before capturing its address; the complete suite then passed.
- All disposable fixtures were removed. A separate final comparison confirms
  every row in all **65 pre-existing public tables** is unchanged, including
  all 248 private MatCore drafts, their fields and workflow events. No published
  fields or terms were added. Results and six screenshots are in
  `.matsci-stage/matcore-dev/community-sections/ui-evidence/`; the full retained
  table comparison is `community-sections/final.json`.
- The preview is active on port 3109 under the existing resource limits;
  the final runtime sample had 11 tasks (threads included), about 187 MiB
  current memory and 192 MiB peak. These are local Chromium checks; other
  browsers, physical mobile devices and remote releases were not tested.
- No remote deployment, schema migration or provider call is part of this
  change. Search/filter additions from the inventory remain later work.

## Versioned MatCore catalog — 23 October 2026

Chris approved implementing the preserved catalog and Propose a change locally.

- Community Vocabulary now starts with a versioned, read-only MatCore source
  catalog when available. The catalog uses recorded releases and occurrences,
  with the bundled snapshot as a read-only fallback before first use. GET
  requests never create fields, drafts or workflow events. Only actual source
  versions are listed; the separate 2025 catalog keeps its identifiers.
- Source detail includes definition, field rules, profile context, interpretation
  notes and source attribution. Propose a change creates one private source-based
  draft. Continue my draft resumes the owner's existing draft unchanged,
  including earlier imported/edited drafts. Retry and duplicate clicks reuse
  the same draft. A published local proposal is linked separately; further
  revisions use its existing workflow rather than silently resetting it.
- Returning from the editor preserves the exact source version and occurrence,
  profile filter and result page. The server matches that context to the owned
  draft and its actual community. Invalid context falls back to My work. Save
  guards and recovery apply to catalog returns as they do to work returns.
- My work links to the catalog and keeps the former all-section importer under
  Prepare drafts in bulk. Existing drafts, event history and source attribution
  remain intact. Disabled creation tools retain the existing source catalog.
- No schema migration is needed. The new database suite passes **81 rollback-only
  checks**. Catalog return/authentication tests, existing auth/navigation helpers
  and workspace presentation checks pass. The new database and navigation
  suites are included in PR verification; remote CI has not been run for this
  uncommitted local work.
- The final production build and TypeScript checks pass with two build workers,
  2.5 GiB peak memory and no swap. Scoped lint and whitespace checks pass.
  Independent review found no remaining actionable catalog or return-path issues.
- All **nine catalog browser groups** pass: read-only browsing and DFT pagination;
  pinned source attribution; single-field creation and immediate save/return;
  edited-draft resume/reload; two-owner privacy and direct-editor access denial;
  390/320-pixel navigation; anonymous sign-in continuation; invalid source and
  return-context rejection; and preservation of the independent 2025 catalog.
  Mobile screenshots exposed long community-title clipping; wrapping was fixed
  and the final run checks rendered text bounds as well as page overflow.
- Final evidence is in
  `.matsci-stage/matcore-dev/matcore-catalog/ui-final-evidence/results.json`.
  There are no unexpected browser errors or provider requests. Expected 404
  responses belong to invalid/private-route tests. The suite created two
  fixture drafts for one field, performed one save, then removed only its
  fixture records. Source releases and occurrences were never deleted.
- A separate final comparison matches every retained row in **all 65 public
  tables**, including 248 existing drafts, 248 fields and 248 workflow events.
  No published terms or specification revisions were added to the retained
  preview. Preservation records are in
  `.matsci-stage/matcore-dev/matcore-catalog/before.json` and `final.json`.
- The local preview is active on port 3109. Its final one-time health sample
  records one process, 11 threads, about 117 MiB memory (188 MiB peak), and no
  OOM or task-limit events. Existing resource limits remain in effect. User
  guides and the development plan describe the catalog-first workflow.
  No remote release or periodic monitoring is included.

## Documentation and host rollout preparation, 23 October 2026

Chris requested the same MatCore catalog and proposal setup on Superego and
Ego when the feature is deployed. The
[deployment checklist](matcore-deployment.md) records schema changes,
independent community setup, preserved source versions, existing draft and
provenance checks, and acceptance in Superego before Ego. Local developer
accounts and the 248 local drafts are excluded from deployment data.

The user guide, communities guide, reference page and guide index distinguish
preserved source entries, private drafts and local proposal revisions. They
explain resuming earlier imports and retaining the original source association
when later snapshots become available. Internal deployment and development
plans now use catalog browsing and individual proposals as the default.
Bulk import remains an optional action on each host.

| Host     | Inventory and migration review     | Community catalog setup | Preservation and UI acceptance |
| -------- | ---------------------------------- | ----------------------- | ------------------------------ |
| Superego | Pending                            | Pending                 | Pending                        |
| Ego      | Pending, after Superego acceptance | Pending                 | Pending                        |

The existing source reuse prerequisite applies before remote deployment.
Source catalog API reads are public. Workspace settings do not restrict
access to source text. The rollout checklist also distinguishes a bundled
snapshot from an existing stored baseline and requires checking release hashes
before rollout. No remote inventory or deployment was performed in this
documentation update.

The three updated guide/reference pages render through the application
documentation renderer, with unique heading IDs and the MatCore guide present
in navigation. All 47 local links in the updated guides, runbook and MatCore
backlog section resolve. Independent review checked the deployment description
against migrations and read/import behavior. Whitespace checks pass. The wider
backlog contains a pre-existing broken paper README link outside this change.
Application tests were not rerun for these documentation edits.

## Superego release preparation, 23 October 2026

Chris requested deployment to Superego after CI passes, catalog setup there
and verification that existing drafts and provenance are preserved. Ego is
outside this release request. Preparation is in progress on
`feat/matcore-workflow`.

- PR verification now runs the MatCore workflow, catalog, community header
  and section-navigation browser suites sequentially against the production
  build. The workflow suite installs the preserved baseline required by the
  catalog suite. Each suite has a separate evidence directory.
- Fresh-database review confirms the new database suites use rollback-only
  fixtures. Static source/manifest, navigation, auth/profile, interface,
  recovery and migration checks pass. Full lint has no errors and the same
  two existing TanStack compiler warnings.
- Independent review found no blocking schema or ownership regression. A
  correction for selected-revision history is being verified before release
  so the display does not omit an older revision after 200 newer events.
- Source reuse confirmation remains pending before publishing the bundled
  text. Superego SSH timed out outside the sandbox. Host inventory,
  preservation baseline, CI and deployment results remain pending.

## Community permissions and protected sources, 23 October 2026

Chris changed the release scope before any commit or push. The MatCore source
text will be kept outside the public repository. Communities will have Public
and Members only content settings. A restricted community will show its name
to visitors, with a way to request access. A steward or site administrator
will review requests. This is now part of the implementation before Superego
release, replacing the proposed public bundled source catalog above.

Implementation is in progress. The access boundary covers direct pages, API
reads and writes, search, source downloads, exports and public graphs. Installed
MatCore releases require an explicit grant to a vocabulary. Enabling workspace
tools alone will not grant access to a protected source. Personal drafts remain
owner-only, and removal from a restricted community will also remove access to
its content without deleting the person's saved records.

A protected local database backup and fingerprints of all original columns in
65 tables were captured before the permissions migration. Existing source
snapshots, drafts and provenance must remain unchanged. CI will use invented
source text with a separate release identity. The retained real MatCore
snapshot will not be copied into browser-test artifacts or public fixtures.

The selected-revision history correction passed 116 rollback-only database
checks. Migration 0072 has now passed 70 rollback-only access and preservation checks
and independent review. It was applied locally after the backup. All original
columns and rows in 65 tables still match their pre-migration fingerprints.
MatCore workflow and catalog database regressions pass 116 and 89 checks,
respectively. Browser and wider content-access regressions remain pending.
An additional collection scope is being added so collections created inside a
restricted community inherit access without changing existing public worklists. The Superego release launcher is on hold until the access tests pass.
Chris also requested a separate screenshot presentation for Jane and later the
MatCore team. The separate presentation chat completed eight editable slides with four
local screenshots and speaker notes, including a private Google Slides copy.
It distinguishes the tested local catalog from access controls in progress. No GitHub push, remote
migration, catalog installation or deployment has occurred.

## Verification checklist

- [x] Complete, reproducible source manifest and identity tests.
- [x] Additive migration, constraints and immutable-source tests.
- [x] Private import, retry/idempotency, ownership and capacity tests.
- [x] Draft saving, two-tab conflicts and interrupted-save recovery.
- [x] Publication with pinned definition/specification revisions and citations.
- [x] Local review authority and source baseline preservation.
- [x] Browser checks of the tabbed workflow and ordinary-term regression.
- [x] TypeScript, lint, migration metadata and relevant regression suites.
- [x] Community-scoped workspace, generic metadata and retained-row preservation.
- [x] Community section navigation, compact My work and guarded contextual returns.
- [x] Versioned source catalog, individual proposals and retained-draft preservation.
- [ ] Superego release and acceptance testing (later deployment).
- [ ] Ego release and reviewed real content (after Superego).

This document records implementation and verification as they complete; an
unchecked item is not a passing result.

### Privacy migration verification — 23 October 2026

- Applied the independently reviewed `0073_community_collection_scope` to the
  backed-up local database after 106 rollback checks. Every original column
  and row still matches the pre-permissions baseline in all 65 original tables.
- Existing collections retain their public scope. New collections created in
  a members-only workspace inherit that community's access. Private surveys
  accept only terms from their own community vocabulary; unsafe legacy scope
  causes migration to stop without changing survey history.
- Live membership mutation checks passed 12 regressions, including revoking
  a steward while an access grant is queued. MatCore workflow (116 checks),
  catalog (89 checks) and broad content privacy (71 checks) passed after 0073.
- Browser acceptance and final build remain pending. Simultaneous cross-resource
  edits can receive a PostgreSQL deadlock error; the transaction rolls back,
  and no unsafe visibility change commits.

- Ordinary draft concurrency testing caught a lock-order regression introduced
  by access checks: two saves could contend on a retained-source owner lock
  instead of reporting a version conflict. The existing account contribution
  advisory lock now precedes permission, draft and file locks. Independent
  review and the real concurrent-save/publication regression pass. Existing
  import review/publication/retry and at-capacity reads also pass; the latter
  use seven list queries and twelve overview queries for ten imports, 1,000
  rows and fifty drafts. The 71 content-access checks pass after the fix.
- Reusable group links cannot grant membership in a members-only community.
  The UI sends their holders to request access. Personal invitations issued
  by an authorized steward remain explicit approval, with existing expiry,
  revocation and one-time-use checks.

- The final bounded production build passed with two workers, 3.0 GiB peak
  memory and no swap. Full lint has no errors and the same two existing
  TanStack compiler warnings. Migration metadata and the metadata, navigation,
  authentication and interface-state static checks pass.
- The new production privacy browser suite passed all eight behavior groups:
  desktop/mobile visitor shell, old group-link approval path, direct page/API/
  source restrictions, shared versus personal access, public graph exclusion,
  request/approval/reload, immediate revocation and visibility changes. No
  browser errors; fixtures removed. Evidence is in
  `.matsci-stage/community-privacy/ui/results.json`. The test preview explicitly
  disables inherited Fuseki settings so it cannot contact another local graph
  dataset; production's fail-closed graph removal remains enforced.
- Membership mutation coverage now passes 17 checks, including private open
  links and the live authority of invitation issuers. Existing MatCore and
  community-navigation browser regressions are being rerun before commit.

- Final metadata browser acceptance passes all 13 workflow groups and nine
  catalog groups, including private access, generic fields, lost responses,
  browser Back, two-tab recovery, source returns and 390/320-pixel layouts.
  All 67 retained-table fingerprints matched after cleanup. Evidence:
  `.matsci-stage/matcore-ui-privacy-final/results.json` and
  `.matsci-stage/matcore-catalog-ui-privacy-final/results.json`.
- Header acceptance passes seven groups and community section navigation
  passes nine. People navigation includes authorized access requests; ordinary
  members and visitors do not receive management sections. Evidence is under
  `.matsci-stage/community-privacy/header/` and `sections/`.
- The updated guides render through the actual documentation renderer, with
  unique section anchors and the metadata workflow present in guide navigation.
- Two reviewers approved the Superego inventory packet, including its fixed
  read-only commands, original-column hashes and protected evidence files.
  Chris was asked to run it with user-entered sudo; deployment remains held.

- The existing draft-import production browser suite passes all six groups,
  including source reuse, ontology review, saved publication choices, citation
  retention and atomic group publication. Contextual return URL assertions now
  check both the import destination and its owning community. Fixtures were
  removed and the temporary bounded source worker was stopped.
- Final database invariants pass. All original columns and rows in the 65-table
  pre-permissions baseline are unchanged, including all 248 drafts and history.
  The preview is active within its existing 6 GiB / 128-task limits, using
  about 189 MiB and 11 threads at the final check. No remote deployment yet.

- CI exposed a request-context dependency in the canonical-definition database
  suite and its HTTP fixture setup. Shared definition, vocabulary and document
  loaders now accept an explicit viewer and default to anonymous access;
  request handlers resolve the session. Viewer identity remains in cache keys.
  Anonymous, member and nonmember resolver cases pass, along with metadata,
  RDF/provenance and all 71 content-privacy checks. Independent review, TypeScript
  and scoped lint pass. HTTP cache assertions now require private, no-store
  responses that vary by cookie. The follow-up bounded build passes with two
  workers, 3.2 GiB peak and no swap. Production HTTP checks pass directly and
  behind HTTPS forwarding; exact fixture cleanup leaves all 67 table
  fingerprints unchanged. Privacy acceptance passes all eight groups on the
  rebuilt preview. Its first run timed out once waiting for a reload; the
  unchanged test passed with 256 task slots for the browser runner instead of 128. The cause is unconfirmed, with no browser errors or application change.
  Original-column preservation still passes for all 65 baseline tables.

- A later CI contribution regression exposed an account/term lock inversion
  during simultaneous submissions. Definition, comment and example submissions
  now take the account lock first. Definition publication takes the term's
  write lock before its source lock, avoiding a second deadlock when different
  authors would otherwise upgrade compatible read locks. Survey publication,
  comments and votes retain study-first ordering. Access checks remain intact.
  Deterministic regressions verify account ordering, two-author publication,
  consecutive definition numbers and preserved source provenance. Survey
  positions, definition source locking, examples, ordinary drafts and all 71
  content-privacy checks pass, as do TypeScript and scoped lint. Independent
  review found no remaining blocker. No schema or interface change is required.

- CI and a local reproduction showed an intermittently empty metadata editor
  after client navigation, despite a completed HTTP 200 route response and no
  browser errors. Private editor links and successful create/propose/revise
  actions now load a fresh document. This is a defensive navigation boundary;
  the underlying router cause remains unconfirmed. Save guards remain intact.
  Section navigation passes nine groups, metadata workflow passes 13, and the
  catalog passes nine on the rebuilt production preview. Browser Back coverage
  now verifies canceling the unsaved-work warning, then confirming departure
  and recovering the writing. All fixtures were removed with no unexpected
  browser errors; all 67 retained-table fingerprints and the original columns
  and rows of all 65 baseline tables match. Evidence is under
  `.matsci-stage/community-privacy/metadata-entry-acceptance/`. TypeScript,
  scoped lint, presentation checks and independent review pass.

## Community usability follow-up, October 23

Implemented one community template. Controls depend on permissions, enabled
metadata tools and granted source catalogs, with no branch based on a community
name or slug. Ordinary communities and independent metadata fields use the same
page structure as catalog communities.

- Overview offers vocabulary browsing and recent drafts belonging to the viewer.
  My work places sections with saved work before empty sections. Creation
  controls sit with the corresponding term or metadata list.
- Catalog communities have separate Reference catalog and Community
  contributions views. Search covers names, paths and definitions in the
  selected version and profile before pagination. Search, filters and source
  identity remain in contextual return links. Page controls appear above and
  below catalog results.
- Settings holds content access and workspace tools, plus community editing
  and retirement for site administrators. Existing authorization rules still
  apply. Old authorized workspace-tools links lead to Settings.
- The header identifies the saved Default community. Viewing another community
  does not change that default. Short information popovers replace repeated
  explanations of source entries and field rules. Draft visibility, save errors
  and publication consequences remain visible.
- Updated the community and metadata guides using the canonical writing guide.
  No schema, source import, draft migration or publication change is included.

Verification covers ordinary communities, independent metadata fields and a
catalog installed in a community with a generated name. The five production
browser suites pass 48 groups, including desktop, 390-pixel and 320-pixel
navigation, permissions, search beyond the first page, keyboard help, contextual
returns, interrupted saves, reload, publication and provenance. The catalog
database suite passes 93 checks with transaction rollback. Navigation and
presentation checks, type checking, scoped lint, guide rendering and the
bounded production build pass.

The added second-community fixture exposed a cleanup guard that assumed a
single field owner. The guard now verifies both explicit fixture identities.
The two failed cleanup runs were removed by exact fixture identity, and retained
record fingerprints matched before the final suites. A workflow test also
caught Settings collapsing after a tool change. Keeping the mounted settings
component stable fixes that interaction. Final test cleanup and preservation
checks pass. Evidence is outside the repository under
`.matsci-stage/community-usability-implementation-20261023/`. The Browser plugin
was not available, so automated checks used the existing bounded Playwright
harness. Manual local review used the in-app browser. This is interface
acceptance, not a usability study with new participants.

## Community selection navigation, October 24

Selecting a community in the header opens its Overview and saves the browsing
and contribution context. Selecting the active community again also opens its
Overview. Everything opens Home. The menu is labelled Community, with a My work
shortcut for the selected community. The behavior is shared across communities.

Term and metadata editors register their save queues for menu navigation.
A switch waits for unsaved writing before changing the account preference. A
failed save leaves the editor and preference unchanged. Pending state remains
mounted when the menu closes, so reopening it cannot start a competing switch.
The selector stays disabled until hydration attaches its event handlers.
Existing link, unload and save-recovery protections remain in place.

The production header and community section suites pass 23 groups, including
delayed hydration, keyboard selection, desktop and mobile navigation, reselection, failed
preference saves, pending term saves, metadata save failure, retry and reload.
The retained metadata fields, drafts, revisions and history have matching
fingerprints after fixture cleanup. Draft queue, navigation and persistence
checks, scoped lint, type checking and the bounded production build pass. Manual
local MatCore selection also opens Overview without browser console errors.
The first header run required a corrected locator for the mobile utility menu.
Final suites have no unexpected browser errors or blocked requests.
The community guide describes the updated navigation. Evidence is outside Git
in `.matsci-stage/community-switcher-20261024/`. No migration or catalog change
is needed. This fix has been verified locally and has not been deployed.

## Optional hierarchy view plan, October 26

Chris requested an optional hierarchy view that remains generic across
communities, with familiar controls and a simple workflow for practitioners.
This section records the design and component assessment before implementation.
Implementation and verification results follow below.

The source import retains field paths and validates parent paths. Installed
occurrences retain the path and source identity. The catalog presents these
occurrences as a paginated list. A hierarchy view can use the preserved paths,
scoped to a source version and profile. Profile inheritance remains a separate
relationship, shown through a labelled group or link.

The recommended first implementation is an expandable outline with nested
lists, disclosure buttons and ordinary field links. The current catalog uses
shadcn components with Radix primitives. Add the Radix Collapsible component
using the existing component conventions and a compatible pinned dependency.
The shared outline accepts generic node identities, labels, child relationships
and destinations. A MatCore adapter supplies its versioned source occurrences.
Other communities can use the same component when they have explicit structure.
Do not infer hierarchy from similar labels or expose controls for a community
without structured content.

| Option                                                                              | Assessment                                                                                                                                                       |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [shadcn/Radix Collapsible](https://ui.shadcn.com/docs/components/radix/collapsible) | Recommended for expandable navigation using the existing visual components and ordinary links.                                                                   |
| [React Aria Tree](https://react-aria.adobe.com/Tree)                                | Alternative if testing establishes a need for a complete tree widget with arrow-key navigation and managed selection. It would add another component dependency. |
| [MUI Tree View](https://mui.com/x/react-tree-view/accessibility/)                   | Provides tree navigation and focus behavior. Material UI is installed elsewhere, but the tree package is not, and the catalog uses shadcn styling.               |

The [WAI navigation guidance](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/examples/treeview-navigation/)
recommends disclosures for typical expandable navigation. A disclosure outline
uses normal Tab, Enter and Space behavior. It must not claim the ARIA tree role
without implementing the complete tree interaction pattern.

Practitioner interaction requirements:

- Keep List as the initial view, with a visible List / Hierarchy choice.
- Use a separate, comfortably sized expansion button and a field-name link.
  Expanding a branch reveals children. Following the link opens field details.
  A parent field remains selectable even when it also contains child fields.
- Open the top level initially. Search reveals matching fields with their
  ancestor paths, and clearing search restores the previous expansion state.
- Reuse the existing field detail and Propose a change workflow. Returning
  restores the filters, selected field, expanded branches and reading position.
- Keep rows compact. Field names are primary, with required and repeatable
  labels where useful. Detailed rules and explanations remain in the field
  view and information popovers.
- Use a single column on narrow screens with clear return navigation. Keyboard
  focus remains visible, and collapsing a branch cannot strand focus inside
  hidden content.

The first version covers browsing the preserved catalog. Existing membership
checks, draft ownership, baseline identity and provenance remain authoritative.
No database migration is expected for this initial view. The API must supply
the relevant parent structure across list page boundaries and search filters.
Acceptance will cover deep links, browser Back, search restoration, duplicate
labels in different profiles, parent-field selection, keyboard and touch use,
and an ordinary community with no hierarchy. Verify that browsing creates no
drafts and does not expose private content. Dependency compatibility and mobile
and assistive-technology behavior require testing before release.

## Optional hierarchy view implemented locally, October 26

The reference catalog has List and Hierarchy views. Hierarchy uses a reusable
disclosure outline built from nested lists, field links and Radix Collapsible
1.1.21. The shared component has no MatCore names or profile assumptions.
The catalog adapter supplies the authorized source paths, field labels and
destinations. Regular communities retain their existing vocabulary view.

All profiles initially show collapsed groups. Selecting one profile opens its
top level. Separate expansion buttons and field links allow a parent field to
be opened without expanding its children. Search retains matching fields and
their ancestor paths across list page boundaries. Clearing search restores
the previous expansion state. Profile inheritance has separate labelled links.
Required and repeatable labels use the recorded field rules. Duplicate paths
become navigation groups with separate record links, preserving their identity
without presenting one record as the parent of another.

Catalog and proposal return links preserve Hierarchy mode, version, profile
and search. Browser session storage retains expanded branches, field selection
and reading position, scoped to account, community, release and profile. An
in-memory fallback permits navigation when browser storage is unavailable.
The outline uses normal buttons and links with visible focus and 44-pixel
expansion controls. Existing source entries, drafts and provenance are unchanged.
No migration, source reimport or publication is included.

Verification completed on the production local preview:

- All 14 catalog browser groups pass, including parent-field selection,
  keyboard expansion, search restoration, browser Back, reload, proposal
  saving and return, blocked storage, and 390-pixel and 320-pixel layouts.
- A regular community has no hierarchy controls. Anonymous source requests
  and another member's private draft remain inaccessible.
- All 100 catalog database checks pass with transaction rollback. Pure
  hierarchy and navigation checks cover missing parents, duplicate labels and
  paths, search context and restricted return URLs.
- The production build, TypeScript, scoped ESLint and diff checks pass.
  Screenshots show the desktop and narrow-screen layouts. No unexpected
  console errors or blocked requests remain in the final browser run.
- Final fixture cleanup succeeds. Fingerprints for retained public-table
  records match, including existing source releases, drafts and provenance.

Two initial browser runs needed corrections to the test's profile label and
its navigation wait before reload. A later run passed the new workflow checks
but Chromium crashed while opening another context. The complete suite passes
with a 256-task limit for the test runner, a 2 GiB memory limit and two CPUs.
Application limits remain unchanged. The local preview restart helper also
needed to recreate its stopped transient unit after the first successful build.

The user guide now describes the hierarchy controls and return behavior.
Evidence is outside Git in `.matsci-stage/catalog-hierarchy-20261026/ui-final/`.
This is local Chromium acceptance with synthetic fixtures, not a practitioner
usability study or a manual screen-reader audit. The reusable outline is
available for other structured catalogs, while this first integration covers
the preserved MatCore reference catalog. Remote deployment remains separate.

## Community standards workspace redesign, October 26

Implemented and verified locally on `feat/catalog-hierarchy`. The user approved
separate reference, working version and proposal views, steward review and named
community releases. Metadata communities now open on Standard. Ordinary vocabulary
communities keep their existing navigation. No Superego or Ego changes were made.

The community navigation exposes Standard, Proposals, My drafts and People.
More contains community releases, vocabulary terms, collections, About and
available management tools. The source version stays selected when moving from
Standard to Proposals. The proposal queue can also select an earlier reference.

Field names are separate from profiles and schema paths. New individual proposals
start with the short source field name. A parent and child can have the same short
name at distinct paths. Existing drafts and source payloads retain their stored
contents and provenance. No catalog reimport or deletion was needed.

Reference and Working version share a compact profile, search and List / Hierarchy
toolbar. Desktop shows the outline beside the selected definition. Narrow screens
show the field browser or detail, with Back to fields restoring keyboard focus.
The definition remains visually distinct. Common field rules are visible, while
All field rules, source attribution and comparison details expand on demand.

New submissions use standalone metadata field revisions instead of creating
dictionary terms. Existing dictionary-linked fields and their exact definition
revisions remain supported. Private drafts, submitted revisions, immutable source
baselines and named releases are separate records. Members can comment on an exact
proposal revision. Stewards or site administrators accept, request changes or
decline, with an attributed reason. Only accepted revisions affect the working
version. A pending revision leaves the previously accepted one in use.

A named community release freezes the selected reference, complete field contents,
accepted revision IDs and review event IDs. A stale working-version fingerprint
blocks release creation. Repeated release requests are idempotent. Releases are
immutable, and later acceptance does not rewrite them. Source-linked revisions
never cross reference versions automatically. Duplicate paths within a profile
are rejected before acceptance or release. These actions do not imply approval by
the reference publisher.

Migration `0074_community_standard_releases.sql` adds the release table, permits
standalone metadata revisions and extends attributed events for steward review
and discussion. It was applied only to `matsci_matcore_test` on port 55447 after
an isolated database backup. Existing rows were not rewritten. The normal local
database and remote environments were not touched. A future deployment needs the
usual database backup and migration rehearsal, but no reference reimport.

Verification:

- 39 new database checks pass, including steward permissions, private access,
  source-version isolation, stale release requests, release immutability,
  acceptance rollback for duplicate paths, and preserved baselines.
- The existing workflow and catalog database suites pass, with 119 and 100 checks.
  All database fixtures were rolled back.
- The complete standards UI suite passes 12 groups: reference browsing, short names,
  list and hierarchy navigation, keyboard disclosure and focus return, blocked
  storage, private drafts, saving and reload, submitted discussion, steward review,
  working versions, releases, ordinary vocabulary access and 390px / 320px layouts.
- The draft workflow UI suite passes 13 groups, including interrupted saves,
  lost responses, two-tab conflicts, source/citation retention, generic metadata
  fields and ordinary vocabulary publication. The sections, privacy and header
  suites pass 12, 8 and 11 groups respectively.
- Final fixture cleanup passed. The standards UI suite compared fingerprints for
  all retained public-table records before and after, including existing drafts,
  source releases and provenance. No new QA terms or community releases remain.
- Pure source, presentation, recovery, hierarchy and return-URL tests pass, as do
  the production build, TypeScript, scoped ESLint and diff checks. CI includes the
  new database and browser suites. The earlier catalog browser command remains an
  alias to the consolidated standards suite, which CI runs once.

Initial runs exposed obsolete test labels and navigation locations after the
redesign. One comment assertion matched the unsent textarea, so it now waits for
an attributed list item before reloading. A layout test now waits for Hierarchy
to become active before selecting another profile. The new split layout needed
explicit focus restoration when returning to the still-mounted outline. The
legacy database test also changed: stewards can now review existing generic fields
even when new field creation is disabled. These cases pass in the final runs.

Visual comparison with the generated concept checked five points: compact
community navigation, clear reference/working controls, a shared filter toolbar,
an outline beside a short field title and distinct definition, and a field-level
proposal action with expandable supporting details. The existing application
header, design tokens and actual profile names were retained. The concept's
invented profile labels were not used. IAB inspection confirmed the real local
MatCore hierarchy, its short Phase field names and existing draft return link.
Automated screenshots cover desktop, mobile and a named release using invented
fixtures. No protected source content or generated images were added to Git.

Evidence is outside Git in `.matsci-stage/community-standards-20261026/`: the local
backup, build log, `ui/results.json`, screenshots and the `final-*` regression
results. The final build peaked at 3.0 GiB without swap. The final standards UI
run peaked at 750.8 MiB without swap. The preview retains its existing two-CPU,
6 GiB, no-swap, 128-task limits; browser tests use a separate two-CPU, 2 GiB,
256-task unit. No recurring monitor was started.

The user guides for metadata development and communities, plus the MatCore
reference guide, describe the new states and review authority. Automatic rebasing
onto a later publisher reference, simultaneous draft editing, assigned reviews,
notifications and dataset validation remain separate work. This is local
functional and visual acceptance, not a practitioner usability study or a manual
screen-reader audit. Changes have not been committed, pushed or deployed.

## Reference wording simplified locally, October 26

Removed the remaining “preserved source entry” and “preserved source baseline”
wording from metadata draft links, reference details, proposal review and citation
summaries. These controls now use Reference, View reference and Back to reference,
consistent with the community Standard view. The entries are not presented as a
special class of protected records. The reference/working/proposal distinction
and existing data are unchanged.

Updated the user guides and existing UI test expectations to match. This is a
copy-only follow-up; it adds no schema, workflow or data changes.

The bounded local production build and scoped ESLint pass. In-app browser
inspection at localhost:3109 confirmed the existing draft's Back to reference
link, Reference details under Sources & history, and return to the same field
and hierarchy. The page renders without an error overlay; the browser console
contains no warnings or errors. No draft was edited or submitted. Screenshot:
`.matsci-stage/community-standards-20261026/reference-wording.png`. Existing UI
assertions were updated; the full suites were not repeated for these text changes.

## Contributor review against the MatCore paper, October 26

Read Greenberg et al., *Towards MatCore: A Unified Metadata Standard for Materials
Science*, arXiv:2502.07106v1, from the project's relocated PDF archive. The local
file is `docs-internal/pdf-readings/Greenberg et al. - 2025 - Towards MatCore A
Unified Metadata Standard for Materials Science.pdf`. The assessment uses the
2025 paper's development model, not a claim about MatCore's present governance.
Read the complete text and inspected the hierarchy and DFT specification figures.

Sections 3 and 4 and Figure 1 describe a common core with method-specific metadata.
Section 5.2 describes a collaborative document shared across working groups.
Sections 5 and 6 separate draft development, community requests for comment,
committee consideration and later revisions. Figure 5 identifies potential overlap
between state occupations and k-smearing, an example of a decision spanning fields.
The paper does not prescribe a voting rule or software interface.

From a contributor's perspective, the implemented workflow supports individual
field negotiation. A contributor can inspect an existing field in context, change
its definition and value rules, explain the reason, cite evidence, submit a proposal,
discuss its exact revision and respond with another revision. Stewards record
review decisions and accepted changes enter a working version. Named community
releases retain the reviewed state. Acceptance records a community decision,
not evidence of consensus or official MatCore endorsement.

The metadata workflow is not yet equivalent to the dictionary's competing
definitions and votes. Its shared proposals follow a serial revision sequence for
each field occurrence. Concurrent private drafts exist, but a stale submission must
be reconciled with the latest shared revision. It does not present competing
alternatives side by side. Comments belong to exact revisions, with earlier
conversations available through the revision selector rather than one resolved
issue thread. Cross-field change sets, dependencies, parent/child move validation,
working-group assignments, notifications and an RFC period with a committee decision
record remain absent. The members-only MatCore space supports internal work, not
the paper's later public-comment phase. Protected references must not be exposed
simply to enable public feedback.

The next substantive addition should be a reviewable change set for related fields,
with an explicit resolution of alternatives and recorded decision rationale. This
would support a shared scope decision for fields such as k-smearing and state
occupations. Working-group review assignments and a separately authorized public
RFC surface can follow. These are recommendations, not changes implemented here.

Implemented the navigation improvements locally:

- Standard remains the leftmost community section, followed by Proposals, My drafts
  and People. It now opens Working version, with Hierarchy selected.
- Working version is the leftmost standard view. Named community releases follow
  when present, then Reference. Hierarchy is left of List, which remains selectable.
  Explicit reference and list links keep their chosen views.
- Unchanged working fields use the same proposal/resume controls as reference fields,
  without a second navigation through Reference. The return link identifies the
  working version. Explicit View reference links continue to open Reference.
- Metadata draft editors open Field specification first, followed by Definition and
  Sources & history. Dictionary term editors are unaffected.
- Submitted proposals open Changes, followed by Discussion, Field specification and
  Sources & history. Changes compares the exact revision with the preceding revision
  for the same field occurrence and profile, or its reference for the first revision.
  Steward decisions and withdrawal controls are in Discussion after the comments.

No schema, permissions, reference content, existing draft payload or publication
state changed. User guides and existing browser regressions were updated.

Verification completed on the local production preview:

- All 12 standards UI groups pass, including leftmost default controls, direct
  proposal creation from Working version, Changes and Discussion navigation,
  steward acceptance, named releases, and 320px / 390px layouts. The comparison
  uses short field names so generated profile prefixes do not create false rename
  differences. Retained public-table fingerprints match after fixture cleanup.
- All 13 draft workflow groups pass. Coverage includes specification-first entry,
  save and reload, interrupted saves, two-tab conflicts, comparison against the
  preceding revision, retained citations and source attribution, generic metadata
  fields and ordinary dictionary publication. All temporary fixtures were removed.
- All 12 community-section UI groups pass, including failed-save navigation,
  community switching, return links, mobile focus and ordinary community behavior.
- Production build, TypeScript, scoped ESLint, catalog return-URL and generic
  hierarchy checks pass. The final build peaked at 2.7 GiB without swap. Browser
  tests retain their separate two-CPU, 2 GiB, 256-task limits.
- In-app inspection of the real local community confirmed Working version and
  Hierarchy as the initial leftmost choices. The page has meaningful content, no
  framework overlay and no console warnings/errors. Desktop and mobile screenshots
  of the proposal changes/discussion screens were inspected.

Earlier regression attempts assumed that Definition opened first, including on
re-entry. Their selectors now explicitly open the requested editor tab. Another
assertion matched both the definition and its new comparison copy and was scoped
to Changes. The dictionary portion keeps its existing editor controls. These were
test adaptations to the new layout, not changes to save or publication behavior.
The pure navigation command used Node's tsx loader after the tsx CLI's IPC socket
was unavailable in the sandbox.

Evidence is outside Git in `.matsci-stage/matcore-contributor-review-20261026/`.
Final results are `accepted-community-standard/results.json`,
`accepted-matcore-workflow/results.json` and `checked-community-sections/results.json`.
`build-accepted.log` records the final production build. The paper page renderings,
`local-defaults.png` and desktop/mobile proposal screenshots are retained there.
No remote deployment, migration or recurring monitoring was performed.

### Pre-deployment code review, October 26, 2026

Reviewed the uncommitted `feat/catalog-hierarchy` changes against `c9701c2`,
including the new standards service, migration 0074, proposal decisions, legacy
publication compatibility, permissions, release snapshots and community navigation.
The review identified three P2 findings to fix before Superego deployment.
The review itself did not change application code. The follow-up below resolves
all three locally; the line references here describe the reviewed version.

1. **The legacy publication route can hide earlier independent revisions.**
   `publishMatcoreDraft` calls the shared publisher in dictionary mode. A contributor
   can submit an independent field, revise it, then use the still-exposed `publish`
   mutation on that new draft. This creates a dictionary term and changes the field's
   `termId`. `getMatcoreField` then excludes the older revisions because their
   `definitionRevisionId` is null. The reproduction returned `NOT_FOUND` for an
   earlier accepted revision. The underlying records remain stored, but their
   proposal, discussion and provenance pages become inaccessible. Reject this
   conversion before writing, while retaining support for existing dictionary-linked
   fields. Add coverage for submission followed by legacy publication of a revision.
   Relevant code: `lib/matcore-workflow.ts:1220`, `:1290` and `:1503`.

2. **Reversing acceptance can restore a schema path that is already occupied.**
   Accept field A at path X, accept a revision moving A to Y, then accept field B at
   X. Declining or withdrawing the latest A revision succeeds and restores the
   earlier accepted A at X. The working version now contains two fields at X and
   cannot be released. Both reversal paths reproduced. Path validation currently
   runs only for an acceptance decision. Serialize all decisions that change the
   working version and validate the resulting paths before commit, including
   withdrawal and other decisions that restore an older revision.
   Relevant code: `lib/matcore-workflow.ts:1698` and `:1715`.

3. **The Community release tab can open a mismatched reference/release pair.**
   The link selects the newest community release across reference versions but
   retains the reference currently being viewed. When those versions differ,
   `getCommunityStandard` correctly rejects the combination and the page returns
   not found. This reproduced with two synthetic reference versions and a named
   release. Build the link with both identifiers from the chosen community release,
   then cover switching from a different reference version in the UI suite.
   Relevant code:
   `components/metadata-workspace/community-standard-workspace.tsx:265`.

Fresh verification used only the isolated local `matsci_matcore_test` database:

- All three findings reproduced with 14 assertions. Every fixture transaction was
  rolled back, including the synthetic term created by the legacy route.
- Existing database suites still pass: community standards 39 checks, metadata
  workflow 119 checks and source catalog 100 checks. Their fixtures also rolled back.
  These passing suites do not cover the three failing scenarios above.
- The bounded run used two CPUs, at most 2 GiB of memory, no swap and 128 tasks.
  Its peak memory was about 162 MiB. `git diff --check` passes.
- The 37 browser groups recorded above remain prior evidence. No browser suite,
  production build, remote CI, deployment or migration was run during this review.

Reproduction code and logs are retained outside Git in
`.matsci-stage/community-standard-review-20261026/`. The next step is to implement
the three fixes and permanent regressions, rerun the affected checks, then proceed
through CI and Superego UI acceptance.

### Review fixes and local verification, October 26, 2026

All three findings above are resolved locally on `feat/catalog-hierarchy`.

- The legacy publication route now checks for existing independent revisions
  before creating a dictionary entry. The check runs under the field lock and
  covers every profile for that field. A rejected conversion preserves the draft,
  revision history and working version. The draft can still be submitted through
  the independent proposal workflow. Existing dictionary-linked publication
  remains supported.
- Acceptance, changes requested, decline and withdrawal now validate the resulting
  working version before commit. Withdrawals acquire the same vocabulary write
  lock as reviews and releases. A conflicting reversal rolls back its decision
  event. Valid withdrawals still restore an earlier accepted revision and allow
  release creation; existing named releases remain unchanged.
- The Community release tab uses both the community release identifier and its
  recorded reference identifier. Switching from a different reference version
  opens the selected release and retains it after reload.

Permanent regressions were added to the standards database and UI suites. The
database suite also runs two withdrawals through independent connections against
committed, disposable fixtures. Both requests wait at the same lock before they
proceed. Exactly one withdrawal succeeds when both would restore the same path;
the other returns a conflict without an event. The fixtures are removed afterward.

Fresh local verification:

- 273 database checks pass: standards 54, metadata workflow 119 and catalog 100.
  The concurrent-withdrawal regression also passes. Transactional fixtures rolled
  back, and the committed concurrency fixtures were removed. The initial expanded
  test exceeded the contribution limit for one synthetic account; separate fixture
  contributors now keep the tests within the unchanged application limit.
- All 26 browser groups pass: standards 13 and metadata workflow 13. Coverage
  includes switching between different reference/release versions at 1440px and
  390px, reload, hierarchy navigation at 320px and 390px, proposal review, saving,
  interrupted-save recovery, two-tab conflicts and generic metadata fields.
  The standards suite confirms unchanged fingerprints for all retained public
  tables after cleanup. Both suites report no page errors or blocked external calls.
- The production build, TypeScript, scoped ESLint, pure catalog navigation tests
  and `git diff --check` pass. The build peaked at 3 GiB without swap; the browser
  run peaked at about 834 MiB. Existing CPU, memory and task limits remained in use.
- In-app inspection after reload confirms the local MatCore community still shows
  248 fields, with Working version and Hierarchy selected. Its title and page
  content are correct, with no framework overlay or console warnings/errors.
  Desktop and mobile release-switch screenshots were inspected. The Browser plugin
  was not available; automated checks used the existing Playwright harness, and
  the in-app check used CUA.

Evidence is outside Git in `.matsci-stage/community-standard-fixes-20261026/`:
database and concurrency results, `build.log`, static-check logs,
`community-standard/results.json`, `matcore-workflow/results.json` and screenshots
named `release-version-switch-1440px.png` and `release-version-switch-390px.png`
inside the standards evidence directory. The local preview is rebuilt and running.
These fixes required no additional migration or data conversion. The changes remain
uncommitted; remote CI, Superego deployment and Ego deployment have not run.

### Release verification follow-up, October 26, 2026

The first remote CI run passed its database and graph jobs, but the main job
stopped on an older presentation assertion that still expected “Preserved source
baseline.” The interface intentionally uses “Reference.” The presentation test
now checks that label, the short field name and the generic no-reference message,
while retaining its escaping and attribution checks. No application behavior
changed for this correction. All three `test:matcore` checks pass locally. The full
CI suite must pass before deployment.
