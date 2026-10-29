# Metadata fields and MatCore

The community opens on **Quick start**. Choose an area, such as Phase Field,
and select **Review and respond** to give feedback on existing fields and
proposed changes. **Suggest a change** opens the standard so you can choose a
field to revise. **My work** lists requested feedback above your private drafts.
Each review shows your progress and a link to the next unanswered item.

**Standard** opens the **Working version** in **Hierarchy** view.
**More → Proposals** opens shared changes and their discussion. See
[Review and respond](/docs/communities#review-and-respond) for saving feedback
and organizing review rounds.

A members-only community shows its name publicly. Its sources, proposals and
releases are available to members and site administrators. See
[Community access](/docs/communities#content-access) for requests and membership.
The [workspace chooser](/metadata/workspace) also lists standalone vocabularies.

For a vocabulary concept such as solid electrolyte, use **Define a term** or
the usual [term editor](/docs/adding-terms). A metadata field specifies
information to record, such as the temperature used to prepare a sample.
A community can develop both kinds of entry. **More → Vocabulary terms**
opens its dictionary entries.

## Reference, proposals and releases

| View                  | What it contains                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Reference**         | The publisher's preserved specification, including its source version and attribution.                      |
| **My work**           | Private proposed changes. Saving a draft does not change the reference or share it with other members.      |
| **Proposals**         | Submitted revisions for discussion and steward review. Pending proposals do not change the working version. |
| **Working version**   | The selected reference with accepted community changes applied.                                             |
| **Community release** | A named snapshot created by a steward, with exact field revisions and review decisions recorded.            |

Community acceptance and releases do not imply approval by MatCore or another
reference publisher. The reference always remains unchanged.

Earlier drafts keep their edits and history. They are working copies, not
historical releases. Select **Continue my draft** on the corresponding source
entry to resume one without importing it again. Existing dictionary links are
preserved. New metadata proposals have their own field identity and do not
create dictionary entries.

## Start a metadata field

A community steward or site administrator can open **Settings**, then
**Workspace tools**, and select **Enable metadata development**. This adds the field tools without
requiring a standard or profile. Enabling **MatCore** is a separate choice.
A site administrator must also install and grant a source version to this
community. Until then, the catalog is empty and independent metadata fields
remain available.

Select **Propose a new field** on Standard and enter a field name.
**New metadata field** is also available under My work. The draft belongs to the
community vocabulary. A new field has no imported source baseline. When
MatCore is enabled and a source is available, **Standard context** lets you optionally choose a MatCore
section. Leave it unset for an independent field.

Your ordinary term drafts and field drafts appear in **My work**. These lists
are private to your account and limited to the selected community. Other
community members cannot read your private drafts. Changing the community
view does not move drafts or change their vocabulary.

## Propose a change to a MatCore field

Open **Standard**, choose **Reference**, then select a **Reference version**
and **Profile**. **Find a field** searches names, paths and definitions. Browsing
creates no drafts. Available versions are the snapshots installed for this
community.

**Hierarchy** is the default view and shows fields within their parent context. Use the arrow to expand
a branch and the field name to open it. Search keeps matching fields and their
parent paths visible. **List** shows every field in the selected profile. Links
under **Includes fields from** identify inherited profiles.

The field name is separate from its path. For example, `name` can occur at both
`creator.name` and `computation.software.name`. The profile and path identify
where it belongs. Requirement, repeatability, data type and value form are
visible beside the definition. Expand **Value guidance and field rules** for
the source wording and remaining specification. When there is no value guidance,
the control is labelled **All field rules**.

Open a field and select **Propose a change**. This creates one private draft
based on that reference field. If you already have a draft for the entry,
select **Continue my draft**. Existing edits are kept. The original source stays
unchanged when you edit, save or publish your proposal.

In the editor, **Back to working version** or **Back to reference** saves pending changes before returning
to the same version, profile, search, view and field. **Back to fields** returns to the list or hierarchy. This browser tab
remembers expanded branches and the reading position when browser storage is
available. If saving
fails, your writing stays in the editor and **Retry save** is available. The draft
also appears under **My work** in the community.

Sign in with an account that can contribute to the community. If your account
needs an attributed name, follow **Add your name to your profile** before
creating a field draft. When a local proposal has been published, **View proposal** opens it. Further revisions start from that proposal through
**Propose a revision**. Members can discuss a submitted proposal. Community stewards review it and
create community releases.

Later source snapshots do not automatically update existing drafts or
published proposals. Each keeps the source version it was based on. Switching
**Reference version** changes what you browse. It does not move your edits to that
version. Comparing a proposal with a newer source version and applying changes
forward are not available yet.

The preliminary 2025 reference catalog retains its original identifiers and
source. It is linked separately. Its entries are not automatically equated
with fields in later snapshots.

## Prepare MatCore drafts in bulk

You can still prepare working copies of a whole source version when needed.
In **My work**, expand **Prepare drafts in bulk** and select **Import all
sections as drafts**. Check the destination and select **Import private
drafts**. The MatCore 0.3.0 import covers 248 source entries across seven
sections. It creates missing drafts and preserves existing drafts and edits.
Each draft retains the field path and source context. Common core and density
functional theory appear first for review. Use the **Section** filter to select
molecular dynamics, many-body perturbation theory, machine learning, phase
field or derived properties.

The import saves groups of drafts as it progresses. **Pause after this group**
stops after the active group finishes. To resume, open the same community and
import again. Saved drafts and your edits remain available.

## Define the field and its rules

Open a draft from **My field drafts**. **Field specification** opens first.
**Definition** and **Sources & history** follow it.

| Tab                     | What to enter or review                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Field specification** | Field rules, path and format. Expand More specification details for units, allowed values, example values, guidance and notes. |
| **Definition**          | The field name, an explanation of what to record, requirement, repeatability, data type, value form and an optional example.   |
| **Sources & history**   | The reference, supporting citations and recorded contribution history.                                                         |

Keep the parent path when editing a nested field. For example, `creator.name`
and `computation.software.name` describe different information. For fields
linked to MatCore, **Profile context** identifies inherited sections and any
method selection required for derived properties. Independent fields
have no MatCore profile.

A required child field applies within its parent context. A conditional rule
needs an explanation of when it applies. **Not specified** means no structured
rule is recorded. When value guidance is available, the summary uses
**Not recorded separately** for a missing rule. Expand the guidance to read
the source wording. Neither label means optional.

**Data type** describes the value or its items, such as text or a number.
**Value form** distinguishes a single value, a list and an array. **Repeatable
field** says whether the field itself can occur more than once. A field can
hold a list of text values and still occur only once. Older drafts with a List
value type show List as their value form and leave the item type unspecified.

For an imported field, the main controls show the reference rule below
your selection. Expand **Compare with source rules** in **Field specification**
to see the source and proposal together. Editing the proposal does not change
the baseline. Earlier imports may keep source notes within **Value guidance**
or the original source text. **Not recorded separately** means no separate
Notes value was stored. Independent community fields use the same controls
without a source comparison.

Use **Add citation** under **Sources & history** to record a source title,
address and an explanation of its relevance. Supporting citations are counted
separately from an imported baseline, if present. Imported source wording,
location and attribution remain available after you edit the proposal. A new
independent field records your citations and contribution history without
claiming an imported source.

Enter a **Reason for this proposal**. Explain your changes or why the source
field should be adopted. This explanation is shared with readers who can access the community when you
submit the proposal.

## Save and resume

Drafts save privately to your account as you edit. Wait for **Draft saved to
your account** before closing the page. **Save draft** saves immediately, and
the **Back to [community] · My work** link returns to the community workspace,
retaining your field filter, result page and section. It waits for unsaved
changes to save before leaving. Standalone vocabularies return to their field
workspace. Saved work is available when you sign in on another device.

If a save fails, select **Retry save** when the connection is available. If you
use browser Back and return to the draft, this tab keeps a recovery copy of
unsaved writing. **Recovered unsaved changes from this tab** means that writing
still needs to be saved to your account; select **Save draft**. Recovery is
limited to this tab and account. If browser storage is unavailable, a warning
explains that the copy lasts only while this app remains open. Save before
closing or reloading the tab.

A newer-version warning means another tab or device saved a change. Recovery
never replaces that newer version automatically. Copy any unsaved writing you
want to keep, then select **Reload saved draft** to replace this editor with
the saved version. **Keep editing** leaves your writing in place. If another
tab published the draft, the recovered proposal remains available as text to
copy before loading the published version.

## Submit and review

Select **Review proposal** to check the definition, field rules, differences
from the source and citations. A field name, definition and reason are required.
Add your name to your account profile before submitting.

Select **Submit for review** to share the proposal with the community. It appears
under **Proposals** as **Awaiting review**. **Changes** opens first and compares
the proposal with the preceding revision of that field, or with the reference
for its first revision. Members can add attributed comments in **Discussion**.
The complete **Field specification** and **Sources & history** follow those tabs. Comments and decisions belong to the exact revision.
Sources and history follow the community's access rules. In Proposals, the
**Reference version** selector lets you review work based on an earlier source.

A community steward or site administrator can open **Discussion**, select
**Review proposal**, and choose **Accept into working version**, **Request changes**
or **Decline**, with a reason. Acceptance applies
the revision to the working version. An older accepted revision stays in use
while a newer proposal awaits review. Two fields may share a short name, but
they cannot use the same path in the same profile in the working version.

Use **Propose a revision** on the latest proposal to start another private
draft. Earlier revisions remain available through **Revision**. **Download
specification** exports the selected proposal, its source context and history
as JSON. This is not an executable dataset validation schema.

The contributor or a site administrator can **Withdraw proposal**, with a
reason. Its source and history remain available. Withdrawing an accepted
revision removes that decision from the current working version. Existing
community releases remain unchanged.

## Create a community release

Open **Working version** to review the assembled standard. Each field identifies
whether it is unchanged from the reference or an accepted community change.
**Compare with reference** shows the original definition and field rules.

A steward or site administrator selects **Create community release**, enters a
name and optional notes, and confirms. The release records the selected reference,
field contents, accepted revision IDs and review decisions. If the working version
changes before confirmation, reload and review it before trying again.

Use **Community release** to browse a frozen version, or **More → Community
releases** to find earlier releases. Later proposals and decisions do not alter
these snapshots. Installing a newer publisher reference does not transfer
existing proposals to it. Applying changes across reference versions remains a
separate review task.

## Workspace tools

Field proposals support linked citations and manual editing. AI assistance,
file uploads, shared draft editing, assigned reviews, notifications and dataset
validation are planned separately. The field editor does not run the ontology
lookup used by the vocabulary term editor.

The [2025 reference catalog](/metadata/matcore) preserves the earlier MatCore
transcription and its identifiers. [MatCore and the vocabulary](/docs/reference/matcore-and-the-vocabulary)
explains the relationship between that catalog, community field development
and term metadata.
