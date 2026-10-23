# Metadata fields and MatCore

Open a community to browse its vocabulary and develop terminology or metadata
fields. In a MatCore community, **Vocabulary** includes the versioned source
catalog. **My work** holds your private drafts. You choose when to publish a
proposal for local review in MatSci-SAM. The
[workspace chooser](/metadata/workspace) helps you find a community or
standalone vocabulary. MatCore source versions are installed separately for
members-only communities. You must be a member or site administrator to read
that community's sources and shared proposals. Its name remains public, with
an option to request access. [Community access](/docs/communities#content-access)
explains requests and membership.

For a vocabulary concept such as solid electrolyte, use **Define a term** or
the usual [term editor](/docs/adding-terms). A metadata field specifies
information to record, such as the temperature used to prepare a sample.
A community can develop both kinds of entry.

## Source entries, drafts and proposals

| Entry | Purpose |
| ----- | ------- |
| **Preserved source entry** | Records the definition, rules and attribution in a particular MatCore source version. It is available to read without creating a draft. |
| **Private draft** | Holds your proposed changes. Only your account can read it. Editing it does not change the source entry. |
| **Published local proposal** | Makes your definition and field specification available to readers of the community. Each revision retains its sources and contribution history. |

Drafts imported earlier remain in **My work**, with their edits and history.
They are private working copies, not earlier releases of the standard. Open
the corresponding catalog entry and select **Continue my draft** to resume one.
You do not need to import it again.

A source version identifies the preserved MatCore specification. A local
proposal revision identifies changes made in MatSci-SAM. Publishing or
accepting a local proposal does not issue a new MatCore release.

## Start a metadata field

A community steward or site administrator can open **Workspace tools** and
select **Enable metadata development**. This adds the field tools without
requiring a standard or profile. Enabling **MatCore** is a separate choice.
A site administrator must also install and grant a source version to this
community. Until then, the catalog is empty and independent metadata fields
remain available.

Select **New metadata field** and enter a label. The draft belongs to the
community vocabulary. A new field has no imported source baseline. When
MatCore is enabled and a source is available, **Standard context** lets you optionally choose a MatCore
section. Leave it unset for an independent field.

Your ordinary term drafts and field drafts appear in **My work**. These lists
are private to your account and limited to the selected community. Other
community members cannot read your private drafts. Changing the community
view does not move drafts or change their vocabulary.

## Propose a change to a MatCore field

Open **Vocabulary**, then choose a **Source version** and **Profile** in the
MatCore catalog. The catalog shows preserved source entries, including their
definitions, field rules and attribution. Browsing creates no drafts. The
**Source version** list contains the snapshots installed for this community.

Open a field and select **Propose a change**. This creates one private draft
based on that exact source entry. If you already have a draft for the entry,
select **Continue my draft**. Existing edits are kept. The original source stays
unchanged when you edit, save or publish your proposal.

In the editor, **Back to source entry** saves pending changes before returning
to the same version, profile, result page and source entry. If saving fails,
your writing stays in the editor and **Retry save** is available. The draft
also appears under **My work** in the community.

Sign in with an account that can contribute to the community. If your account
needs an attributed name, follow **Add your name to your profile** before
creating a field draft. When a local proposal has been published, **View local
proposal** opens it. Further revisions start from that proposal through
**Propose a revision**. Team review roles and standards release assembly are
not available yet.

Later source snapshots do not automatically update existing drafts or
published proposals. Each keeps the source version it was based on. Switching
**Source version** changes what you browse. It does not move your edits to that
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

Open a draft from **My field drafts**. Use the three tabs to prepare the
proposal.

| Tab                     | What to enter or review                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Definition**          | The field label, an explanation of what to record and an optional example.                                                                             |
| **Field specification** | The field path, value type, format, requirement and repeatability. Additional controls cover conditions, units, allowed values, examples and guidance. |
| **Sources & history**   | Any preserved imported source, supporting citations and recorded contribution history.                                                                 |

Keep the parent path when editing a nested field. For example, `creator.name`
and `computation.software.name` describe different information. For fields
linked to MatCore, **Profile context** identifies inherited sections and any
method selection required for derived properties. Independent fields
have no MatCore profile.

A required child field applies within its parent context. A conditional rule
needs an explanation of when it applies. **Not specified** means the source
has not established a rule. It does not mean optional. A field that accepts a
list can still occur only once, so review **Value type** and **Repeatable
field** separately.

Use **Add citation** under **Sources & history** to record a source title,
address and an explanation of its relevance. Supporting citations are counted
separately from an imported baseline, if present. Imported source wording,
location and attribution remain available after you edit the proposal. A new
independent field records your citations and contribution history without
claiming an imported source.

Enter a **Reason for this proposal**. Explain your changes or why the source
field should be adopted. This explanation is shared with readers who can access the community when you
publish the proposal.

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

## Publish and review

Select **Review proposal** to check the definition, specification, changes
from the source baseline and citation count. A label, definition and reason
are required. Add your name to your account profile before publishing.

Select **Publish local proposal** to share the proposal with readers of the
community. The published field specification links to its dictionary entry
and an exact definition revision. Its citations, contribution history and
any imported baseline follow the same community access rules. An imported
baseline remains unchanged.

A site administrator can record **Accepted locally**, **Changes requested** or
**Declined locally**, with a reason. These decisions apply to the selected
revision. Official MatCore adoption is a separate decision by the MatCore team.

Use **Propose a revision** on the latest proposal to start another private
draft. Earlier published revisions remain available through **Revision**.
**Download specification** exports the selected revision, its profile context,
sources and history as JSON. This export records a proposal for review and is
not an executable dataset validation schema.

The contributor or a site administrator can **Withdraw proposal** and record
a reason. The withdrawn proposal remains visible with its source and history.

## Workspace tools

Field proposals support linked citations and manual editing. AI assistance,
file uploads, shared drafts, assigned reviews, notifications and dataset
validation are planned separately. The field editor does not run the ontology
lookup used by the vocabulary term editor.

The [2025 reference catalog](/metadata/matcore) preserves the earlier MatCore
transcription and its identifiers. [MatCore and the vocabulary](/docs/reference/matcore-and-the-vocabulary)
explains the relationship between that catalog, community field development
and term metadata.
