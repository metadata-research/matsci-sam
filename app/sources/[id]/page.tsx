import { notFound } from "next/navigation"
import { z } from "zod"
import { getSession } from "@/lib/session"
import {
  inspectSourceDocument,
  publishedSourceInputs,
  sourceExtractionHistory
} from "@/lib/source-documents"
import { contributionFilePath } from "@/lib/contribution-file-types"
import { modelIdentity } from "@/lib/llm/model-identity"

export const dynamic = "force-dynamic"
export default async function SourcePage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) notFound()
  const session = await getSession()
  const inspected = await inspectSourceDocument(id, session.id).catch(
    () => null
  )
  if (!inspected) notFound()
  const { file, extraction } = inspected
  const uses =
    file.publishedRevisionId !== null
      ? await publishedSourceInputs(id, undefined, session.id ?? null)
      : []
  const earlierTranscripts =
    extraction?.status === "ready" && extraction.parentExtractionId
      ? (await sourceExtractionHistory(id, extraction.id)).filter(
          (version) => version.id !== extraction.id
        )
      : []
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8">
      <header className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {file.publishedRevisionId === null
            ? "Private draft source"
            : "Published definition source"}
        </p>
        <h1 className="break-words text-3xl font-semibold">{file.title}</h1>
        <p className="whitespace-pre-wrap">{file.caption}</p>
        {file.citation ? (
          <p className="text-sm text-muted-foreground">{file.citation}</p>
        ) : null}
        <a
          href={contributionFilePath(id)}
          className="inline-flex rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          {file.origin === "paste"
            ? "Download pasted text"
            : "Download original file"}
        </a>
        {file.publishedRevisionId !== null ? (
          <p className="text-sm text-muted-foreground">
            {file.contributorCited ? "Cited by contributor. " : ""}
            {uses.length ? "Used by assistant. " : ""}This record preserves the
            source version associated with publication.
          </p>
        ) : null}
      </header>
      <section aria-label="Source text" className="space-y-3">
        <h2 className="text-xl font-semibold">
          {file.origin === "paste" ? "Pasted text" : "Extracted text"}
        </h2>
        {extraction?.status === "ready" ? (
          <>
            {extraction.hasOcr ? (
              <p className="text-sm text-muted-foreground">
                This transcript includes text read with OCR. The original file
                is available above.
              </p>
            ) : null}
            <div className="rounded-lg border bg-card p-4 sm:p-6">
              {extraction.pages?.map((page, index) => (
                <section key={index} className="mb-5 last:mb-0">
                  <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                    {page.label}
                    {page.method === "ocr" ? " · OCR" : ""}
                  </h3>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {extraction.text?.slice(page.start, page.end)}
                  </p>
                </section>
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">
            {extraction?.error ??
              (extraction
                ? "This source is still being read."
                : "No extracted transcript was recorded. You can download the original file.")}
          </p>
        )}
      </section>
      {earlierTranscripts.length ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Transcript history</h2>
          <p className="text-sm text-muted-foreground">
            Corrections are saved separately. Earlier OCR and extracted text
            remain unchanged.
          </p>
          {earlierTranscripts.map((version) => (
            <details key={version.id} className="rounded-lg border p-4">
              <summary className="cursor-pointer font-medium">
                {version.correctedById
                  ? "Earlier contributor correction"
                  : "Original extraction"}{" "}
                · {version.completedAt}
              </summary>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm">
                {version.text}
              </p>
            </details>
          ))}
        </section>
      ) : null}
      {uses.map((use) => (
        <section
          key={use.id}
          className="space-y-3 rounded-lg border p-4 sm:p-6"
        >
          <h2 className="text-xl font-semibold">
            Text supplied to{" "}
            {modelIdentity(use.model).displayName.replace(/^MatBot /, "")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {use.source.mode === "full"
              ? "Full extracted text"
              : "Selected passages"}{" "}
            · Term checked: {use.source.term}
            {use.source.aliases.length
              ? ` · Aliases: ${use.source.aliases.join(", ")}`
              : ""}
          </p>
          {use.source.ocrReviewed ? (
            <p className="text-sm text-muted-foreground">
              The contributor confirmed review of the OCR text before this
              request.
            </p>
          ) : null}
          <p className="whitespace-pre-wrap break-words rounded-md bg-definition p-4 text-sm leading-relaxed">
            {use.source.text}
          </p>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              Processing record
            </summary>
            <dl className="mt-3 grid gap-2 break-all">
              <div>
                <dt className="font-medium">Extraction</dt>
                <dd>
                  {use.source.parserVersion} · {use.source.extractedAt}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Term matching</dt>
                <dd>
                  {use.source.matcherVersion} · {use.source.checkedAt}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Context selected</dt>
                <dd>{use.source.contextSelectedAt}</dd>
              </div>
              <div>
                <dt className="font-medium">Original content SHA-256</dt>
                <dd>{use.source.fileHash}</dd>
              </div>
              <div>
                <dt className="font-medium">Model input SHA-256</dt>
                <dd>{use.source.textHash}</dd>
              </div>
            </dl>
          </details>
        </section>
      ))}
    </main>
  )
}
