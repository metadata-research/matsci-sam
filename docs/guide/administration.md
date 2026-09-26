# Administration and stewardship

Open a community page to manage a community you steward. Site administrators
can manage all communities and open **Administration** from the account menu.

## Roles and scope

| Role | Controls |
| --- | --- |
| Community member | Participate in open studies, view the roster, select a community, and leave |
| Community steward | Manage members, invitations, worklists, and studies in assigned communities |
| Moderator | Feature examples on definitions |
| Site administrator | Site roles, metadata review, curation, service status, and all steward controls |

Steward is a community membership role. Moderator and administrator are site
roles. An administrator can manage a community without joining it.

## Community stewardship

### People and access

Use **Add a person** to find an existing account. **Invite someone** creates a
personal community invitation. Enter an email address, then copy the new link
or select **Create and email it**. Copy a link when created because it cannot
be displayed again.

**Reissue** replaces a pending invitation. **Revoke** disables it. Create a new
invitation after expiry. **Delete record** removes an unused revoked or expired
invitation. Accepted invitations remain recorded.

**Open join link** creates a reusable group invitation. Replace or disable it
to invalidate earlier copies. Stewards can remove members. Only site
administrators can appoint or remove stewards.

### Worklists and collections

Use **Add a collection** or **Create a collection** on the community page to
choose its worklist. **Add to a community** and **Community worklists** on a
collection page manage the same links. Terms from other vocabularies retain
their original identifiers. A new study adds its collection to the worklist.

### Studies

Select **Start a study**, choose or create a collection, and enter instructions
and an optional participation window. **Generate study steps** prepares the
activity. Steps can be regenerated until participation begins. The study
protocol determines whether it includes a Review round.

Use **Invite a participant** for a personal study invitation. Enter an email
address, then select **Create link for this person** or **Create and send
email**. Pending invitations can be reissued or revoked. Existing members
can accept them too.

The community page reports progress. [Studies](/docs/studies) explains access,
participant controls, and completed records.

## Site administration

Use **People** to change site roles, **Feedback** to manage site reports, and
**Vocabulary** or **Tags** for curation. **Audit & safety** contains publication
and revision records. Role changes take effect immediately.

**Studies** contains setup, invitations, activity, and retirement controls.
**Participant interface** chooses the Simple view, the default for a new
study, or the full detail of the first studies. Instruction, schedule and
interface edits become restricted after participation starts.
Retirement preserves the study address and contributions. Restore a retired
community and collection before restoring their study.

Under **Definitions in this study**, expand a candidate and select **Exclude
from this study**, with a reason. The candidate remains in the vocabulary and
earlier participant records remain available. **Restore to this study** makes
it available to the activity again.

## Review term metadata

Open **Metadata** on a term and inspect **Contributor proposals**. Check the
scope, description, and evidence before selecting **Accept** or **Decline**.
Only site administrators can review proposals. Steward and moderator roles
do not grant this permission.

An administrator addition uses **Publish metadata** and is public immediately.
**Withdraw** removes an accepted description from current metadata while
preserving its history. See [Term metadata](/docs/term-metadata#review-and-withdrawal).

## Inference services

Open **AI & services**, then **Service health**. **In use** identifies the
endpoint handling requests. **Alternate** is monitored separately. Select
**Refresh inference health** to check their status. **Inference testing** sends
a test prompt without creating a vocabulary or study contribution.

A passed test confirms the response format, not factual accuracy. Server
configuration requires an operator. The repository
[inference reference](https://github.com/metadata-research/matsci-sam/blob/dev/docs/technical/inference-providers.md)
describes those settings.

## Site-wide controls on public pages

Administrators can retire or restore communities and collections, edit facets
in Advanced term view, and edit or merge tags.

Definition pages also provide permanent deletion for test-data cleanup. It
removes dependent records and cannot be undone. Removed definition and revision
addresses stop resolving. Retire or exclude content where those reversible
controls apply. Ordinary edits preserve published history.
