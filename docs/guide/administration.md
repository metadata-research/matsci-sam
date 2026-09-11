# Administration and stewardship

A community steward manages assigned communities. A site administrator can
manage all communities and enter **Administration** from the account menu.
Server configuration, releases, and database maintenance are separate
operational tasks.

## Roles and scope

| Role              | Controls                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Community member  | Participate in open studies, view the roster, select a working community, and leave             |
| Community steward | Manage members, worklists, invitations, and study setup and progress in assigned communities    |
| Moderator         | Feature examples on definitions                                                                 |
| Administrator     | All steward controls, site roles, curation, lifecycle controls, service status, and audit views |

Steward is a community membership role. Moderator and administrator are site
roles. An administrator can manage a community without joining it.

## Community stewardship

Open a community page for its management controls.

### People and access

**Add a person** finds an existing account by name. Affiliation is shown only
when public. **Invite someone** creates a personal community invitation.
Enter an email address, then copy the new link or select **Create and email
it**. Copy the link when created. The site stores its digest and cannot
redisplay the raw link.

**Reissue** replaces a pending invitation. **Revoke** disables it.
Create a new invitation after expiry. **Delete record** removes an unused
revoked or expired invitation. Accepted invitations remain as arrival records.

**Open join link** creates a reusable group invitation. Replace or disable
it to invalidate earlier copies. A steward can remove members. Only an
administrator can appoint or remove stewards.

Sign-in and required profile setup return an invited person to **Accept and
join**. [Account access](/docs/account-access) explains those steps.

### Worklists and collections

A worklist selects the collections shown while members work in a community.
Use **Add a collection** or **Create a collection** on the community page.
On a collection page, **Add to a community** and **Community worklists**
manage the same links for communities you can run.

A collection reference preserves the owning vocabulary of each term.
A new study automatically adds its collection to the community worklist.

### Studies

Select **Start a study**, choose or create a collection, and enter the
instructions and optional participation window. **Generate study steps**
creates instructions, Position and Review steps for the terms, and optional
closing questions. Steps can be regenerated until participation begins.
ID4 round two presents only the Position pass and closing questions through
its study-specific protocol.

**Invite a participant** creates a personal invitation to a specific study.
It appears beside the study on the community page and in study administration.
Enter the intended email address, then choose **Create link for this person**
or **Create and send email**. Existing members can accept these invitations
too. The study page records delivery method, status, dates, and the redeemed
account. Pending invitations can be reissued or revoked.

Members can begin directly from the public study page. ID4 round two also
allows nonmembers to join there while it is open. Invitations provide a
separate record of an invited arrival.

The community page reports generated steps and completed participation.
The public study page provides the activity and the completed participant
record. [Studies](/docs/studies) explains the participant controls.

## Site administration

| Area           | Functions                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Overview       | Totals, recent activity, generation work, and service status                                                 |
| Review         | Pending term generation and retained refinement records                                                      |
| Feedback       | Resolve and reopen page feedback                                                                             |
| Vocabulary     | Inspect terms, contributions, and provenance                                                                 |
| Tags           | Inspect meaning drift and access curation controls                                                           |
| People         | Search accounts and change site roles                                                                        |
| Studies        | Edit study details, manage invitations, inspect activity, exclude definitions, and retire or restore studies |
| AI & services  | Check integrations and the prompt registry                                                                   |
| Audit & safety | Inspect publication evidence and revision events                                                             |

Role changes take effect immediately. The study editor restricts instruction
and schedule changes after participant activity. Study retirement preserves
its address and contributions. Restore its community and collection first
when either is retired.

Under **Definitions in this study**, expand a candidate and select **Exclude
from this study** with a reason. The candidate is omitted from active study
steps but remains in the vocabulary. Earlier participant records are retained.
**Restore to this study** makes it available again. The history records reasons,
administrator, and time for each change.

## Inference services

Open **AI & services → Service health** to check inference. **In use** is the
endpoint handling application requests. **Alternate** is an optional second
endpoint monitored independently. **Refresh inference health** checks both;
each shows its status, model, profile, and check time. An alternate marked
**Not configured** needs its own server settings before it can be checked.

Readiness confirms that the configured model is available from the server.
Use **Inference testing** to send a prompt through the endpoint in use and
validate its JSON response. Tests create no vocabulary or study records.
A passed test confirms the response format, not factual accuracy.

To switch endpoints, an operator edits the protected server environment file
and restarts the application. Update the provider, profile, model, and
connection settings together. Alternate settings use `INFERENCE_ALTERNATE_*`
and do not change application routing. The interface cannot edit either
configuration and provides no automatic fallback. The repository's
[inference configuration reference](https://github.com/metadata-research/matsci-sam/blob/dev/docs/technical/inference-providers.md)
lists the settings and switching steps.

## Site-wide controls on public pages

Administrators can create, rename, retire, and restore communities and
collections from their pages. Community pages also manage stewards.
Term pages assign PSPP facets, and tag pages edit or merge concepts.

Definition pages provide permanent deletion for test-data cleanup. It removes
dependent records and cannot be undone. Use the reversible retirement or
exclusion controls where they apply. Public addresses remain fixed through
renaming and retirement.
