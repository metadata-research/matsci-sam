# Community review packets

Community navigation and actions share the definitions in
`lib/community-navigation.ts` and `lib/community-actions.ts`. The active
community is resolved on the server with membership checks. Ordinary
vocabularies and metadata communities use the same navigation order. Metadata
capabilities add field controls without replacing term actions.

## Contributions and reviews

`lib/community-contributions.ts` lists current, visible definition revisions.
The community standard adapter supplies metadata proposal revisions. The
Contributions page merges these records for selection and discovery. It does
not change publication or governance rules. Legacy dictionary projections of
metadata proposals are excluded from ordinary targets to avoid duplicate
records and bypasses of source access.

An ordinary successor can have a metadata projection in its older history.
The packet omits that predecessor's comparison text and history and explains
the omission. The ordinary definition stays available without exposing a
restricted reference through an older publication.

Review target keys distinguish `definition:<revision id>`,
`proposal:<revision uuid>` and `reference:<occurrence id>`. Existing bare
metadata UUID selections remain accepted. A review freezes the selected
version and response labels. An explicit selection can include historical
revisions or a proposal with a recorded decision. Default candidates remain
current definitions and pending proposals. Responses are never transferred
to another revision.

The metadata adapters retain the existing storage names. The interfaces are
not tied to a particular MatCore release. Ordinary publication, candidate
ranking, surveys and metadata acceptance remain separate operations.

## Export

`GET /api/communities/[slug]/review-packet` accepts repeated `target`
parameters, `names=0|1`, `examples=0|1` and `format=preview|html|json`. HTML and JSON downloads
require the `fingerprint` returned by preview. Selection is limited to 100
records. History and response queries are bounded, and the serialized model
has a size limit. Oversized packets fail explicitly rather than omit rows.

A repeatable-read, read-only transaction creates one report model. The model
includes exact revisions, comparisons, attributable sources, permitted
discussion, votes and feedback grouped by round. Author attribution is
included. Respondent names require an explicit option. Private drafts,
credentials, account email addresses, source file bytes and inaccessible
survey participation are omitted.

The fingerprint excludes the generation timestamp but includes exported
content. Changes to feedback, names, decisions or source access invalidate an
old preview. Every request checks current steward or administrator access.
The route uses private, no-store responses. The HTML renderer escapes text,
limits links to web protocols and emits a content security policy that also
applies when the report is downloaded. HTML and JSON use the same model.
Exporting does not create a decision, release or archived packet record.

## Dataset exercises and provenance

A review can enable an optional dataset exercise pinned to a granted source
release and profile. Current examples point to immutable exercise events.
Each saved response and response event records its exact example revision.
The client supplies the revision it displayed. A concurrent example edit
causes a conflict, so a response cannot silently attach unseen evidence.
Comment-only responses count as feedback. Empty responses are withdrawals and
are excluded from packet counts and respondent lists.

Dataset examples require a separate export option and appear once per saved
revision, with links from the relevant review feedback. The packet includes
only example revisions attached to selected current responses. Unlinked
examples and later edits remain outside that packet. Name and affiliation
snapshots require the names option, though dataset text can identify an
author independently. XML is escaped as text in HTML.

The XML parser checks well-formedness only. It rejects DTDs, custom entities,
processing instructions, excessive nesting and oversized input. It does not
resolve external content or validate values against an executable schema.
Example reads require ownership or community management. Result and export
queries bound rows and bytes before loading XML payloads.

## Preservation and rollout

The shared navigation and packet increment needs no data conversion. The
subsequent dataset exercise increment adds migration `0077`. Its new tables
and nullable columns preserve earlier review rows and leave exercises disabled
for existing rounds. Foreign keys and triggers enforce the response's author
and round, while exercise events reject updates. Account or community purges
must account for these new evidence tables.

The supplied MatCore v0.5.0 catalog is a separate protected installation, not a
migration seed. `scripts/install-matcore-source.ts` requires the supplied PDF,
its reproducible manifest and the protected 0.3.0 HTML baseline to verify the
reviewed identity mapping. PDF extraction uses Poppler's `pdftotext` and the
Python standard library. Verify those tools on a target host before source
installation. The full corpus stays outside Git. Existing 0.3.0
source records, grants, drafts and provenance must remain unchanged. The new
reference is granted only to an authorized members-only community.

A future Ego release needs backup and migration rehearsal for `0077`, followed
by a separately reviewed v0.5.0 source installation if requested. Do not
reimport existing drafts, copy a workstation database to Ego, or retarget
existing review rounds. Create a new version-specific round when appropriate.
Deploy through the normal preservation process and avoid public test entries.

The version transition must preserve each existing contribution's original
reference basis. Keep the complete 0.3.0 catalog and its baseline text alongside
0.5.0. New work defaults to the newly installed reference. Existing drafts,
revision links, review items and responses continue to use their recorded
source version. A cross-version transfer is a separate contribution with
explicit lineage, never an update to the old source binding.

Before an Ego transition, capture a fresh Ego backup and fingerprints of all
existing records and source/version relationships. Rehearse on a restored
copy and verify those fingerprints again after the live operation. Any
unexplained change blocks completion. UI acceptance must include existing
0.3.0 entries, drafts, comparisons, provenance and old review links, followed
by a new 0.5.0 workflow. No existing review is retargeted merely because the
default reference changed.

The survey visibility helper uses a distinct SQL alias for the outer study
community. The packet regressions check that a viewer who can read another
community still cannot see private survey participation.

## Verification

`test:community-navigation` covers context and bounded return links.
`test:community-review-packet` covers the report renderer and request parsing.
`test:community-review-packet-db` checks permissions, exact revisions,
feedback isolation, source attribution, stale previews and rollback
preservation. `test:community-reviews-db` covers mixed and historical
selection. `test:shared-community-ui` exercises ordinary and metadata
communities, member and steward access, draft save/reload and packet export.
`test:community-review-exercise` checks XML and input validation. Its `-db` and
`-ui` suites cover comment-only feedback, immutable example versions, access,
conflicts, interrupted saves, mobile navigation and preservation across source
versions. Existing MatCore and community browser suites cover compatibility.

Database and browser checks require disposable local fixtures. They do not
use the private MatCore corpus or contact external AI providers.
