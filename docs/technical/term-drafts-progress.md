# Saved term drafts

Started 2026-10-17 on `codex/quick-start-guided-setup`.

This document tracks the implementation, decisions, verification, and remaining
work for private account-backed term drafts. Update it as work completes. The
checkboxes describe verified progress, not intended behavior.

## Intended experience

A contributor can start a new term in guided setup or the full editor, leave,
and resume from the same account on another device. Both editors use the same
draft. Saving is automatic after meaningful input. Publishing remains an
explicit action.

The interface shows "Saving...", "Draft saved", or an actionable saving error.
The profile provides "My drafts" with Resume and Delete actions. Add a term
offers a link to existing drafts without adding another required step.

## Scope and decisions

- Drafts are private to their owner and separate from published terms. They do
  not appear in search, public profiles, activity, exports, or graph projection.
- Version 1 covers new single terms. Survey contributions, revisions,
  replacements, batch imports, and community proposal review remain separate.
- Preserve incomplete term, definition, example, destination vocabulary,
  optional collection, reference selections, attached files, and AI attribution.
- Preserve the distinction between an unapplied model preview and applied AI
  assistance. Retain the writing and citations needed by Undo.
- Reopening and saving drafts do not invoke a model or repeat provider lookups.
- Use owner-authorized reads and writes. Recheck current contribution and
  destination permissions before publishing. Revoked destination access must
  not prevent the owner from recovering their writing.
- Autosave serializes writes and checks versions. Failed or conflicting saves
  preserve local edits. Delayed saves cannot recreate deleted or published drafts.
- Publishing and recording its receipt happen in one transaction. Retrying a
  completed publication returns the original result.
- Files linked to active drafts must survive the existing 24-hour pending-upload
  expiry. Preserve upload limits and cleanup of genuinely abandoned files.
- Wizard position, unfinished community/vocabulary/collection forms, and import
  text remain browser-local. Single-term content uses an account draft.
- Creating a community, vocabulary, or collection still saves it immediately.
  Deleting a term draft does not delete those objects.

## Progress

- [x] Inspect current full editor, guided setup, publication, and file retention.
- [x] Agree first-version scope and user-facing behavior.
- [x] Create this tracking document.
- [x] Add draft schema, migration, owner-only API, and version checks.
- [x] Integrate draft publication with existing attribution and evidence rules.
- [x] Retain attachments linked to active drafts.
- [x] Add shared autosave and save-state controls.
- [x] Restore drafts in the full editor, including model preview and Undo state.
- [x] Add My drafts and resume/delete controls.
- [x] Share single-term drafts between guided setup and the full editor.
- [x] Clarify setup-progress and saved-term messages.
- [x] Verify database behavior, editor interactions, and existing workflows.
- [x] Update contributor documentation with the implemented behavior.

## Implementation notes

`lib/new-term-publication.ts` now provides the shared new-term transaction for
the full editor, guided setup, and draft publication. It retains citations,
examples, files, collection membership, and AI evidence. Existing inherited
definition and survey paths remain separate.

`components/definition/term-draft-controller.tsx` and
`lib/term-draft-save-queue.ts` provide the shared serialized autosave. The setup
editor and full editor hand off a draft ID; the setup review mounts the full
review component. Only one editor writes the draft at a time.

The full editor hands committed changes to the save queue before paint so the
save status and leave-page protection reflect the current writing and citation
choices. The network save still waits 700 ms after an edit. "Draft saved" means
the latest changes have finished saving, not just an earlier draft version.

Persisted model snapshots keep suggestion IDs, editor context, input labels and
the writing needed for Undo. Generated text, exact source inputs, match records,
request bodies and model metadata remain in the server's suggestion record.
The editor removes that evidence before autosave, and owner-authorized reads
restore it for previews, applied suggestions and Undo. This keeps large source
receipts out of the draft-size budget without dropping publication provenance.

`/profile/drafts` lists private drafts with Resume and Delete actions. Drafts
live in separate database tables and never enter the published-term pipeline
until the owner publishes them.

Unlinked pending uploads still expire after 24 hours. Files linked to active
drafts are retained by both ordinary recovery and the cleanup script. The
existing pending-upload limit still applies.

## Verification record

