# Community interface inventory

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
