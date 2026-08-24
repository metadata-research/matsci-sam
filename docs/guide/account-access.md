# Account access

MatSci-SAM associates contributions with a contributor account. Google sign-in
is always offered and uses the verified identity Google returns. Email sign-in,
email account creation, and ORCID appear where the deployment maintainer has
enabled them. The available sign-in choices therefore vary by deployment.

## Verified email sign-in

When email sign-in is available, the form on **Sign in** is for an existing
account. Enter an email address already attached to that account. MatSci-SAM
sends a short-lived, one-time link only when the address matches an existing
contributor. The confirmation page does not reveal whether an address was
found. Sign-in uses the one-time link in place of a password.

The link returns the contributor to the same account. The public profile
never displays the email address.

## Create an account by email

When account creation is also available, the sign-in page links to a separate
**Create an account by email** form. That form is intended for a new
contributor. After following its one-time link, the contributor completes
their name and public-profile choices.

If you already have contributions, sign in with the same Google account you
used before. Creating a second account by email assigns later activity to a
separate profile. A deployment maintainer can enable existing-account email
sign-in without enabling new account creation, so the registration link may
not appear in every environment.

A delayed or filtered message may require the contributor to request another
link after the short waiting period.

## Google

Google sign-in confirms the email address through Google. A deployment either
accepts any Google account or accepts only addresses a maintainer has listed.
An address that already has an account here always signs in. An address that is
neither listed nor known is refused after the round trip to Google, with the
message that the account is not authorized.

## ORCID

An ORCID iD is a researcher identifier. A signed-in contributor can connect an
ORCID iD from the profile editor when ORCID access is available. MatSci-SAM
accepts the identifier through the ORCID authorization flow.

An ORCID iD can be connected to only one MatSci-SAM account. A connected ORCID
iD can also be used for sign-in. An unconnected ORCID iD does not create or
merge an account. The contributor verifies an email address or signs in with
Google first, then connects the ORCID iD from the profile editor.

A contributor can disconnect an ORCID iD after another sign-in method has been
verified. Contributions and recorded attribution remain attached to the
MatSci-SAM account. Public display of the ORCID iD follows the
[profile visibility setting](/docs/community).
