# Contribution files and source documents

The Add flow accepts PDF, PNG and JPEG **Examples**, and PDF, DOCX or UTF-8 TXT
**Sources**. Contributors can also paste source text. Uploaded files and pasted
text are retained as immutable original bytes with a SHA-256 hash; the recorded
origin distinguishes `upload` from `paste`. Existing image-source attachments
remain readable, but new source input uses document formats.

Source documents have a separate extraction, term-check and context-selection
workflow. A source citation and use of that source by an assistant are separate
facts. Attaching or citing a file alone never asserts that a model used it.

## Reading and checking a source

Saving a source queues a versioned extraction. The application does not run
parsers or OCR in a Next.js request. The separate
[source document worker](source-document-worker.md) reads PDF text with Poppler,
DOCX text with a bounded Python ZIP/XML reader, and TXT as strict UTF-8. PDF
pages with little embedded text or substantial scanned imagery use Tesseract
OCR. A PDF may contain both embedded-text and OCR pages. OCR currently uses the
English `eng` model; it does not detect or select other languages.

The limits are 5 MiB per original, 50 PDF pages, 200,000 extracted characters,
and a two-minute processing deadline. OCR rendering uses 150 dpi with a
2,400-pixel maximum dimension. Rendering and recognition commands each have a
30-second limit within the document deadline. Password-protected, unreadable,
malformed or oversized documents fail visibly. Text is not silently truncated.
The worker records the method, parser/engine versions, page offsets, OCR
confidence when available, completion time and transcript hash.

A contributor can correct a ready transcript before publication. Each save
creates a new ready version with its parent extraction, contributor, timestamp
and new text hash; it never changes original bytes or an earlier transcript.
Correction uses the recorded method `contributor-correction` and editor version
`contributor-transcript-v1`. OCR ancestry is preserved. The corrected version
needs a new term check and, for OCR sources, a fresh review confirmation before
use. An earlier saved check still selects its earlier transcript. Publication
fixes the selected version and its ancestor history; later private branches are
not included.

A contributor checks the confirmed term against a ready transcript. Matching is
case-insensitive, respects Unicode word boundaries and normalizes whitespace
and soft hyphens while preserving positions in the saved text. Up to 20
explicit aliases are allowed; synonyms are not inferred. A check records the
term, aliases, matches, passages, matcher version and timestamp. Match offsets
are UTF-16 positions in the immutable transcript. A term occurrence establishes
eligibility for context selection, not support for a definition's accuracy.
Without a term or supplied-alias match, the source cannot be sent to a model.

The contributor can choose passages or the full extracted text. “Full” means
the complete saved transcript, not the original binary. Selected passages are
assembled in transcript order. Before generation, the server rechecks ownership,
term and vocabulary, exact extraction/check IDs, matches and passage IDs, then
constructs the exact text itself. The combined document text and retrieved
reference context must fit 24,000 characters; an oversized selection is rejected
without truncation. At most three distinct source files can be selected. An OCR
transcript requires an explicit review confirmation before model use. Its
receipt records who confirmed and when the server received the confirmation;
it is an assertion by the contributor, not proof that they read the document.

The source reader is `/sources/<fileId>`. It provides the original download,
the saved transcript and, after publication, the exact accepted model inputs.
Pending readers are private to the owner. Public readers use the extraction
bound at publication, never whichever extraction happens to be newest. Private
checks and unaccepted model inputs are not exposed publicly.

## Storage, retention and access

`contributionFiles` stores the bytes, content hash, filename, media type, size,
uploader, confirmed term and vocabulary, role, title, caption, optional citation
and page information, and original-text origin. Bytes are PostgreSQL `bytea` and
are included in database backups, restores and workstation snapshots. The upload
endpoint buffers at most 5 MiB plus 64 KiB of multipart overhead and checks the
file byte count separately. The reverse proxy must permit that request size.
Signature checks establish the expected container type; worker parsing adds
bounded structure/content checks. Neither is a malware scan.

An account can retain six pending files, totaling at most 30 MiB. Quota checks,
draft binding, removal and cleanup serialize on the owning account row. A pending
file remains private. It normally expires after 24 hours, but is retained while
linked to an active saved draft, reserved by an unexpired generation lease, or
used by a generated suggestion less than 24 hours old. Saved drafts retain files
referenced by their source selections or server-owned suggestion receipts even
if those files are absent from the draft's explicit citation list. Accepted
suggestions and published file records preserve their sources.

