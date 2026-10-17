# Source document worker

Document extraction and OCR run in a separate serial worker, outside Next.js
request handling. The release includes the worker and a systemd unit template;
installing the application alone does not start it. The local QA worker has been
exercised. This document does not assert deployment to Superego or production.

## Deployment requirements

Apply the source-document database migrations before starting a release that
queues sources. The worker and web application must use the same database and
compatible application release. The template at
[`ops/matsci-sam-source-worker.service`](../../ops/matsci-sam-source-worker.service)
uses the application's service account and paths:

| Setting               | Value                                                          |
| --------------------- | -------------------------------------------------------------- |
| Service user          | `matsci-sam`                                                   |
| Release directory     | `/opt/matsci-sam/current`                                      |
| Protected environment | `/etc/matsci-sam/app.env`                                      |
| Command               | `/usr/bin/node --import tsx scripts/source-document-worker.ts` |

Verify those paths and permissions against the target host's application service
before installing the unit. The release must include `scripts/`, the imported
`lib/` and `drizzle/` sources, and the `tsx`, `pg` and other runtime dependencies.
`tsx` is currently declared as a development dependency: a release that prunes
all development dependencies or ships only the Next.js standalone artifact is
not sufficient for this command. Use the project's compatible Node.js runtime.
The worker needs `DATABASE_URL` from the protected environment; it does not call
an AI provider or need provider credentials for extraction. Do not copy secrets
into the service unit, repository, logs or diagnostic commands.

The host also needs these local tools:

| Dependency        | Required location or configuration                                                  |
| ----------------- | ----------------------------------------------------------------------------------- |
| Poppler utilities | `/usr/bin/pdfinfo`, `/usr/bin/pdftotext`, `/usr/bin/pdfimages`, `/usr/bin/pdftoppm` |
| Python 3          | `/usr/bin/python3`, or absolute `SOURCE_PYTHON_BIN`                                 |
| Tesseract         | `/usr/bin/tesseract`, or absolute `SOURCE_TESSERACT_BIN`                            |
| English OCR data  | `eng.traineddata` in Tesseract's data directory; `TESSDATA_PREFIX` may select it    |

DOCX extraction uses `scripts/extract-docx.py` and the Python standard library;
there is no office application or external document-conversion service. OCR is
English only. Install the English data explicitly and verify it is readable by
the service user. Extra language packs do not change the current `eng` setting.
Use managed host packages for a deployment rather than depending on the
workstation's temporary QA runtime.

Once requirements are met, install the unit through the host's normal operations
process, reload systemd and start/enable `matsci-sam-source-worker.service`.
Restart the worker when changing its release or runtime settings. Verify the
running unit's effective limits, status and journal, then process a synthetic
source through the application and inspect its saved extraction. A running
process alone does not demonstrate that PDF/OCR dependencies are usable.

## Concurrency and resource limits

The worker holds a PostgreSQL session advisory lock named
`matsci:source-worker`. Only one invocation can process that database at a time,
including overlapping releases and diagnostic invocations. A second worker exits
without claiming work. The active worker claims the oldest queued attempt in a
transaction and processes one document at a time. It does not start a worker per
upload or run concurrent OCR pages.

The supplied systemd unit limits the entire worker cgroup, including parser
children:

| Limit               | Value                        |
| ------------------- | ---------------------------- |
| CPU quota           | `100%` (one CPU equivalent)  |
| Memory maximum      | `512M`                       |
| Swap maximum        | `0`                          |
| Tasks maximum       | `32` (processes and threads) |
| Node heap           | `192` MiB                    |
| OpenMP thread limit | `1`                          |
| Node libuv pool     | `2`                          |
| Go scheduler limit  | `2` (`GOMAXPROCS`)           |
| Rayon threads       | `2` (`RAYON_NUM_THREADS`)    |
| Tokio threads       | `2` (`TOKIO_WORKER_THREADS`) |
| Restart on failure  | After 10 seconds             |
| Stop timeout        | 130 seconds                  |

Subprocesses additionally set one OpenMP/OpenBLAS thread. Processing has a
120-second document deadline; PDF page rendering and recognition commands each
have a maximum of 30 seconds within it. Input is capped at 5 MiB, PDF at 50 pages,
text at 200,000 characters, and OCR rasters at a 2,400-pixel maximum dimension.
DOCX ZIP expansion, entry counts and XML input are bounded. A failed limit check
produces an error instead of publishing partial or silently truncated text.

The unit uses `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`,
`ProtectHome` and `UMask=0077`. Temporary document directories are private and
removed after processing. The worker does not need writes to the application
release. Custom parser paths must remain accessible under these protections.
These limits are separate from the web preview's resource controls.

## Queue recovery and diagnostics

An extraction attempt moves from `queued` to `processing`, then to immutable
`ready` or `failed`. Retries create a new version rather than overwrite a
completed transcript. After acquiring the exclusive lock, a worker marks any
interrupted `processing` attempts as failed with a retry message. It does not
silently rerun them. A contributor can request a new attempt; source processing
and contributor transcript corrections share a limit of five versions per file.
Corrections are created by the application as new ready versions and do not run
through the processing queue. They retain their parent transcript and human
attribution; a worker restart does not alter those completed versions.

SIGTERM and SIGINT stop new claims and allow the current document to finish. The
130-second stop timeout exceeds the document deadline. A process killed by a
resource limit is restarted by systemd, and its interrupted attempt is recovered
as described above. Logs include extraction IDs, completion page counts/OCR
flags or safe failure categories, without document text, credentials or raw
parser errors.

For a controlled single-job diagnostic, run
`node --import tsx scripts/source-document-worker.ts --once` from the release
with its protected environment already supplied. It acquires the same lock,
performs recovery and processes at most one queued attempt before exiting. It
does not bypass an already running worker. Do not start extra workers to increase
throughput.

Read-only service inspection can use:

```bash
systemctl status matsci-sam-source-worker.service
systemctl show matsci-sam-source-worker.service -p MainPID -p TasksCurrent -p MemoryCurrent -p MemoryPeak -p CPUUsageNSec -p CPUQuotaPerSecUSec -p MemoryMax -p MemorySwapMax -p TasksMax
journalctl -u matsci-sam-source-worker.service --since '15 minutes ago'
```

A growing queue with no active worker requires checking service deployment. A
saved source reporting processing unavailable requires checking the parser paths
and language data. Failed attempts remain visible and need an explicit retry
after the cause is corrected.

## Local QA runtime

The October 2026 local QA environment used Tesseract 5.5.0 extracted from official
public Debian packages under `/tmp/matsci-ocr-runtime/runtime`, without a system
installation. Its worker environment selected:

```dotenv
SOURCE_TESSERACT_BIN=/tmp/matsci-ocr-runtime/runtime/usr/bin/tesseract
LD_LIBRARY_PATH=/tmp/matsci-ocr-runtime/runtime/usr/lib/x86_64-linux-gnu
TESSDATA_PREFIX=/tmp/matsci-ocr-runtime/runtime/usr/share/tesseract-ocr/5/tessdata
```

The local `matsci-source-worker` unit used the one-CPU, 512 MiB and 32-task caps;
after a task-limit event, explicit Go, Rayon and Tokio thread limits were added
while keeping those caps. No OOM was observed for that event. The preview limits
were unchanged. This temporary runtime may disappear with
`/tmp` cleanup and is not a production installation or durable deployment
requirement. Local parser tests can use the same runtime overrides. Database
lifecycle tests use controlled completed-transcript fixtures and do not require
OCR or provider calls. See [contribution file verification](contribution-files.md#verification).
