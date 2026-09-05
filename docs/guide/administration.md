# Administration and stewardship

MatSci-SAM separates community stewardship from site administration. A
steward runs one assigned community. An administrator can manage every
community and also has access to the site-wide **Administration** area.

This page lists controls available through the application. Server access,
protected configuration, database maintenance, release procedures, and
environment-specific data remain private operational responsibilities rather
than application administration.

## Roles and scope

| Role              | Scope                                | Administrative functions                                                                                                                                                  |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Community member  | Communities they have joined         | Participate in open studies, view the community roster, select a working community, and leave a community                                                                 |
| Community steward | Communities where they are a steward | Manage members, worklists, invitations, study setup, and study progress                                                                                                   |
| Moderator         | Site-wide content role               | Feature an example on a definition; this role does not grant community-management or site-administration access                                                           |
| Administrator     | Entire site                          | All steward functions, community and collection lifecycle controls, steward appointments, content curation, account roles, study editing, service status, and audit views |

An administrator can run a community without joining it. Steward is a
community membership role, while moderator and administrator are site account
roles.

## Community stewardship

Open the community page to manage its day-to-day work. The controls appear for
a steward of that community and for a site administrator.

### People and access

- **Add a person** searches existing accounts by name. Results expose public
  affiliation only when the account owner published it.
- **Invite someone** creates a one-person invitation to join the community.
  An invitation to take part in a study is a separate workflow, created
  beside the study it belongs to. Enter an address, then copy the link or
  select **Create and email it**. The raw link is displayed only when it is
  created because the database retains only its digest.
- **Reissue** replaces a live invitation with a new link and makes the previous
  link unusable. **Revoke** stops an unaccepted invitation. Create a new
  invitation after an earlier one expires. **Delete record** removes a revoked
  or expired invitation nobody redeemed; an accepted invitation stays as the
  record that its person arrived.
- **Open join link** creates one reusable link for a group. Replacing or
  turning it off invalidates earlier copies.
- A steward can remove ordinary members but cannot appoint or remove another
  steward. A site administrator changes the steward role.

An invited person can read the study instructions before signing in. Sign-in,
new-account creation, and required profile completion return the person to the
invitation. **Accept and join** then adds the account to the community. See
[Account access](/docs/account-access) for the authentication paths.

### Worklists and collections

A worklist determines which collections community members see while working in
that community.

- On the community page, **Add a collection** places an existing collection on
  the worklist. **Create a collection** makes one and places it there.
- On a collection page, **Add to a community** offers the communities the
  current steward or administrator may run. The **Community worklists** list
  shows where the collection is already used and provides the corresponding
  remove control.
- Both entry points update the same worklist. Adding a collection does not
  change which vocabulary owns its terms; terms from another vocabulary remain
  references.
- Creating a study adds its collection to the worklist automatically.

### Studies

- **Start a study** on the community page connects that community to an
  existing or newly created collection and records participant instructions
  and an optional time window.
- **Generate study steps** creates an instruction step, one position and one
  review step for each term, and optionally the two default closing questions.
  Steps can be regenerated until a participant begins.
- **Invite a participant** creates an invitation fixed to one study. It
  appears on the administrative study page and beside each study on the
  community page, and is a separate workflow from inviting someone to join
  the community: its email and invitation page lead with the study, and an
  existing community member accepts it like anyone else, which records that
  the person asked arrived. An email address is required for both delivery
  choices because it records the intended participant; **Create link for
  this person** leaves delivery to the administrator, while **Create and
  send email** sends it through the application. The study page lists created
  invitations with their delivery method, status, dates, and redeemed account,
  when available. Pending invitations can be reissued or revoked, but their raw
  links cannot be displayed again.
- The community page reports generated steps and how many participating
  members have finished. The public study page presents the same instructions,
  the activity entry point, and the consolidated record after completion.

[Studies](/docs/studies) describes the participant activity and resulting
definition list.

## Site administration

The **Administration** item in the account menu opens `/admin`. Only a site
administrator can enter this area.

| Area           | Functions                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Overview       | Review totals, recent publication activity, generation work needing attention, and service status                                      |
| Review         | Run pending administrator-requested term generation and inspect retained records from the retired refinement workflow                  |
| Feedback       | Read page-specific feedback and mark an item resolved or reopen it                                                                     |
| Vocabulary     | Find terms, compare definition, AI, and comment activity, and open public or provenance records                                        |
| Tags           | Review meaning drift; tag pages provide concept editing and merging, while term pages provide PSPP facet assignment                    |
| People         | Search and filter accounts and change the site role; role changes take effect immediately                                              |
| Studies        | Create a study; manage participant invitations; edit its title, instructions, and schedule; inspect activity; exclude or restore definitions; and retire or restore it |
| AI & services  | Review authentication and integration readiness, test configured services, and inspect the active prompt registry                      |
| Audit & safety | Review recorded publication evidence and recent revision events                                                                        |

The site-wide study editor locks instructions and schedule changes when
recorded participant activity makes those changes unsafe. Retiring a study
preserves its public address and contributions. Restoring it may require its
community and collection to be restored first.

In **Definitions in this study**, expand a definition and choose **Exclude
from this study**. Enter a reason to omit it from Position and Review. The
definition remains in the vocabulary and other studies. Earlier positions,
votes, comments, and revision history remain recorded. **Restore to this
study** makes the definition available again. The exclusion history records
the reason, administrator, and date for both actions.

## Site-wide controls on public pages

Some administrator controls remain beside the records they affect instead of
inside `/admin`:

- The communities index and community pages create, rename, retire, and
  restore communities. Community pages also appoint and remove stewards.
- Collection pages edit collection details and retire or restore a collection.
  Their worklist controls are shared with community stewards where permissions
  allow.
- Term pages assign curated PSPP facets. Tag pages edit or merge curated
  concepts.
- Definition pages provide permanent deletion for pre-pilot cleanup. This
  exceptional action removes dependent records and cannot be undone; ordinary
  published content should remain in its revision history.

Stable public addresses survive renaming and retirement. Prefer reversible
lifecycle controls over permanent cleanup.
