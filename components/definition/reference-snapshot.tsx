import { referenceText } from "@/lib/reference-text"
import { formatDate } from "@/lib/date"
import type { WolframLookupRequest } from "@/lib/wolfram-query"

export function ReferenceSnapshot({
  reference
}: {
  reference: {
    term: string
    definition: string
    sourceKey: string
    source: string
    sourceIri: string
    version: string
    license: string | null
    usageStatus: string
    retrievedAt: string
    query?: string
    context?: string | null
    request?: WolframLookupRequest
    responseUuid?: string | null
    contentHash?: string
  }
}) {
  return (
    <details className="min-w-0 rounded-md border p-3 text-sm">
      <summary className="cursor-pointer">
        {reference.source}: {reference.term} ·{" "}
        {reference.usageStatus === "prototype"
          ? "prototype context"
          : `release ${reference.version}`}
      </summary>
      <div className="mt-3 flex min-w-0 flex-col gap-2">
        {(reference.query || reference.request) && (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            Lookup query: {reference.request?.input ?? reference.query}
          </p>
        )}
        {!reference.request && reference.context && (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            Lookup context: {reference.context}
          </p>
        )}
        {reference.request && (
          <div className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
            <p>Units: {reference.request.options.units}</p>
            <p>
              Interpretation options:{" "}
              {reference.request.options.assumptions.join(", ") || "Automatic"}
            </p>
          </div>
        )}
        <blockquote className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">
          {referenceText(reference)}
        </blockquote>
        <p>
          {reference.license === "CC-BY-4.0" ? (
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              className="underline"
            >
              {reference.license}
            </a>
          ) : (
            (reference.license ??
            "Prototype use; long-term terms under discussion")
          )}
        </p>
        <a
          href={reference.sourceIri}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          Open source
        </a>
        <p className="text-xs text-muted-foreground">
          Retrieved {formatDate(reference.retrievedAt)}. The stored source text
          is separate from the contributor’s wording above.
        </p>
        {reference.responseUuid && (
          <p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
            Provider response identifier: {reference.responseUuid}
          </p>
        )}
        {reference.contentHash && (
          <p className="break-all text-xs text-muted-foreground">
            Stored content fingerprint: {reference.contentHash}
          </p>
        )}
      </div>
    </details>
  )
}
