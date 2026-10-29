# Community interface inventory

## Compact review and source guidance, October 29, 2026

The review uses two columns for the four main rules on mobile. The review
filters remain on one row, and the response choices retain 44-pixel touch
targets. Empty comments are collapsed behind Comment (optional). Saved and
recovered comments open when the item loads. Full rules and comparison details
remain available through disclosures.

When value guidance exists, missing structured rules show Not recorded
separately. The disclosure is labelled Value guidance and field rules, with
the guidance near the top. This applies to the shared metadata components,
including independent community fields. It does not infer a rule from prose
or rewrite a source, draft or review snapshot. Verification is recorded in
[the progress document](matcore-workflow-progress.md).

## Phase Field member journey, October 29, 2026

The local review used a normal community member, with the existing MatCore
catalog and two realistic proposals. Desktop and mobile checks found these gaps.

| Finding | Local change |
| --- | --- |
| My work showed personal drafts but no shared feedback requests. | Requested feedback now appears first, with personal progress and the next unanswered item. Requests are shared review rounds, with no per-person draft copies. |
| Selecting a few fields from the full catalog required scanning a long list. | Review settings now search names, paths and definitions. Selection persists across searches. |
| Suggest a change from a reference could stop when a proposal already existed. | The action opens or resumes a private revision of that proposal and retains the return to the review item. |

The steward journey is Quick start, Manage reviews, name the review, select an
area and response style, open Choose items, clear the initial selection, search
and select exact reference/proposal versions, then Create review. The request
appears in My work for community members. Closing the review removes it from
requested work while preserving responses. No messages are sent.

