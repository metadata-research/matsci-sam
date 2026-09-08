# Communities and scope

A community is a group of people, such as a lab or review panel. It has a
vocabulary, roster, collection worklist, and studies. Its vocabulary is
published at `/vocabulary/{community}`. Rosters and invitations are omitted
from linked-data exports.

## Working in a community

Select a community or **Everything** under **Working in**. The choice is
saved for your account across sessions.

| Page                     | Effect of a community selection               |
| ------------------------ | --------------------------------------------- |
| Home, Browse, Discussion | Terms and activity in that vocabulary         |
| Collections              | Collections on the community worklist         |
| Contribute               | New terms enter that community vocabulary     |
| Search                   | Searches all hosted vocabularies              |
| Tags                     | Lists classification concepts across the site |

**Everything** includes all hosted vocabularies on Home and Browse and uses
the default MatSci-SAM vocabulary for new terms. **Show everything** on Browse
or Collections displays the full catalog for one request without changing your
saved selection. The URL option `?scope=all` has the same effect.

A collection can reference terms from other vocabularies. These remain
references on the collection and community pages and do not enter the
selected vocabulary in Browse. Search can find them under their owning
vocabulary.

Two communities may define the same label independently. Their terms have
separate identifiers, candidates, votes, and canonical rankings. For example,
these illustrative paths identify different concepts.

```text
/vocabulary/community_a/metal
/vocabulary/community_b/metal
```

Ordinary contributions retain the owning vocabulary of a term. Another
community can reference that term in a collection or define a distinct term
in its own vocabulary. [Identifiers and citation](/docs/identifiers) explains
how to cite terms and exact revisions.

Your selection returns to **Everything** if you leave the community, are
removed from it, or the community is retired.

## Studies

A study gives community members an activity over selected terms, with
instructions and an optional time window. Members can begin from its public
page or **Your studies** on their profile. An invitation can also add a new
member before opening the activity.

[Studies](/docs/studies) covers participation, Position choices, and saved
progress.

## Joining

Open a personal invitation or reusable group link, sign in, and select
**Accept and join**. Required account creation and profile setup return you
to the invitation. ID4 round two also permits **Join and begin study** from
the public study page while participation is open.

A personal invitation can be accepted with your existing account even if it
was sent to another email address. It can be used once and expires after
fourteen days. Request a replacement if it has expired, been withdrawn, or
been replaced. Reusable group links remain active until disabled or replaced.

See [Account access](/docs/account-access) for sign-in methods. You can leave
a community from its page.

## Membership visibility

Members and administrators can view the roster. Other visitors see the member
count. Your [profile setting](/docs/community#contributor-profiles) controls
public profile access and affiliation display.

## Stewardship and administration

Stewards manage members, worklists, invitations, and studies in assigned
communities. Administrators can also create, rename, retire, and restore
communities and appoint stewards. A rename preserves the community address.
Retirement retains membership history and the worklist for restoration.

[Administration and stewardship](/docs/administration) lists the controls by role.
