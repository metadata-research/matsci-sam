# MatCore workflow progress

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

| Host | Inventory and migration review | Community catalog setup | Preservation and UI acceptance |
| --- | --- | --- | --- |
| Superego | Pending | Pending | Pending |
| Ego | Pending, after Superego acceptance | Pending | Pending |

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
  unchanged test passed with 256 task slots for the browser runner instead of
  128. The cause is unconfirmed, with no browser errors or application change.
  Original-column preservation still passes for all 65 baseline tables.
