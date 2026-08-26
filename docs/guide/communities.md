# Communities and scope

A community is a named group of people, such as a lab, specialty, or review
panel. It owns a vocabulary and organizes a roster, a worklist of collections,
and studies. A community vocabulary is a SKOS concept scheme at
`/vocabulary/{community}`. Community pages are application routes, while the
linked-data exports omit community rosters and invitations.

## Working in a community

Members use the **Working in** control in the navigation bar to select one of
their communities or **Everything**. MatSci-SAM stores that selection for the
individual account across sessions. The menu also links to the selected
community and its studies.

The selection scopes the home page and [Browse](/terms) to terms defined in
that community's vocabulary. Recent comments, featured definitions, and
personal contributions on the home page use the same scope.
[Collections](/collections) shows the community's worklist. When the
vocabulary has no terms, the home page names the community and links to its
page. [Search](/docs/search) remains global so a sparse community vocabulary
does not hide relevant concepts owned elsewhere.

A collection on the worklist can also reference a term defined in MatSci-SAM
or another community vocabulary. The community and collection pages label such
terms as references and link to the vocabulary that defines them. References
do not enter the community's recent activity or Browse list. Global Search can
still find them under the vocabulary that defines them.

With **Everything** selected, the home page and Browse include terms from every
vocabulary hosted by MatSci-SAM. Search already does so in every working
context. Contribute publishes a new term in the selected community vocabulary,
or in the default MatSci-SAM vocabulary when **Everything** is selected.
Discussion uses the working vocabulary scope. [Tags](/docs/tags) remain
site-wide.

**Show everything** on Browse or Collections displays the full catalog for one
request and keeps the selected community in place. The address `?scope=all`
provides the same view.

The selection returns to **Everything** when you leave the community, a
steward removes you, or an administrator retires the community.

Each vocabulary ranks its own candidate definitions. Rank 1 is that
vocabulary's current canonical definition for the term; a same-label term in
another vocabulary has an independent set of candidates, votes, and rankings.
Definition and revision identifiers remain available when a publication needs
to pin the wording used at a particular time.

## Studies

A study asks the members of a community to work through a collection of terms
under shared instructions and an optional time window. The public study page at
`/studies/{study}` presents the title, instructions, dates, collection, and
progress. An invitation opens on that page. Accepting it adds the participant
to the community and adds it to the participant's **Working in** choices.
Selecting it shows the community vocabulary in Browse and its worklist in
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

**Terms in view.** Terms created while the community is selected belong to its
vocabulary. Add an existing collection or create one from the community page to
place it on the worklist. A collection may contain local terms and references
to terms from other vocabularies. Collection membership does not change which
vocabulary defines a term. A collection assigned to an active study appears
with that study.

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
