# Communities and scope

A community is a group of people, such as a lab or review panel, working
together on terminology and, when enabled, metadata fields. Each community
has its own vocabulary, members and surveys. Its worklist contains
collections of terms selected for review.

The creation tools distinguish these objects:

| Object     | Purpose                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| Community  | Brings people together to contribute and review.                                  |
| Vocabulary | Names a body of terms and their definitions. Each term belongs to one vocabulary. |
| Collection | Selects existing terms for a purpose, including terms from several vocabularies.  |

**Import terms** is a task: it adds a batch of terms and definitions to a
vocabulary. It does not create another kind of container. Use a collection to
gather terms that already exist without copying their definitions.

## Community workspace

The community page is its workspace. **Overview** describes its purpose and
shows your recently saved drafts when you have work to continue. **Vocabulary**
shows published terms. **My work** contains your private drafts and contribution tools, with
saved work before empty sections. **Collections** contains shared term lists,
**People** covers membership, and **Surveys** appears when relevant. Managers
can use **Settings** to control content access and metadata tools.

When metadata development is enabled, the community opens on **Standard**, with
**Working version** and **Hierarchy** selected. The working version contains the
reference fields and accepted community changes. **Community release** opens a
named snapshot when one exists. **Reference** opens the publisher specification. **Proposals** holds shared revisions for
discussion and steward review, and **My drafts** holds private work. **More**
contains community releases, vocabulary terms, collections, About and any authorized settings or
surveys. Ordinary vocabulary communities keep the navigation described above.

In longer views, **On this page** lists the available sections. Select one to
jump to it; the destination is briefly highlighted. On a small screen, open
the compact **On this page** menu. Short views omit this menu.

Draft and import editors opened from **My work** provide a link back to the
community, retaining your section, field filter and result page. If a draft
has unsaved changes, the return waits for saving. A save failure leaves you
in the editor with your writing available.

Use **Define a term** for an ordinary vocabulary entry or **Import terms** to
prepare a batch of private drafts. These actions use the community's
vocabulary. Your drafts remain private even when other contributors belong
to the same community.

In **Settings**, stewards and site administrators can enable metadata
development to add **New metadata field**. MatCore is an optional standard within those tools;
it is not required to define a field. An independent field can record value
types, units and requirement rules with its own citations. The
[metadata workflow guide](/docs/matcore-workflow) explains field editing and
MatCore reference fields and proposals.

In Standard, choose Reference and select a reference version. **Find a field** searches all
entries in that version and the selected profile by name, path or definition.
Open a result to read the field. **Propose a
change** creates a private draft for that field. **Continue my draft** resumes
your existing work, including drafts imported earlier. Browsing the catalog
creates no drafts. The reference version remains unchanged when you edit
or submit a proposal. **View proposal** opens a submitted proposal, where
**Propose a revision** starts further changes.

Source versions and local proposal revisions are separate. Existing drafts
and proposals keep their source version when another snapshot becomes
available. They are not updated automatically. Stewards can accept changes into the working version and create named community
releases. Each release preserves its field contents and review decisions.
Community review and releases do not establish MatCore approval.

## Content access

A community can share its content publicly or limit it to members. Its name
always appears in the community directory. For **Members only** communities,
visitors see the name and an option to request access. Vocabulary entries,
sources, proposals and activity remain restricted. Site administrators can
also read shared content. Personal drafts remain visible only to their authors.

Sign in and select **Request access** on the community page. The page shows
when your request is awaiting review. A steward or site administrator can open
**People**, find **Access requests**, and approve or decline it. Check the same
community page for the outcome. This does not send an email notification.

Stewards can open **Settings** and use **Content access** to choose **Public**
or **Members only**, then select **Save content access**. A community containing
protected source material must remain members-only. An installed MatCore source
requires a separate grant from a site administrator. Enabling MatCore tools
does not make sources from another community available.

Removing a member ends their access to restricted content and saved drafts in
that community. Their records are preserved. Restoring membership lets them
resume their own drafts. A restriction cannot recall files already downloaded
or text already copied by an authorized reader.

## Quick start and guided setup

Use the **Quick start** bar on Home to **Add term**,
**Import terms**, **Create collection**, **Create vocabulary**, or **Create
community**. The **Vocabulary** menu groups browsing under **Explore** and
these actions under **Create**. Open **Community workspaces** under
**Participate** to browse communities.
On a community page, **My work** provides **Define a term** and **Import terms**
for that community’s vocabulary. Check the destination before submitting.

Choose **Guide me through setup** for a step-by-step workflow. The progress
indicator shows your current stage. Reuse an existing community or vocabulary
when it fits your work; you do not need to create every kind of object to
contribute.

