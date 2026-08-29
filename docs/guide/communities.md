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

[Studies](/docs/studies) covers the study activity, the position taken on each
term, and the resulting definition list.

## Joining

You join through an invitation link addressed to you or through an open link
shared with a group. Open the link and sign in or create an account. The sign-in
and required profile setup return you to the invitation; then select **Accept
and join**.

The invitation token supplies the credential, so a per-person invitation also
works after sign-in with a different address. A per-person invitation lasts
fourteen days. A steward can reissue a live invitation or create a new one
after expiration. The invitation page reports whether a link has been used,
withdrawn, or replaced.

See [Account access](/docs/account-access) for the available sign-in methods.
You can leave a community from its page.

## Membership visibility

Members and administrators can view the roster. Other visitors see the member
count. Community membership remains private application data, and the profile
visibility setting continues to govern public names and affiliations.
[Community review and revisions](/docs/community) describes that setting.

## Stewardship and administration

A steward manages the roster, worklist, invitations, and studies of an assigned
community. Administrators can run every community and additionally create,
rename, retire, and restore communities and appoint their stewards.

[Administration and stewardship](/docs/administration) lists these controls by
role, including the collection-page worklist control and the invitation paths.
The address of a community remains the same after a rename. Retirement keeps
the address, membership history, and worklist available for restoration.
