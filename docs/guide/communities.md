# Communities and scope

A community is a named group of people, such as a lab, specialty, or review
panel. It organizes a roster, a worklist of collections, and studies. Terms
remain in the shared vocabulary. Community pages are application routes, while
the linked-data exports omit community identities, rosters, and invitations.

## Working in a community

Members use the **Working in** control in the navigation bar to select one of
their communities or **Everything**. MatSci-SAM stores that selection for the
individual account across sessions. The menu also links to the selected
community and its studies.

The selection scopes two pages. [Browse](/terms) shows terms in the collections
on the worklist, and [Collections](/collections) shows those collections.
[Search](/docs/search), Discussion, [Tags](/docs/tags), and Contribute continue
to use the full vocabulary.

**Show everything** on Browse or Collections displays the full result for one
request and keeps the selected community in place. The address `?scope=all`
provides the same view.

The selection returns to **Everything** when you leave the community, a
steward removes you, or an administrator retires the community.

## Studies

A study asks the members of a community to work through a collection of terms
under shared instructions and an optional time window. The public study page at
`/studies/{study}` presents the title, instructions, dates, collection, and
progress. An invitation opens on that page. Accepting it adds the participant
to the community, which makes the worklist available through Browse and
Collections.

[Studies](/docs/studies) covers the walkthrough, the position taken on each
term, and the resulting definition list.

## Joining

You join through an invitation link addressed to you or through an open link
shared with a group. Open the link, sign in or create an account, return to the
invitation, and select **Accept and join**.

The invitation token supplies the credential, so a per-person invitation also
works after sign-in with a different address. A per-person invitation lasts
fourteen days. A steward can reissue a lapsed invitation. The invitation page
reports whether a link has been used, withdrawn, or replaced.

See [Account access](/docs/account-access) for the available sign-in methods.
You can leave a community from its page.

## Membership visibility

Members and administrators can view the roster. Other visitors see the member
count. Community membership remains private application data, and the profile
visibility setting continues to govern public names and affiliations.
[Community review and revisions](/docs/community) describes that setting.

<details>
<summary>Running a community</summary>

A steward manages one community. Administrators can manage every community.

**People.** Search by name to add someone with an existing account. Use an
invitation for a person who still needs an account. Search results contain
names and public affiliations. A steward can remove members. Administrators
appoint and remove stewards.

**Terms in view.** Add an existing collection or create one from the community
page to place it on the worklist. Browse and Collections use that worklist for
every member who selects the community. Terms enter the worklist through
collection membership. A collection assigned to an active study appears with
that study.

**Studies.** Start a study with a title, collection, instructions, and optional
dates. You can select an existing collection or create one in the same form.
The collection is added to the worklist. The instructions appear on invitation
and study pages. The dates state the expected window. After the closing time,
the study stops accepting invitations and walkthrough actions. [Studies](/docs/studies)
describes walkthrough generation and participation.

**Per-person invitations.** Enter an address, then copy the link or have it
emailed. The page displays the link once because the database stores only its
digest. Reissuing creates a new link and invalidates the previous one. A
steward can revoke an invitation before acceptance.

**The open join link.** This link admits any signed-in person who opens it. The
community page displays it again when needed. Replacing the link invalidates
every earlier copy.

</details>

## Community administration

Administrators create, rename, retire, and restore communities and appoint
their stewards. Steward authority is limited to the roster, worklist,
invitations, and studies of the assigned community.

The address of a community remains the same after a rename. Retirement keeps
the address, membership history, and worklist available for restoration.
