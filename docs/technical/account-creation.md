# Account creation methods

The registration page is a method chooser. Email availability does not control
whether Google or ORCID signup is offered. `lib/account-creation.ts` supplies
the same availability rules to registration, login and invitation pages.

| Method | Required configuration                                                   |
| ------ | ------------------------------------------------------------------------ |
| Google | Configured Google client and `GOOGLE_AUTH_ACCESS_MODE=open`              |
| ORCID  | `ORCID_AUTH_ENABLED=true` and `ORCID_AUTH_ACCOUNT_CREATION_ENABLED=true` |
| Email  | `EMAIL_AUTH_ENABLED=true` and `EMAIL_AUTH_ACCOUNT_CREATION_ENABLED=true` |

ORCID client, callback and encrypted token storage configuration remain
required for OAuth. The new ORCID account-creation setting defaults to false.
Deploying this code alone does not enable new ORCID accounts. Development
previews show unavailable provider buttons and development sign-in without
pretending that external providers are configured.

## ORCID identity and account ownership

Account creation requires the explicit `signup` OAuth intent. The start and
callback both check the creation setting. Signup starts signed out and refuses
a callback if another account has signed in meanwhile. Existing connection
requests retain their initiating-account check. OAuth state, nonce, PKCE and
provider identity validation remain in the existing exchange.

The verified ORCID subject is the only identity used to locate an existing
account. Names and email addresses are not used to merge accounts. An existing
subject returns to its original account. A new subject creates a human user and
encrypted provider connection in one transaction. User defaults remain ordinary
role, private profile, no email and no community membership.

Signup, connection and disconnection coordinate subject and user locks in the
same order. Unique indexes remain the final subject-ownership constraint.
Failures roll back the complete creation. An ORCID-only account cannot disconnect
its only sign-in method. Adding Google or email recovery to such an account is
not part of this change.

## Release and acceptance

No schema migration, catalog import or content rewrite is needed. Superego and
Ego must each receive the reviewed application release. Enabling ORCID signup
requires a separate configuration change on each host after its existing ORCID
client and callback have been checked. Keep existing credentials and encryption
keys. Do not copy account data between hosts.

Local checks cover independent method availability, invitation destinations,
OAuth validation, account switching, replay and expiry, concurrent creation,
transaction rollback, private defaults and explicit invitation acceptance.
Provider responses in the local signup browser harness are synthetic. A real
ORCID authorization and returning-user sign-in still need acceptance on Superego
before enabling signup on Ego. Email confirmation remains an explicit action.
