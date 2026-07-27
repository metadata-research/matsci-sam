# Account access

MatSci-SAM keeps one contributor account for each person. The sign-in choices
shown on the site depend on the configuration of the deployed environment.
Google sign-in uses the verified identity returned by Google.

## Verified email

When email sign-in is available, a contributor can enter an email address to
create an account or sign in. MatSci-SAM sends a short-lived link to that
address. The link confirms control of the mailbox and can be used only once.
No password is stored.

An existing contributor who uses the same verified email address returns to
the same account. A new address creates an account after the link is verified.
New contributors complete their name and public-profile choices after sign-in.
The public profile never displays the email address.

Email access depends on reliable delivery. A delayed or filtered message may
require the contributor to request another link after the short waiting
period.

## Google

Google sign-in confirms the email address through Google. Access restrictions
may limit Google sign-in to invited accounts during a development or pilot
period. The visible sign-in page states which options are available.

## ORCID

An ORCID iD is a researcher identifier. A signed-in contributor can connect an
ORCID iD from the profile editor when ORCID access is available. MatSci-SAM
accepts the identifier only from the ORCID authorization flow. The profile
form does not accept a typed identifier.

An ORCID iD can be connected to only one MatSci-SAM account. A connected ORCID
iD can also be used for sign-in. An unconnected ORCID iD does not create or
merge an account. The contributor verifies an email address or signs in with
Google first, then connects the ORCID iD from the profile editor.

A contributor can disconnect an ORCID iD after another sign-in method has been
verified. Contributions and recorded attribution remain attached to the
MatSci-SAM account. Public display of the ORCID iD follows the
[profile visibility setting](/docs/community).
