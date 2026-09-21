import { referenceText } from "@/lib/reference-text"
import { formatDate } from "@/lib/date"

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
      </div>
    </details>
  )
}
