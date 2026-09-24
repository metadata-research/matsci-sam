# Contribution files

The Add flow accepts PDF, PNG and JPEG uploads as **Examples** or **Sources**.
This increment has no file parsing, preview embedding, OCR or assistant input.
The application checks file signatures against the declared media type and serves
all files as downloads. Signature checks establish a supported container type;
they do not assert that a document is trustworthy or fully well-formed.

## Lifecycle and storage

`contributionFiles` stores immutable bytes, SHA-256 hash, display filename,
media type, size, uploader, confirmed term and vocabulary, purpose, title,
caption and optional citation/page information. Each file is at most 5 MiB.
The upload endpoint reads a bounded multipart body before parsing it, with
64 KiB allowed for metadata and multipart overhead. A file's actual byte count
is checked separately. No file content is placed in request headers.

Files are stored in PostgreSQL `bytea` so they follow the existing database
backup, restore and workstation snapshot boundary. This is deliberately bounded
small-file storage; it is not a bulk document repository. No release-directory
filesystem or external storage credentials are required.

An account can retain six pending files (at most 30 MiB). Quota checks serialize
on that account's user row. Pending files are readable/deletable only by their
uploader, expire after 24 hours, and never appear in vocabulary or provenance
queries. The owner's pending list permits recovery after refresh, a term change,
or publication with files left unselected. Files from another confirmed context
can be removed but cannot be attached to the current draft. Expired rows are
removed when the owner lists or uploads files; the maintenance command
`pnpm files:cleanup` removes expired pending rows across accounts.

Upload and removal require the session and configured same origin. Upload also
requires a completed contributor profile and the active destination vocabulary.
GET responses are private/no-store. A file UUID alone grants no pending access.
All downloads use Content-Disposition attachment, nosniff, and a sandbox policy.

## Publication

Uploading does not publish, cite, or select an assistant input. The review
checkbox starts unchecked for every new or recovered file. Only explicit
`attachments: [{ fileId, publish: true }]` selections enter `definitions.create`.
At most three distinct files may accompany a contribution. The initial UI scope
is Add, excluding inherited alternative, replacement and study actions.

Publication locks every selected row and verifies uploader, expiry, confirmed
term, vocabulary and the target revision's definition author. It binds all files
inside the ordinary publication transaction. A failure rolls back every binding;
a pending file can then be retried. The database trigger also validates exact
revision/author/term correspondence and prevents overwriting published bytes,
metadata or linkage. New uploads always start pending.

A **Source** file is an explicit contributor citation for the exact published
revision. Later revisions retain no implied citation to it; the earlier record
and download remain available on that revision. An **Example** also creates an
ordinary independently attributed `definitionExamples` contribution containing
its title and caption. The file retains its exact publication revision and
example ID; the example collection continues unchanged through definition edits.

Public definition pages show source downloads for that revision. Example cards
show their associated file. Provenance includes the file's public metadata/hash,
attribution, and a reference edge from the exact revision (source) or example.
It creates no assistant `prov:used` edge and infers no model grounding.
Exceptional administrative definition purge explicitly removes file rows before
examples and revisions. Ordinary edits never overwrite or delete historical
attachments.

## Verification

- `pnpm test:contribution-files`: supported signatures/types, actual body caps,
  multipart multilingual metadata, duplicate file parts, download headers and
  explicit publication schema.
- `pnpm test:contribution-files-db`: localhost-only rollback fixtures for ownership,
  privacy, context binding, publication rollback, independent example provenance,
  immutable history, recoverable pending quotas and administrative purge.

Migration `0061_contribution_files` is required before enabling the new Add UI.
Existing reverse-proxy configurations allow 10 MiB requests, larger than the
single-file endpoint's maximum; no proxy change is required for this increment.
