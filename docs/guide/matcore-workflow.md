# Metadata fields and MatCore

The community opens on **Quick start**. Choose an area, such as Phase Field,
and select **Give feedback** to give feedback on existing fields and
proposed changes. **Suggest a change** opens the standard so you can choose a
field to revise. **My work** lists requested feedback above your private drafts.
Each review shows your progress and a link to the next unanswered item.

**Browse → Metadata fields** opens the **Working version** in **Hierarchy** view.
**Contributions** opens shared changes and their discussion. See
[Review and respond](/docs/communities#review-and-respond) for saving feedback
and organizing review rounds.

A members-only community shows its name publicly. Its sources, proposals and
releases are available to members and site administrators. See
[Community access](/docs/communities#content-access) for requests and membership.
The [workspace chooser](/metadata/workspace) also lists standalone vocabularies.

For a vocabulary concept such as solid electrolyte, use **Add term** or
the usual [term editor](/docs/adding-terms). A metadata field specifies
information to record, such as the temperature used to prepare a sample.
A community can develop both kinds of entry. **Browse → Terms**
opens its dictionary entries.

## Reference, proposals and releases

| View                  | What it contains                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Reference**         | The publisher's preserved specification, including its source version and attribution.                      |
| **My work**           | Private proposed changes. Saving a draft does not change the reference or share it with other members.      |
| **Contributions**         | Submitted revisions for discussion and steward review. Pending proposals do not change the working version. |
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

A community steward or site administrator can open **Manage community**, then
**Workspace tools**, and select **Enable metadata development**. This adds the field tools without
requiring a standard or profile. Enabling **MatCore** is a separate choice.
A site administrator must also install and grant a source version to this
community. Until then, the catalog is empty and independent metadata fields
remain available.

Select **Propose a new field** under **Browse → Metadata fields** and enter a field name.
**New metadata field** is also available under My work. The draft belongs to the
community vocabulary. A new field has no imported source baseline. When
MatCore is enabled and a source is available, **Standard context** lets you optionally choose a MatCore
section. Leave it unset for an independent field.

Your ordinary term drafts and field drafts appear in **My work**. These lists
are private to your account and limited to the selected community. Other
community members cannot read your private drafts. Changing the community
view does not move drafts or change their vocabulary.

## Propose a change to a MatCore field

Open **Browse → Metadata fields**, choose **Reference**, then select a **Reference version**
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

## Download an XML template

Open **Browse → Metadata fields** and choose **Reference**, **Working version** or a
**Community release**. Select **Download XML template**, choose a section and
select **Download**. The file includes every field in that section, regardless
of the search filter. Download inherited sections, such as Common core, separately.

The template uses nested XML elements with `FILL` placeholders for dataset
values. `FILL*` marks a field required within its parent. Comments describe
repeatability and the other field rules. Replace the placeholders, remove unused
optional elements and copy repeatable elements with their children as needed.
The template is not an executable validation schema.

The file identifies the selected version and section. Working versions include
accepted community changes. Private drafts and proposals awaiting review are
excluded. A named community release retains its original field rules.
Download access follows the same permissions as the field view.

Independent community fields can also be exported without a MatCore reference.
If a path cannot be represented in XML, or conflicting field rules prevent the
export, the download reports the affected field.

## Review a dataset against a reference

A steward can enable the optional dataset exercise when requesting feedback.
It follows the selected reference version and section. Members can describe a
dataset, complete a metadata XML template, then comment on fields or propose
changes. A comment does not require a vote. See
[Use a dataset example](/docs/communities#use-a-dataset-example).

The supplied v0.5.0 specification and the Phase Field review guide labeled
v0.3.0 are separate references. Check the version shown in your review before
completing its template. Installing a newer reference does not move earlier
drafts, proposals, accepted changes or responses to that version. A review
guide can describe the exercise without changing the round's selected reference.

## Prepare MatCore drafts in bulk

You can still prepare working copies of a whole source version when needed.
In **My work**, expand **Prepare drafts in bulk** and select **Import all
sections as drafts**. Check the destination and select **Import private
drafts**. Choose the installed reference version. MatCore 0.3.0 has 248 source
entries and the supplied 0.5.0 reference has 255, both across seven sections.
The import creates missing drafts and preserves existing drafts and edits.
Each draft retains the field path and source context. Common core and density
functional theory appear first for review. Use the **Section** filter to select
molecular dynamics, many-body perturbation theory, machine learning, phase
field or derived properties.

The import saves groups of drafts as it progresses. **Pause after this group**
stops after the active group finishes. To resume, open the same community and
import again. Saved drafts and your edits remain available.

## Define the field and its rules

Open a draft from **My field drafts**. **Definition** opens first.
**Field rules** and **Sources & history** follow it.

| Tab                     | What to enter or review                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Definition**          | The field name, an explanation of what to record, requirement, repeatability, data type, value form and an optional example.   |
| **Field rules** | Field rules, path and format. Expand More specification details for units, allowed values, example values, guidance and notes. |
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
your selection. Expand **Compare with source rules** in **Field rules**
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
under **Contributions** as **Awaiting review**. **Definition** opens first, with
field rules below it. Select **Changes** to compare
the proposal with the preceding revision of that field, or with the reference
for its first revision. Additions are underlined and removals are struck through.
The comparison includes definitions, examples, field rules and citations.
When both are available, **Compare with** switches between the preceding
revision and the reference.

Use **Reference version** in **Contributions** to find proposals based on an
earlier specification, such as v0.3.0, or the latest reference, such as v0.5.0.
Your search, type, status and area filters remain selected. Each proposal keeps
its original reference and revision history. Term definitions appear across
reference versions.

Members can add attributed comments in **Discussion**.
**Sources & history** follows Discussion. Comments and decisions belong to the exact revision.
Sources and history follow the community access rules. Existing proposals
retain the reference version on which they were based.

In **Sources & history**, select **Show provenance graph** to see the selected
revision's author, reference, citations and recorded submission and review
decisions. Select a revision node to inspect its changes or open that revision.
History entries also link to their recorded revision.

A community steward or site administrator can select
**Record decision**, and choose **Accept into working version**, **Request changes**
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

## Request feedback and export proposals

Select proposals in **Contributions**, then **Request feedback** to organize a
review. You can include ordinary term definitions in the same round.
**Export review packet** prepares selected revisions, changes, sources,
feedback and decisions for discussion outside MatSci-SAM. Pending proposals
remain pending after export. See [review packets](/docs/communities#export-a-review-packet).

## Create a community release

Open **Working version** to review the assembled standard. Each field identifies
whether it is unchanged from the reference or an accepted community change.
**Compare with reference** shows the original definition and field rules.

A steward or site administrator selects **Create community release**, enters a
name and optional notes, and confirms. The release records the selected reference,
field contents, accepted revision IDs and review decisions. If the working version
changes before confirmation, reload and review it before trying again.

Use **Community release** to browse a frozen version, or **Browse → Community releases** to find earlier releases. Later proposals and decisions do not alter
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
