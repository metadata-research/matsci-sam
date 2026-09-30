# Contribution files

The Add flow accepts PDF, PNG and JPEG uploads as **Examples** or **Sources**.
The application checks signatures against the declared media type and serves
files as downloads. It does not parse file contents, display embedded previews,
perform OCR or supply files as assistant input. Signature checks establish a
supported container type. Content validation and malware scanning are outside
this check.

## Lifecycle and storage

`contributionFiles` stores immutable bytes, SHA-256 hash, display filename,
media type, size, uploader, confirmed term and vocabulary, purpose, title,
caption and optional citation/page information. Each file is at most 5 MiB. The
upload endpoint buffers a bounded multipart body before parsing it, with 64 KiB
allowed for metadata and multipart overhead. It checks the file byte count
separately. File content remains in the request body.

Files are stored in PostgreSQL `bytea` and are included in database backups,
restores and workstation snapshots.

An account can retain six pending files, totaling at most 30 MiB. Quota checks
serialize on the corresponding user row. Pending files are readable/deletable
only by their uploader and expire after 24 hours. Vocabulary and provenance
queries exclude pending files. The owner's pending list permits recovery after
refresh, a term change, or publication with files left unselected. Files from
another confirmed context can be removed but cannot be attached to the current
draft. Expired rows are removed when the owner lists or uploads files. The
maintenance command `pnpm files:cleanup` removes expired pending rows across
accounts.

Upload and removal require the session and configured same origin. Upload also
requires a completed contributor profile and the active destination vocabulary.
GET responses are private/no-store. A file UUID alone grants no pending access.
All downloads use Content-Disposition attachment, nosniff, and a sandbox policy.

## Publication

A new upload remains private and pending. The review checkbox starts unchecked
for each new or recovered file. Only explicit
`attachments: [{ fileId, publish: true }]` selections enter
`definitions.create`. At most three distinct files may accompany a contribution.
File attachment controls are available in Add. Inherited alternative,
replacement and study actions exclude them.

Publication locks each selected row and verifies uploader, expiry, confirmed
term, vocabulary and the definition author for the target revision. It binds all
files inside the ordinary publication transaction. A failure rolls back all
bindings. A pending file can then be retried. The database trigger also
validates exact revision/author/term correspondence and prevents overwriting
published bytes, metadata or linkage. New uploads start pending.

A **Source** file is an explicit contributor citation for the exact published
revision. The citation and download remain attached to that revision. Later
revisions have separate citations. An **Example** also creates an independently
attributed `definitionExamples` contribution containing its title and caption.
The file retains its exact publication revision and example ID. The example
collection continues unchanged through definition edits.

Public definition pages show source downloads for that revision. Example cards
show their associated file. Provenance includes public file metadata, hash and
attribution. Source files have a reference edge from the exact revision. Example
files have an edge from the example. File publication creates no assistant
`prov:used` edge. Exceptional administrative definition purge explicitly removes
file rows before examples and revisions. Ordinary edits preserve historical
attachments.

## Verification

- `pnpm test:contribution-files` checks supported signatures/types, actual body
  caps, multipart multilingual metadata, duplicate file parts, download headers
  and explicit publication schema.
- `pnpm test:contribution-files-db` uses fixtures restricted to localhost and
  rolls them back after checking ownership, privacy, context binding, publication
  rollback, independent example provenance, immutable history, recoverable pending
  quotas and administrative purge.

Migration `0061_contribution_files.sql` creates the file table and its
immutability trigger. The reverse proxy must allow 5 MiB for the file plus 64
KiB of multipart overhead. Check the host configuration when diagnosing rejected
uploads.