Generation leases last ten minutes and are released after the request. Discarding
a suggestion or deleting a draft releases its retention when nothing else still
uses the file. Removing one draft's link does not release another draft's file.
Expired unretained rows are removed when the owner lists or uploads files;
`pnpm files:cleanup` performs the same cleanup across accounts. The pending list
allows recovery after refresh, term changes or publication with unused uploads.
Files from another confirmed context may be removed but cannot be attached to
the current contribution.

Upload, term-check, OCR retry and removal require a session and configured same
origin. Upload also requires a completed contributor profile and active
destination vocabulary. A UUID alone grants no pending access. Downloads and
source API reads use private/no-store responses. Original files are served with
Content-Disposition attachment, nosniff and a sandbox policy; document HTML is
not executed or embedded.

## Publication and provenance

Explicit review selections (`attachments: [{ fileId, publish: true }]`) record
contributor citations. Their checkbox starts unchecked for a new or recovered
file. Sources used by an accepted assistant suggestion are also mandatory
publication attachments, even if their citation checkbox is unchecked. In that
case `contributorCited` is false while assistant use remains recorded. Discard
the suggestion or generate a replacement without that source to remove its
model-use relationship. The union of explicit attachments and used sources may
contain at most three distinct files.

Publication checks uploader, expiry/retention, confirmed term, vocabulary and
revision author, then binds all files atomically with the ordinary new-term
publication transaction. A failure rolls back all bindings. `publishedExtractionId`
pins the exact extraction used by the accepted suggestion; a manually cited
source uses its latest ready extraction at publication. A new source with a
queued, processing or failed latest attempt must finish processing or be removed
from publication. Legacy source attachments without any extraction record retain
their download-only behavior. An **Example** also creates an
independently attributed `definitionExamples` contribution. File attachment
controls apply to Add; inherited alternative, replacement and survey actions
do not gain attachment controls through this change.

Database guards make published files and their revision linkage immutable,
protect completed extraction and check records, and prevent changes to stored
AI source-input receipts. Later processing cannot rewrite an accepted input or
historical revision. Ordinary definition edits preserve historical attachments.
Exceptional administrative purge explicitly removes files before examples and
revisions.

The public provenance graph distinguishes these steps:

1. The contributor uploads a file or pastes source text. The original entity
   records its origin, content hash and contributor attribution.
2. A processor produces a transcript, with method, version, time and text hash.
   Any contributor correction derives a new transcript from its parent and
   records human attribution separately from the original processor.
3. A deterministic check produces term/alias matches and their positions.
4. If applicable, the contributor confirms OCR review of that transcript.
5. The contributor selects passages or full text. The resulting exact-input
   entity includes its text, locations, selection time and hash.
6. The assistant generation activity **uses** that exact-input entity. The
   suggestion and published revision derive from it.

Only accepted suggestions bound to a published definition expose steps 3–6.
A manual citation can expose its bound extraction without implying an AI check,
review or use. A contributor citation creates a reference edge only when
`contributorCited` is true; an example has its own example relationship. Reader
and original-download paths remain attached to extraction evidence. The graph
and reader distinguish cited sources, assistant-used sources and sources with
both roles.

## Verification

- `pnpm test:contribution-files` checks file signatures/types, body caps,
  multipart metadata, duplicate parts, download headers and publication schema.
- `pnpm test:contribution-files-db` checks ownership, privacy, transactional
  binding, independent example provenance, immutable history, quotas and purge
  with isolated local fixtures.
- `node --import tsx scripts/test-source-documents.ts` checks real local
  extraction and deterministic matching, including PDF/DOCX/TXT, mixed/scanned
  PDF fixtures, aliases, exact offsets, selection and parser limits. OCR coverage
  requires the worker's Poppler, Tesseract and English data dependencies.
- `node --import tsx scripts/test-source-document-provenance.ts` checks the
  extraction/check/review/selection/use graph, hashes, exact input, publication
  gating and independent citation semantics without a provider or database.
- `node --conditions=react-server --import tsx scripts/test-source-documents-db.ts`
  checks ownership, aliases/no-match, exact full/passage receipts, context budget,
  OCR confirmation, immutable corrections and their new checks,
  lease/suggestion/saved-draft retention, mandatory source publication,
  queued-source rollback, bound-reader access and actual graph edges. It
  requires a migrated disposable localhost database with a test/QA name, commits
  synthetic fixtures and removes them in `finally`; it calls no provider.

The source provenance and database suites have verified that an accepted
source-backed suggestion produces an AI-use edge without inventing a contributor
citation, and that a later extraction cannot replace its published transcript.
These checks do not establish provider answer quality or production deployment.