Creating a community also creates its vocabulary. **Create vocabulary** creates
a separate named vocabulary without a new community. Site administrators can
create communities and vocabularies; the setup screens explain the available
actions for your account. Sign in to contribute terms or create collections.

Guided setup walks through **Community**, **Vocabulary**, **Collection**,
**Terms**, and **Review**. Choose an existing destination or create one when
your account allows it. A collection is optional. Creating a community,
vocabulary, or collection saves it immediately. New definitions are published
only after the final review. Single-term and imported drafts save privately to
your account and can continue in the full editor. Before you create drafts,
setup choices and pasted import text are remembered in the same browser on
this device when storage is available.
Returning to a draft requires a fresh review before publication.

For an import, upload a CSV or TSV file or paste its contents. Use the columns
`term,definition` (tab-separated in TSV). A definition can be completed later.
The preview identifies existing terms, duplicate rows and errors. Select the
new rows to save as private drafts, then return through the community's
**My work** or the account menu's **My term drafts** to review and publish.
Existing definitions are never overwritten. You can preview up to
100 rows and keep up to 50 active drafts. The limit of five new definitions in
ten minutes applies when you publish. [Import guide](/docs/importing-terms).

For instructions and background, open **Help & Guides** in the navigation.

## Working in a community

The **Community** selector beside your account opens the selected community
and sets the context for browsing and new contributions. The choice is saved
across sessions. Selecting the same community again returns to its Overview.
**Everything** opens Home with all vocabularies you can read. Select **My work**
in the same menu to resume your work in the selected community. Vocabulary,
people, collections and surveys are available through the workspace tabs.

An edited term or metadata field draft saves before switching communities.
If saving fails, the editor stays open so you can retry.

The account menu’s **My term drafts** opens your term drafts across
vocabularies. Metadata field drafts are in each workspace’s **My work** view.

| Page                     | Effect of a community selection               |
| ------------------------ | --------------------------------------------- |
| Home, Browse, Discussion | Terms and activity in that vocabulary         |
| Collections              | Collections on the community worklist         |
| Add a new term           | New terms enter that vocabulary               |
| Search                   | Searches vocabularies you can read            |
| Tags                     | Lists classification concepts across the site |

**Everything** includes all vocabularies you can read on Home and Browse and uses
the default MatSci-SAM vocabulary for new terms. **Show everything** on Browse
or Collections removes the community restriction on that page without changing
your saved selection.

An **Add term** link from a particular community, or a destination chosen in
guided setup, explicitly selects that vocabulary for the contribution. It
does not change your saved **Community** selection. Check the
vocabulary named in the term editor.

A collection created within a members-only community follows that community's
content access. Linking an existing public collection into a private workspace
does not make the collection private. Readers see only member terms they are
authorized to read.

A collection can reference terms from other vocabularies. Those terms retain
their original vocabulary and identifiers. Search finds them under that
vocabulary. Two communities can define the same label independently, with
separate definitions, votes, and rankings.

Check the destination before [adding a term](/docs/adding-terms). Contributions
to existing terms remain in their original vocabulary. Your selection returns to
**Everything** if you leave, are removed, or the community is retired.

## Studies

Community members review selected terms in a study, following instructions
within an optional participation window. Begin from its public page or
**Your surveys** on your profile.
An invitation can add membership before opening the activity. Members-only
surveys use terms from their own community vocabulary. Public surveys can
continue to use terms from other vocabularies that participants can read.
[Studies](/docs/studies) explains Position choices and saved progress.

## Joining

Open a personal invitation or reusable group link. Select **Create an account**
if you are new, or **Sign in** if you have an account. After email verification,
you can add your name or select **Skip for now**. You return to the invitation
to select **Join** with the community name. Signing in or creating an account
does not accept the invitation.

Reusable group links do not grant access to a members-only community. Follow
the link to request access instead. A personal invitation issued by a steward
is an explicit invitation to join and can still be accepted.

A personal invitation works with an existing account even if it was sent to
another email address. It can be used once and expires after fourteen days.
Request a replacement if it expires or is withdrawn or replaced. Reusable
group links remain active until disabled or replaced.

See [Account access](/docs/account-access) for sign-in methods. You can leave
a community from its page.

## Membership visibility

Members and site administrators can view the roster. Other visitors see the
member count for public communities. Members-only communities show neither the
roster nor its count to visitors. Your [profile setting](/docs/account-access#profile-visibility)
controls public profile access and affiliation display. Rosters and invitations
are omitted from public metadata exports.

## Stewardship and administration

Stewards manage content access, membership requests, members, worklists,
invitations, and surveys in assigned communities. Site administrators can create, rename, retire, and restore
communities and appoint stewards. Renaming preserves the address. Retirement
retains membership history and the worklist for restoration.

[Administration and stewardship](/docs/administration) lists the controls by role.