On October 19, the complete `scripts/test-source-documents-ui.ts` harness passed
against the current implementation, using a fresh, migrated QA database, the
Next.js development server and the source extraction worker. All six scenarios
passed, including first-frame citation dirty state and unload protection, held
database saves, saved reloads, immediate navigation, publication and public
source access. Browser errors and unexpected requests were empty, and the
harness removed its fixtures. AI responses were controlled fixtures; this run
did not call an external provider. This closes the complete-harness gap recorded
below for the October 18 follow-up. All six scenarios also passed after the
passage-control wording was clarified. Selection behavior is unchanged.

A local browser typing check also passed with a 261,000-character compact
draft and a 659-character ordinary draft. Both saved and reloaded every edit
without a stale saved label. For 52 measured keystrokes per draft, median
input-to-next-animation-frame time was 13.4 ms for the large draft and 12.3 ms
for the ordinary draft. The large draft had one 57 ms long task. Its permitted
escaped historical text deliberately stressed the size limit. These development
browser measurements are a performance watch, not an isolated effect comparison
or a production paint-time guarantee.

The October 18 citation timing follow-up used the actual review component,
payload bridge, save queue, controller and status with simulated HTTP saves.
The old bridge could show the previous saved label in the first frame after
a citation edit. The layout-effect bridge showed unsaved changes before paint.
Held saves, reload after saving, navigation flush and failure/retry passed.
The full source UI script includes these regressions; its complete database
harness was not rerun for this follow-up.

Migrations `0065_private_term_drafts.sql` and `0066_term_draft_tombstones.sql`
were applied to the isolated local test database. No production database was
changed. Browser verification passed. Tests use stored fixtures and do
not call AI or reference providers.

| Check | Result |
| --- | --- |
| `tsc --noEmit --incremental false` | Passed |
| Scoped ESLint for setup, editor, draft backend, and profile | Passed |
| `scripts/test-term-drafts-db.ts` | Passed |
| `scripts/test-term-draft-save-queue.ts` | Passed |
| `scripts/test-guided-setup.ts` | Passed |
| `scripts/test-interface-state.ts` | Passed |
| `scripts/test-migration-journal.ts` | Passed, 67 entries |
| `scripts/test-term-draft-navigation.ts` and auth plumbing | Passed |
| Existing setup, contribution-files, references, and source-lock DB suites | Passed |
| Existing definition-revision and contribution-provenance checks | Passed |
| Definition UI safety and public router surface | Passed |
| My drafts desktop/mobile, deletion/conflict, owner isolation, login return | Passed |
| Immediate navigation, reload, setup/full-editor handoff, changed-term confirmation | Passed |
| Desktop/mobile review, publication receipt, published-draft recovery | Passed |
| Account change before first autosave | Passed; text preserved, no draft assigned to new account |
| Rich draft restoration, references, AI preview/applied state and Undo | Passed, including save/reload after Undo |

Browser checks use the local preview at `http://127.0.0.1:3109`, an isolated QA
database, and sequential desktop (1365px) and mobile (390px) contexts. The
Browser plugin was not available, so a temporary Playwright harness was used.
The pages rendered without a framework error overlay. Console errors were
limited to deliberately exercised 404/409 responses. One early request failed
while Next's development worker recycled itself at its memory threshold;
verification succeeded after it was ready again. No service restart was issued.

The main interaction was `/add` → immediate **My drafts** navigation → Resume →
reload → guided setup → change the term → full-editor confirmation → setup
review → publish. The published draft left the private list and its old link
showed the publication receipt. Account-switch verification preserved unsaved
writing and refused to save it to the newly signed-in account.

Local screenshots are stored outside the repository in
`/home/chris/.codex/visualizations/2026/10/17/01a148d1-ab3d-7393-8445-4f4c79cb98cc/quick-start-qa/`:
`my-drafts-desktop.png`, `my-drafts-mobile.png`,
`term-draft-review-desktop.png`, `term-draft-review-mobile.png`,
`term-draft-rich-preview-desktop.png`, `term-draft-rich-applied-desktop.png`,
and `term-draft-rich-undo-mobile.png`.
The review screenshots precede the final clarification of the setup footer's
wording. The ordinary preview remains available; recurring monitoring is paused.

