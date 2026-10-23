# MatCore catalog deployment

Deploy the reviewed release to Superego, verify the catalog and proposal
workflow there, then deploy the same commit to Ego. Configure the MatCore
community separately on each host. Each database retains its own accounts,
memberships, drafts, published entries and provenance.

The [MatSci-OPS deployment reference](https://github.com/metadata-research/matsci-ops/blob/master/deploy/README.md)
defines the release commands, backup and migration rehearsal, authentication
and recovery procedure. This checklist covers the MatCore records and workspace
configuration that accompany that release. Record completed checks in
[workflow progress](matcore-workflow-progress.md).

## Code, schema and content

| Part | Deployment behavior |
| --- | --- |
| Schema | Migration `0070_matcore_field_workflow` adds source releases and occurrences, fields, private drafts, immutable revisions and provenance events. Migration `0071_community_metadata_workspace` adds workspace settings and permits metadata fields without a MatCore profile. Migration `0072_community_content_access` adds community visibility, access requests and workspace source grants. Migration `0073_community_collection_scope` adds optional community access for new collections and guards restricted surveys. Apply migrations through the release procedure. |
| Source catalog | The repository and build contain no protected standard text. Install the reviewed artifact and manifest separately into the host database, granting only the selected members-only community access. Catalog reads use installed snapshots. Without an installation, the catalog is empty. Browsing creates no database rows. |
| First proposal | An explicit proposal action requires an installed and granted source version and creates one private draft for the selected occurrence. A repeated action resumes the existing draft. Existing stored baselines are used unchanged. Source installation rejects a conflicting manifest for the same release ID. |
| Community setup | The release creates no community, vocabulary, account or membership. Select or create the intended community through the application and configure its vocabulary. |
| Existing work | Source IDs, draft owners and payloads, definition links, published revisions and event history remain intact. Private drafts remain in My work. |

The 0.3.0 catalog has 248 contextual source entries across seven profiles.
These are reference entries, not 248 published dictionary terms or a required
set of private drafts. The earlier 2025 catalog retains its identifiers and
existing links. Its entries are not automatically mapped to later snapshots.

The local preview contains 248 private working copies from an earlier bulk
import. That count describes local data only. Deployment does not copy those
drafts or their developer account to either host. **Import all sections as
drafts** remains an optional contributor action after setup.

## Prepare each host

1. Inventory the intended community and its vocabulary, membership roles,
   workspace settings, recorded source releases and any existing MatCore work.
   Record exact IDs and slugs. Reuse an existing destination when its identity
   and purpose match. A similar display name is insufficient evidence for
   moving or merging entries.
2. Record the migration ledger and preserve row counts and fingerprints for
   existing drafts, revisions, sources and provenance. Include ordinary term
   links, historical MatCore assertions and survey references in the
   preservation checks. Capture the backup through the release procedure.
3. Check the protected source artifact and manifest against the reviewed
   snapshot. Keep both outside the repository and release directory with
   restricted file permissions. Transfer them through the prepared protected
   host procedure, without printing source text in CI or terminal logs. Retain
   source URL, attribution, artifact hash and manifest hash as release evidence.
4. Review privacy before applying migration 0072. It restricts communities
   containing existing MatCore source pins and grants those recorded source
   versions. Other communities remain public. Existing drafts, source snapshots
   and provenance are unchanged. Migration 0073 leaves all existing collection
   scopes public. It refuses a private survey containing another vocabulary's
   terms, rather than changing existing study records. A standalone vocabulary containing protected
   fields must first be assigned an explicit community. For a host with a
   public graph store, gate external graph access before migration, rebuild
   the public-only projection, and verify it before restoring access. Do not
   serve a stale projection while private records are being removed from it.
5. Release through MatSci-OPS, with backup, scratch migration rehearsal and
   database invariants. Superego and Ego use their respective databases.
   Workstation data and Superego data are not installation inputs for Ego.

Migration 0071 enables both workspace tools for vocabularies already represented
in `matcoreFields`. It does not identify destinations from their names or the
historical catalog. Include that backfill in the inventory review. A host
without existing field records needs explicit workspace configuration.
The catalog remains visible for a vocabulary with a field linked to a source
even if its MatCore creation tools are later disabled.

## Configure the community

Open the selected community as a steward or site administrator. In
**Overview**, set **Content access** to **Members only**. In **My work**, open
**Workspace tools**, enable metadata development and enable MatCore.

Run the source installer with explicit protected artifact and manifest paths,
the selected vocabulary slug and a site-administrator account ID. Rehearse
first, then apply through the reviewed host setup wrapper. It must use the
host's own database and a real authorized administrator. Do not copy local
accounts, change a contributor's role temporarily or create a public corpus.

```sh
pnpm source:install-matcore \
  --manifest /protected/matcore/standard-0.3.0.json \
  --artifact /protected/matcore/standard-0.3.0.html \
  --vocabulary COMMUNITY_SLUG --actor ADMIN_ID
```

The command rolls back by default. Add `--apply` only for the approved setup.
An identical existing installation is preserved. A conflicting release fails.
The protected files are installation inputs, not public files or build assets.
Keep their backup and retention policy explicit in the host setup record.

Confirm that an authorized member sees **Vocabulary** with the expected
version and profiles. An outsider must see only the public name and access
request controls. A community containing protected source material cannot be
switched to public. Record the community and vocabulary URLs for that host.

Retain the existing owners and privacy of any previously imported drafts.
**Continue my draft** resumes the matching working copy. **Propose a change**
creates a private draft only when the contributor starts one. A published
local proposal remains linked to its preserved source and revision history.
The setup does not convert drafts to approved content or publish a batch.

New community-specific metadata fields remain available through **New metadata
field**. Contributors can leave Standard context unset for an independent
field. Enabling MatCore does not assign a MatCore baseline to existing generic
fields or ordinary vocabulary terms.

## Verify Superego, then Ego

Complete these checks on Superego before releasing the same commit to Ego.
Repeat the preservation and browsing checks on Ego against its own records.

| Check | Expected result |
| --- | --- |
| Catalog browsing | Version and profile filters, pagination, source definitions, rules and attribution work. Reads create no drafts, terms or provenance events. |
| Access boundary | Anonymous visitors, nonmembers and removed members cannot read private terms, definitions, catalog entries, sources, drafts or exports by direct URL or API. Public searches, activity and graphs omit those records. A member cannot read another author’s draft. |
| Access requests | Requesting access does not grant membership. Steward approval grants shared access, and removal ends it on the next request. No email is sent by these controls. |
| Existing draft | The owner can resume the same ID with the same saved content, citations, source pin and history. Other accounts cannot read it. |
| Proposal cycle | An explicit action creates one draft. Repeated clicks resume it. Edits survive save, reload and the return to the selected source entry. |
| Local publication | An authorized proposal retains its source version, citations and exact definition/specification revision. Local review remains distinct from upstream MatCore approval. |
| Navigation | Desktop and narrow mobile layouts preserve source version, profile and result page. Anonymous sign-in returns to the selected entry. |
| Historical content | The 2025 catalog and identifiers, existing term metadata, surveys and unrelated communities retain their content and links. |
| Preservation | Existing rows match the recorded baseline. Expected migrations, settings and deliberate contributions are listed separately from unchanged records. |

Use dedicated test records on Superego with an exact cleanup inventory.
On Ego, use existing content for browsing and preservation checks. A write or
publication check there requires a separately agreed contribution and its
disposition. Leave no public QA terms, communities or collections behind.
Do not delete source snapshots referenced by other contributions during cleanup.

The local `test:matcore-catalog-ui` harness uses a distinct invented source
version and removes its fixtures. It does not need the real MatCore corpus
and is not a remote production acceptance script. The checklist above applies to host UI
acceptance without copying that harness or its database to a live host.

Record the deployed commit, migration results, community/vocabulary IDs, source
version and hashes, preservation results and acceptance evidence for each host.
Keep unfinished checks marked pending. Follow the MatSci-OPS recovery procedure
if a release or migration fails, with schema compatibility checked before any
code rollback.

## Later source versions

A later MatCore version needs a separately reviewed source snapshot and explicit
identity mapping. A deployment does not fetch the current website or rebase
existing drafts. Preserve each earlier source pin and its citations when adding
a version. The catalog lists recorded versions, while proposal revisions keep
their own local revision history. Automatic upgrades, team review assignments
and upstream release assembly remain separate work.