The retained local example is Phase Field spacing and time increments. It
contains the reference and a proposal for `numerical-method.grid-spacing` and
`numerical-method.time-step-size.value`. The latter addresses wording in
[MatCore Table PF-5](https://matcore.org/standard-document-content.html), where
value guidance refers to grid spacing. These are proposals for consideration,
not accepted changes or MatCore decisions. No example votes are retained.

The 1280-pixel member view, 1440-pixel steward view and 390-pixel mobile view
passed the realistic journey. The initial mobile view had no horizontal overflow, though the
field rules still require scrolling before the response controls. Some imported
rules remain unstructured in source guidance, so Not specified in a structured
summary must not be taken as absence from the source specification. Improving
that distinction was a presentation follow-up, addressed in the compact review
entry above. The source baseline was
not rewritten during this work.

Evidence and complete verification are recorded in
[the progress document](matcore-workflow-progress.md).

## Conference participation review, October 29, 2026

Status: the following records the design and source review. Implementation and
local acceptance are complete; see [the October 29 progress entry](matcore-workflow-progress.md#community-reviews-implementation-october-29-2026).
No remote content or memberships were changed. Quick start, reusable review
rounds, configurable response presets and bounded invitations are now available
locally. Real provider signup and shared-server verification remain deployment
checks.

The immediate purpose is Daniel's conference feedback on Phase Field. A shared
link should take a participant to the relevant fields, offer a response where
the field is shown, and provide a nearby route to suggest a change. The user
confirmed that recording votes means recording who voted on each proposal,
not rating contributors. A queue of items the person has not reviewed is part
of the proposed workflow.

### Findings

The deployed MatCore page was inspected as an ordinary member on Ego. The
Materials Metadata Examples page was inspected for comparison. The review
followed Standard, the Phase field filter, Proposals and People without
creating application records. Screenshots are in the parent workspace under
`.matsci-stage/community-quick-start-review-20261029/`.

- MatCore opens the full 248-field catalog. Phase Field is under a selector
  labelled Profile. Selecting it shows 47 fields and a separate common-core
  link. Selecting Proposals loses that filter. The proposal list has a status
  filter but no area selector, personal response filter or voting control.
- The visible proposal list has no entries awaiting review. Its prominent
  creation action is Propose a new field. The action to change an existing
  field is reached through the catalog.
- The metadata proposal component provides changes, discussion, history and
  steward decisions. It does not expose member votes. Independently submitted
  metadata proposals can have no dictionary definition revision, so adding the
  existing definition vote control would not cover this workflow.
- Ordinary definition votes already retain the voter, exact revision, community
  context and event history. Their public presentation limits voter identity.
  Recording an identity does not authorize exposing it to other participants.
- The ordinary community overview offers Browse vocabulary and Open my work.
  It can use the same task-oriented entry component with different capabilities.
- Existing surveys track term-based Position and Review steps. Metadata catalog
  occurrences are not dictionary terms. A conference review must not manufacture
  dictionary entries merely to satisfy that schema or alter existing surveys.
- Private communities reject open join links. Named invitations and approved
  requests work, but a reusable conference admission link would require an
  explicit new, bounded invitation policy. A Phase Field filter is not an access
  boundary within MatCore.

### Proposed participant flow

The general community entry should open Quick start. The conference link should
open the Phase Field review directly after any required account creation and
admission. An existing member should reach the review queue directly.

Recommended primary navigation is Quick start, Review, Standard, My work,
People, then More. Ordinary vocabulary communities use Vocabulary in place of
Standard. Show Review only when the community has a configured review round or
reviewable items. Existing proposal links remain valid and open the corresponding
proposal view or queue. Existing deep links must not be redirected to Quick start.

Quick start contains an optional area selector and three actions:

| Action | Destination | Short description |
| --- | --- | --- |
| Review fields | Selected area's review queue | Give feedback on fields and proposed changes. |
| Suggest a change | Search or hierarchy in the selected area | Choose a field to revise. |
| Continue my work | The person's relevant drafts and responses | Resume a draft or revisit your feedback. |

Use the home-page button and information-popover pattern, with these community
tasks instead of community or vocabulary setup actions. Keep rules and background
explanations in concise popovers or linked help. Counts, saving state, access
restrictions and submission consequences remain visible.

The review screen presents one field or proposal at a time:

1. Area, field name, parent path and version identify the item.
2. Definition and main field rules provide the material being reviewed.
   A proposal also shows changes from its stated reference.
3. Response choices appear immediately below it, with an optional comment.
4. Suggest a change opens the existing draft workflow for that exact target.
5. Save and next records the response before advancing. Skip for now advances
   without recording a vote or marking the item reviewed.

Provide Not yet reviewed, My responses and All items. Show progress for the
chosen review set, and retain the area and queue position through login, drafts,
tab changes and return navigation. A saved response can be changed. Not sure is
an explicit response and is distinct from skipping or not participating.
The reference remains unchanged, and votes do not automatically accept a
proposal into the working version.

A conference review round should identify an explicit set of versions. Daniel
can select a shorter set from the 47 Phase Field fields rather than require
completion of the full catalog. Common-core fields are separately selectable.
New revisions must not silently replace the items participants already reviewed.
Use a separate indication when a newer revision is available for another review.

### Reusable structure

Keep one community page shell. Add capability-based modules for Quick start,
area selection, review queue, response controls and personal progress. Community
configuration supplies labels, available areas, initial area and enabled tasks.
The MatCore adapter supplies profile names, field occurrences, reference versions
and inherited context. No shared component should select a layout by community
name or slug. Other communities can use their own area configuration or omit
the selector. Do not add an arbitrary plugin loader or a duplicate MatCore page.

Separate three concepts in data and permissions:

- An area selects work within a community. Selecting it does not grant access,
  join another community or modify a proposal's stored scope.
- A review round specifies the exact items and versions requested for feedback.
  It can support a conference or an ongoing review without changing survey data.
- Admission grants access through an invitation or approval. It is checked on
  every content and write endpoint, independently of navigation or filters.

Metadata feedback needs targets for a reference occurrence in a source release
and for an immutable community proposal revision. Reuse an existing versioned
dictionary target only when the item actually is a dictionary definition.
Use database constraints for target identity and ownership. Record respondent,
target version, community, review round, response, comment when supplied and time.
Retain changes and withdrawals as history and prevent duplicate current responses
from repeated clicks. Keep field feedback, proposal support, discussion and steward
decisions distinct. Existing definition votes and survey records are preserved.

Recommended initial visibility is aggregate counts and the participant's own
response in the review screen, with identified responses available to authorized
review organizers. Public voter identities and reputation scores are outside this
change. Confirm any broader identity display separately.

### Agreed scope and response configuration

The user chose to include existing fields and proposals, with responses tied to
the version shown. Conference participants should join MatCore and open Phase
Field. Their ordinary membership also permits other MatCore sections. This is a
design decision for conference admission, not a request to make the catalog public
or issue a live join link during this review.

The user found Works for me too casual and requested consideration of a selectable
review style. Use one reusable response panel, configured under Community settings
-> Reviews by an authorized organizer. Recommended initial presets are:

| Preset | Response labels | Scope |
| --- | --- | --- |
| Field assessment | Suitable as written / Needs revision / Unable to assess | The displayed definition and field rules |
| Proposal review | Support this change / Needs revision / Unable to assess | The displayed proposed changes |
| Definition voting | Upvote / Downvote | An existing dictionary definition revision |

The first two presets suit the conference. Keep existing dictionary voting
available for ordinary vocabulary communities. Reuse presentation components
without mapping field responses into unrelated dictionary vote rows.

A preset specifies a stable meaning and response codes as well as visible labels.
Snapshot the preset identifier, version, question, options and their meanings
with the review round. Organizers can select a preset before responses begin.
Changes to the question, target scope or response meaning create a new round
version rather than relabelling recorded responses. Arbitrary weighting, a
questionnaire builder and contributor ratings are outside the first version.

The private-community conference invitation is a new admission mode. It needs an
explicit steward action, expiry, revocation and a destination restricted to the
same community and review round. Opening or previewing a link cannot admit a
person. The participant must authenticate and explicitly join. Expiry or revocation
stops future admissions and does not silently remove existing memberships.
Existing named invitations, approvals and public-community join links retain
their behavior. Do not enable the existing unrestricted join-link path for a
private community as an implementation shortcut.

### Implementation and acceptance order

Build locally from this design. First add versioned metadata
responses and the reusable review queue. Then add Quick start and retained area
navigation. Add the configured conference admission mode and retained destination.
Update community and participation help to match the visible workflow. Record
implementation and testing separately from this design review.

Acceptance must cover an ordinary vocabulary community and MatCore, ordinary
member and organizer roles, desktop and mobile. Test the shared link through
Google and email signup, existing-member entry, denied private access, expired
and revoked invitations, and preservation of the review destination. Test saving,
reload, two tabs, rapid clicks, interrupted saves, editing a response, skipping,
new versions, exact-version counts and return from a proposal draft. Confirm that
prior drafts, baseline fields, provenance, votes and survey records are unchanged.
Use local or Superego fixtures for mutation tests before any Ego deployment.

## Earlier interface review

The shared community template now separates browsing, private work and settings.
Installed catalogs, enabled tools, permissions and available work determine the
visible controls. Community names and slugs do not select a special layout.
Catalog search and the changes below follow the October 23 usability review.
The original observations remain below as a record of that review.
Implementation and verification are recorded in
[metadata workflow progress](matcore-workflow-progress.md).

- Overview offers vocabulary browsing and recent private work for its author.
- My work places saved sections before empty ones, with creation actions in
  the corresponding term or field section.
- Catalog communities have separate reference and contribution views. Search
  covers the selected version and profile before pagination, with page controls
  above and below results.
- Settings contains access and workspace controls for authorized managers.
- The header identifies the saved default community. Visiting a different
  community does not change that selection.
- Information popovers provide field and source context on request. Visibility,
  save status, errors and publication consequences remain visible.

## Recommendation

Keep Overview, Vocabulary, My work, Collections, People and the conditional
Surveys view. Add **On this page** navigation inside long views that contain
several useful sections. Use search, filters and pagination to navigate long
lists. A section navigator should not contain a link for every draft or term.

Start with My work. Bring saved work closer to the top, make creation controls
compact, and keep workspace configuration separate from routine contribution.
The same pattern can then serve People, import review, Profile and collection
detail pages when they contain several sections.

## Original evidence and scope

The signed-in local MatCore Development **My work** view was inspected in the
in-app browser as an ordinary member, at 1280 × 720. It contains 248 private
metadata drafts, with 40 entries on the current page. The rendered document is
5,195 pixels tall, approximately 7.2 viewport heights. The metadata draft list
starts at vertical position 939 pixels, below the first screen. An empty
ordinary-term draft card and metadata introduction/creation controls precede
it. Pagination is only below the list. The community navigation scrolls away.

The view has no section navigator. Most visible section headings lack stable
IDs; `my-field-drafts` is already available. The screenshot and DOM measurements
are saved outside the repository in
`.matsci-stage/matcore-dev/community-interface-inventory/my-work.png` and
`measurements.json`, relative to the parent workspace.

The wider inventory below is based on source inspection, including independent
reviews of surrounding workflows and navigation behavior. It is not a new
acceptance run of every route, role or screen size. The existing header suite
already passed seven groups and checked 22 destinations in the preceding work.
The original review created no application content and changed no services or
databases. Subsequent implementation and local UI test results are recorded in
the progress document.

## Prioritized inventory

| Priority | Surface | Current difficulty | Recommended change | Evidence |
| --- | --- | --- | --- | --- |
| First | Community My work | Several screens of content with no outline; frequent work begins below empty states and setup controls. | Add section navigation, a compact creation row, smaller empty states and direct access to saved work. Keep permissions and save/import warnings visible. | Rendered view; [CommunityWork](../../components/communities/community-work.tsx), [WorkspaceList](../../components/metadata-workspace/workspace-list.tsx). |
| First | Term draft and import return paths | Work launched in a community returns to the global term-draft list. Metadata editors already return to the owning community. | Use a contextual “Back to [community] · My work” link. Keep global My term drafts available through the account menu. Preserve filters and list position on return. | [TermDraftController](../../components/definition/term-draft-controller.tsx), [import page](../../app/profile/drafts/imports/[id]/page.tsx), [field draft page](../../app/metadata/workspace/[draftId]/page.tsx). |
| Next | Metadata drafts | Section filtering is available, but there is no search or status filter. A user must pass 40 rows to reach pagination. | Search by label and field path; filter private drafts versus published proposals; show pagination above and below the list. Keep the existing core/DFT ordering as the default and offer recently edited as an alternative. Search/filter the full authorized result set before pagination. | Rendered view; [WorkspaceList](../../components/metadata-workspace/workspace-list.tsx). |
| Next | Community Vocabulary | Every entry is a label and definition count. Metadata fields look like ordinary vocabulary terms; there is no local search. | Add search and an entry-type filter. Mark entries that have a metadata specification and provide a direct specification link. An entry can have a definition and a specification; avoid presenting these as mutually exclusive kinds of knowledge. | [community page, Vocabulary view](../../app/communities/[slug]/page.tsx). |
| Next | Import review | Rows of every status precede the review action; publication review and source reuse are farther down. | Add term search, readiness filters with counts, section jumps and a nearby selection/action summary. After review, move focus to the review heading. Preserve the explicit publication step and existing review/version checks. | [ImportOverview](../../app/profile/drafts/imports/[id]/import-overview.tsx). |
| Next | People | A long roster can push Invitations and Open join link out of sight. | Provide section links when those sections are available to the current user. Make “People,” “Invitations” and “Join link” distinct destinations. No entry for hidden management controls. | [community page, People view](../../app/communities/[slug]/page.tsx). |
| Next | Profile and private work | Profile offers “My drafts,” but that list covers ordinary term drafts and imports, not metadata drafts. | Label it “My term drafts” consistently and add a clear route to community metadata workspaces. For long profiles, use About, Surveys, Drafts and Authored terms section links. Private draft counts must remain account-scoped. | [Profile](../../app/profile/page.tsx), [drafts page](../../app/profile/drafts/page.tsx). |
| Next | Metadata editor and published fields | The existing three tabs separate tasks well, but the selected tab cannot be linked directly. Validation messages do not take users to the relevant input. | Keep Definition / Field specification / Sources & history. Make destinations addressable and link validation errors to the correct tab and field. Do not add another full contents menu to a short tab. | [FieldEditor](../../components/metadata-workspace/field-editor.tsx), [PublishedField](../../components/metadata-workspace/published-field.tsx). |
| Later | Collections and Surveys | Survey collections are excluded from the Collections view; explanatory text does not provide a direct route. | Add an explicit “Survey collections” link when appropriate. Preserve the distinction and existing survey behavior. Collection detail pages can use Worklists / Terms section jumps when both sections are present and substantial. | [community page](../../app/communities/[slug]/page.tsx), [collection detail](../../app/collections/[slug]/page.tsx). |
| Later | Ordinary term entry | Confirm term / Write definition / Review and publish indicates progress but cannot be used to revisit an available step. | Make available earlier steps usable navigation. Keep review gated by validation and reuse the existing guarded transitions. | [DefinitionForm](../../components/definition/definition-form.tsx). |
| Keep | Header and short community views | Header duplication has just been removed; Overview is short and focused. | Retain the current categories and single community directory. Do not add a contents menu to an empty or one-section view, or duplicate the global menu inside every page. | [Header](../../components/header.tsx), [CommunityNavigation](../../components/communities/community-navigation.tsx). |

## Proposed community layout

The community title and existing view links remain above the content. Within
My work, a compact row provides the permitted creation actions. A wide screen
then has a narrow left navigation column and a full reading column:

| On this page | My work content |
| --- | --- |
| Term drafts | Saved ordinary-term drafts, or a compact empty state |
| Term imports, when present | Import batches and their review status |
| Metadata drafts, when available | Search, filters, result count, pagination and field drafts |

Use “Metadata drafts” for the navigation label while retaining the existing
`my-field-drafts` target. Avoid separate outline entries for “Metadata fields,”
“Develop a metadata field” and “My field drafts”; they are parts of the same
task. Define a term, Import terms and New metadata field should be visibly
distinct actions. Show the field action only when creation is enabled and
permitted. Existing drafts must remain accessible if creation tools are off.
The MatCore standards import remains an explicit, secondary contribution
action with its existing confirmation. Preserve access for permitted
contributors when MatCore is enabled; it must not become a manager-only tool.
Ordinary imports must not silently trigger it.

On small screens, replace the side column with a compact **On this page**
disclosure. Keep its collapsed trigger available while scrolling, close it
after a jump and show the current section. Bound the expanded menu so it cannot
fill the screen or obscure focused controls. Do not stack a sticky site header,
sticky community tabs and a third large navigation bar. Switch to the compact
pattern whenever the side column would squeeze the content, including at zoom.

Use three to six broad destinations on a busy view, fewer when appropriate.
Omit the navigator when fewer than two useful sections exist. Lists need their
own search and paging, rather than a growing contents menu. No automatic jump
should occur just because drafts finish loading or a count changes.

## Interaction and accessibility

- Use a labelled navigation landmark and ordinary fragment links. Give target
  headings stable, explicit IDs that do not change when wording changes. Build
  the link inventory from the same conditions that render the sections.
- Keep the current section visibly marked and expose
  `aria-current="location"`. Track scrolling without changing the URL or moving
  keyboard focus. A deliberate section-link click should focus the target
  heading and use the existing arrival highlight.
- Preserve the view, search, filters and pagination when following a local
  fragment. Explicit clicks should support normal Back/Forward history;
  passive scrolling should not create history entries.
- Reveal a permitted collapsed target before focusing it. Never show an
  unauthorized section because its hash was supplied. Keep the existing
  `#studies` compatibility route and `#my-field-drafts` links working.
- Ensure headings and keyboard focus remain visible below any sticky control.
  Support reduced motion, high contrast, zoom and narrow screens. Instant
  scrolling is sufficient; animation is not required.
- Keep actual page/view navigation subject to existing save guards. A jump
  within an editor must not remount it, discard writing, publish, or bypass
  saving. Browser Back/Forward between hashes must not cause a save loop.

This follows WAI's guidance on
[in-page navigation](https://www.w3.org/WAI/tutorials/page-structure/in-page-navigation/).
Sticky elements also need to respect
[focus visibility](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum).

## Implementation notes

Introduce one reusable `OnThisPage` component with an explicit ordered section
list, rather than scanning every heading, card or dialog in the DOM. Keep
current-section observation local and inexpensive. Rebind when the selected
view or available sections change. Server authorization remains authoritative.

Extend the existing [ArrivalHighlight](../../components/arrival-highlight.tsx)
instead of creating a competing scroll/highlight system. It currently observes
pathname changes, hash changes and fragment-link clicks, but not search-parameter
changes directly. A transition such as `?view=people#invitations` on the same
pathname needs a deliberate post-render check. It currently highlights without
moving focus; focus handling should distinguish deliberate navigation from
passive observation.

[ViewTabs](../../components/interface-view.tsx) already reveals targets in
Simple/Advanced views without changing the stored preference. Coordinate that
behavior with the metadata tabs and collapsed details; do not assume it already
opens those controls. Retain the existing reduced-motion and forced-color
[arrival styling](../../app/globals.css).

The current [term draft guard](../../components/definition/term-draft-controller.tsx)
and [field draft guard](../../components/metadata-workspace/use-field-draft.ts)
exempt same-path, same-query fragment clicks. Their `popstate` handlers can
still flush dirty work, so fragment history needs explicit regression coverage.
Contextual return destinations should be derived from the draft's authorized
vocabulary/community and restricted to validated local routes.

The navigation layer itself needs no new database tables or packages. List
search/type filters may need additional read queries or result fields; retain
server-side scope and existing publication visibility rules.

## Delivery order and acceptance checks

1. **Community navigation:** build the reusable section navigator, apply it to
   My work and eligible People views, compact My work's empty/setup areas, and
   preserve community return paths from drafts and imports.
2. **Finding work:** add full-result search/filtering, top and bottom pagination,
   consistent private-work labels and metadata specification indicators.
3. **Related long pages:** extend the navigator to import review, Profile and
   collection details where justified; improve tab targets and validation links.

For the first delivery, verify keyboard and pointer jumps, visible target focus,
arrival highlighting, current-section tracking, direct fragment entry and
Back/Forward. Check desktop, a 390-pixel viewport and zoom/reflow. Cover an
ordinary member, a manager, a signed-out visitor, an empty community, generic
metadata and MatCore. Assert that unauthorized links/content never appear and
that disabled creation tools do not hide retained drafts.

Exercise return navigation with unsaved edits, a failed save and a conflict.
Verify that query filters, pagination and the return location survive. Keep
existing draft/provenance preservation checks. Search acceptance must include
matches beyond the first 40 rows, no results, combined filters and private
isolation. The original planning review did not verify new UI behavior; see the
progress document for the subsequent implementation's acceptance results.