Rich-draft checks restored both an unapplied model preview and an applied
contribution, with the separate example, stored reference receipt, and private
versus publish-selected attachment choices. Undo restored the earlier writing
and citations, removed model credit, and survived autosave and reload. No model
generation or reference retrieval requests occurred. The temporary browser and
all accounts/publications/drafts created by these browser checks were cleaned
up; baseline QA data and services were preserved.

During implementation, review found and corrected these failure cases:

- A delayed first-save retry could recreate a deleted draft. Deletion now clears
  its contents and retains a small tombstone for the draft ID.
- Navigation before the autosave delay could lose recent input. Internal links
  now flush changes before leaving, with unload protection for unsaved work.
- A simple setup edit could retain the full editor's old confirmed term.
  Confirmation is invalidated for plain edits. Terms with context-bound evidence
  use the full editor's existing change controls.
- Retrying a definitively rejected save could repeatedly send the old invalid
  payload. Known rejected requests now release their retry snapshot, while
  unknown outcomes retain the original request identity.
- An account change before the first save could assign old writing to the new
  session. Creation is bound to the account that opened the editor.
- File retention subqueries needed explicit table qualification for Drizzle's
  generated SQL. Database coverage now verifies old draft-linked files survive
  download, publication, and cleanup.
- Final UI review found the old blanket 24-hour upload expiry message. It now
  explains that unpublished uploads expire only when they are not saved in a
  draft, matching the implemented retention behavior.

Required coverage:

- Owner isolation and absence from public discovery.
- Incomplete input, save retry, lost response, and conflicting tabs.
- Refresh, account switching, and guided setup/full-editor handoff.
- Applied AI attribution, unapplied preview, references, examples, and Undo.
- Draft-linked attachment retention and cleanup after release.
- Changed permissions, duplicate terms, and collection membership.
- Atomic publication, rollback, and repeated publication requests.
- Existing inherited definition, revision, and survey behavior.
- Desktop/mobile controls, accessible status, and visible error recovery.

## Reusable guided setup browser test

Added on 2026-10-17 at the user's request. Run `pnpm test:setup-ui` to execute
`scripts/test-guided-setup-ui.ts` against an already-running local preview.
`scripts/guided-setup-ui-fixture.ts` creates a temporary ordinary member,
community/vocabulary, and collection as prerequisites. The browser creates the
test term through the real application. All fixtures are removed after success
or failure, with identity checks before deletion.

The scenario covers:

1. A signed-out visitor sees the sign-in gate.
2. Community → Vocabulary → optional Collection → Terms → Review, including
   skipping a collection, Back navigation, and selecting one afterward.
3. Required term/definition validation and no publication before confirmation.
4. Autosave, immediate Back navigation, reload, and full-editor handoff with an
   example of use.
5. My drafts and resume in a fresh browser context with no prior local storage.
6. Breadcrumb edits, review of the latest writing, and desktop/mobile layout.
7. One real publication, one initial revision, the chosen collection membership,
   and the public definition page.
8. Removal from My drafts and safe reopening of an already-published draft.

Load the same `DATABASE_URL` and `SESSION_PASSWORD` as the preview, with
`GRAPH_PROJECTION_ENABLED=false`. The script refuses remote hosts and database
names without a disposable `_qa`, `_test`, `_ci`, or `_scratch` marker.

```sh
SAM_UI_TEST_URL=http://127.0.0.1:3109 \
SAM_UI_TEST_OUTPUT_DIR=/tmp/matsci-guided-setup-ui \
pnpm test:setup-ui
```

The output directory contains numbered screenshots, `results.json`, and a
screenshot plus visible text on failure. A single Chromium browser uses
sequential contexts; no build or service restart is needed. AI/reference
provider requests and unrelated writes are blocked and fail the test. Draft
saves and publication use real endpoints; they are not mocked. Authentication
uses an isolated test session, so this is not a login-provider test. Community
creation, standalone vocabulary creation, batch import, and real AI providers
are separate workflows.

Completed validation on 2026-10-17: all ten browser stages passed on the local
preview in Chromium at 1365 × 1000 and 390 × 844. The run created one term,
definition, initial revision, example, and collection membership, checked the
public definition, then removed its test data. There were no browser/console
errors, server errors, blocked provider calls, or unrelated mutations. Browser
plugin not available; validation used the repository's Playwright harness.

The test exposed and verified fixes for two regressions:

