# Administration and stewardship

Open **More → Manage community** on a community you steward. Membership and
invitations are under **More → People**. Site administrators can manage all
communities and open **Administration** from the account menu. Use
**Administration → Communities → Create community** to create a community and
its vocabulary.

## Roles and scope

| Role               | Controls                                                                              |
| ------------------ | ------------------------------------------------------------------------------------- |
| Community member   | Contribute, respond to reviews, join studies, view the roster and leave the community |
| Community steward  | Manage members, invitations, reviews, worklists and studies in assigned communities   |
| Moderator          | Feature examples on definitions                                                       |
| Site administrator | Site roles, metadata review, curation, service status, and all steward controls       |

Steward is a community membership role. Moderator and administrator are site
roles. An administrator can manage a community without joining it.

## Community stewardship

### People and access

Use **Add a person** to find an existing account. **Invite someone** creates a
personal community invitation. Enter an email address and choose **Create a
link** or **Create and email it**. Copy the link before closing the result.
Personal invitation links are displayed only when created or reissued.

**Reissue** replaces a pending invitation. **Revoke** disables it. Create a new
invitation after expiry. **Delete record** removes an unused revoked or expired
invitation. Accepted invitations remain recorded.

Under **More → People → Join link**, select **Create join link**, then **Copy
link** to share it yourself. Recipients create an account or sign in, then
choose to join as ordinary members. For a members-only community, this grants
access to its private content. The link remains available to copy when you
return. **Replace** invalidates earlier copies, and **Turn off** disables the
link. A change in community visibility also disables it. These controls are
available to stewards and site administrators.

Stewards can remove ordinary members. Only site administrators can appoint or
remove another steward. A steward can leave the community through their own
membership controls.

### Worklists and collections

Open **More → Collections** and use **Add a collection** or **Create a
collection** to choose the community worklist. **Add to a community** and
**Community worklists** on a collection page manage the same links. Terms from
other vocabularies retain their original identifiers. A new study adds its
collection to the worklist.

### Studies

Select **Start a study**, choose or create a collection, and enter instructions
and an optional participation window. **Generate study steps** creates the
walkthrough for participants. Steps can be regenerated until participation
begins. The study protocol determines whether it includes a Review round.

Use **Invite a participant** for a personal study invitation. Enter an email
address, then select **Create link for this person** or **Create and send
email**. Pending invitations can be reissued or revoked. Existing members can
accept them too.

Open **More → Surveys** to check study progress. [Studies](/docs/studies)
explains access, participant controls, and completed records.

## Site administration

Use **People** to change site roles, **Feedback** to manage site reports, and
**Vocabulary** or **Tags** for curation. **Audit & safety** contains publication
and revision records. Role changes take effect immediately.

### Feedback inbox

The **Feedback** button on the right of a page saves a comment for site
administrators. Visitors can submit without signing in. Open **Feedback** in the
administration area to review comments, follow the page link, mark a comment
resolved or reopen it. **Open**, **Resolved** and **All** filter the inbox.
Community membership or a steward role does not grant access to this inbox.

### Studies

**Studies** contains setup, invitations, activity, and retirement controls. Use
**Participant interface** to choose the Simple view or full detail. New studies
use Simple by default. Instructions, schedule, and interface settings are locked
after study activity is recorded. Retirement preserves the study address and
contributions. Restore a retired community and collection before restoring their
study.

Under **Definitions in this study**, expand a candidate and select **Exclude
from this study**, with a reason. The candidate remains in the vocabulary and
earlier participant records remain available. **Restore to this study** makes it
available to the activity again.

## Review term metadata

Open **Usage & metadata** on a term and inspect **Contributor proposals**. Check
the scope, description, and evidence before selecting **Accept** or **Decline**.
Metadata review is restricted to site administrators.

An administrator addition uses **Publish metadata** and is immediately available
to people with access to the term.
**Withdraw** removes an accepted description from current metadata while
preserving its history. See
[Term metadata](/docs/term-metadata#review-and-withdrawal).

## Inference services

Open **AI & services**, then **Service health**. **In use** identifies the
endpoint handling requests. **Alternate** is monitored separately. Select
**Refresh inference health** to check model availability without generating a
response or switching providers. **Inference testing** sends a test prompt
without creating a vocabulary or study contribution.

A passed test confirms the response format. Check factual accuracy separately.
Server configuration requires an operator. The repository
[inference reference](https://github.com/metadata-research/matsci-sam/blob/dev/docs/technical/inference-providers.md)
describes those settings.

<a id="site-wide-controls-on-public-pages"></a>

## Administration on public pages

Administrators can retire or restore communities and collections, edit facets in
Advanced term view, and edit or merge tags.

Use **Visibility** in Administration to hide reviewed terms from listings or
restore them. Existing links retain published content and history. Follow
[Moderation and publication limits](/docs/moderation) for the required reasons,
public notices and visibility history.

Administrators can permanently delete test definitions from definition pages.
Deletion removes dependent records and cannot be undone. Removed definition and
revision addresses stop resolving. Retire or exclude content where those
reversible controls apply. Ordinary edits preserve published history.