- Immediately using Back after the first save could unmount the term editor
  before the wizard received its new draft ID, causing duplicate drafts. The
  save queue now acknowledges the ID before an awaited flush resolves. The
  test asserts one stable draft ID and unchanged vocabulary/collection at
  each handoff. Unmount detaches the UI listener while allowing an outstanding
  save to finish, preventing an old editor from changing a newer editor's URL.
- Reopening a draft showed its saved example in the form, but the watched
  value started empty and could overwrite it during autosave. The watched
  value now starts from the saved example. Assertions check its contents in
  the UI and database through fresh-session resume, reload, both handoffs,
  review, and the published page.

The publication receipt also now labels its definition link **Open term**.
Queue and navigation regression tests, scoped ESLint, and TypeScript checking
pass. One intermediate browser attempt was interrupted by Next.js recycling
its own development worker at its memory threshold; no service was restarted
by the test. The complete subsequent run passed.

Local evidence (outside the repository):
`/home/chris/.codex/visualizations/2026/10/17/01a148d1-ab3d-7393-8445-4f4c79cb98cc/guided-setup-frontend-test/attempt-6/`
contains `results.json` and five desktop/mobile screenshots. Results include
draft identity and example checkpoints, publication IDs, and cleanup status.

## Superego acceptance follow-up — 2026-10-17

The guided setup and account drafts release was deployed to Superego in PR 134
(`21f2eaeb`). Live acceptance covered creation, publication, recovery, import,
Gemma assistance and Wolfram lookup. Follow-up display fixes are on
`codex/ui-acceptance-fixes` and have not yet been deployed:

- Newly created destinations show a neutral updating state until their refreshed
  options arrive. Genuine missing destinations still prompt for another choice.
- Restored model previews, applied drafts and Undo snapshots use friendly
  assistant names derived from the saved server evidence.
- Wolfram graphic-only sections link to the external resource without offering
  an empty image marker as text to insert. Surrounding readable text is retained.

The focused `pnpm test:display-ui` script uses the same local QA database guards
and browser harness as the guided setup test. It delays mocked destination
refreshes, reloads owned draft evidence, and checks Wolfram text insertion and
Undo at desktop/mobile sizes. It uses synthetic provider responses and deletes
its uniquely owned fixtures. All five scenarios passed at 1365 × 1000 and
390 × 844, without browser errors, unexpected requests or horizontal overflow.
TypeScript, scoped ESLint, setup/recovery, Wolfram, Agent One unit/router and
term-draft database regressions also pass. Final evidence and the live retest
are recorded in the private Superego acceptance record.

Agent One also succeeded on an unchanged live retest. The original generic
error did not retain enough detail to establish its cause. Allowlisted server
and admin-test diagnostics now identify HTTP, timeout, transport and invalid
response failures without including prompts, credentials or provider bodies.

The contributor's definition now uses a distinct pale blue surface in writing,
guided setup and review, with a matching dark-mode color. References and model
proposals keep their existing treatment. Desktop/mobile light/dark browser
checks pass. This visual follow-up is also local and not yet deployed.

## Remaining work and limitations

Copy follow-up (2026-10-17): replaced the guided setup introduction with a
matter-of-fact description of the steps: selecting or creating a community,
vocabulary, and optional collection, then adding or importing terms.

- The first version is implemented and verified on the local preview. No
  required implementation or verification work remains for this scope.
- This version covers new single terms. Batch imports, revisions, survey
  contributions, and collaborative review of drafts are outside this scope.
- Autosave needs a working connection. Failed saves keep the current editor's
  writing and show recovery controls, but there is no durable offline queue.
  Wait for **Draft saved to your account** before closing the page. Internal
  links flush pending edits. Browser Back makes a best-effort save; closing a
  tab may show an unsaved-changes warning where the browser permits it.
- Setup position, unfinished entity forms, and import text remain local to the
  current browser. Already-created communities, vocabularies, and collections
  remain saved independently of term drafts.
- Migrations 0065 and 0066 were applied to Superego with PR 134. Ego has not
  received this release. The follow-up display fixes remain local.
- The existing contribution-guard DB suite declined the `_qa` database name;
  its safety gate was left intact. The new draft DB suite covers quota,
  duplicate submission, concurrent publication, and retry behavior. A full
  production build was not run alongside the resource-limited preview.
