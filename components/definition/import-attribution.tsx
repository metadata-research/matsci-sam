import type {
  ManualCitationEvidence,
  PublicImportOrigin
} from "@/lib/import-origin-provenance"
import { formatDateTime } from "@/lib/date"

export function DeclaredSource({ source }: { source: ManualCitationEvidence }) {
  const href = /^https?:\/\//i.test(source.url) ? source.url : null
  return (
    <div className="min-w-0 space-y-1 break-words text-sm [overflow-wrap:anywhere]">
      <p className="font-medium">{source.title || source.url || "Source"}</p>
      {source.creator && <p>Source credited to: {source.creator}</p>}
      {source.version && <p>Version: {source.version}</p>}
      {source.license && <p>Licence: {source.license}</p>}
      {href && (
        <a href={href} className="text-primary underline">
          Open source
        </a>
      )}
    </div>
  )
}

export function ImportAttribution({ origin }: { origin: PublicImportOrigin }) {
  return (
    <details className="min-w-0 rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Import and source credit
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-muted-foreground">
          Imported by this contribution&apos;s author on{" "}
          {formatDateTime(origin.importedAt)}. Source credit below was supplied
          by the contributor.
        </p>
        {origin.declaredOrigin && (
          <DeclaredSource source={origin.declaredOrigin} />
        )}
        {origin.originalWording ? (
          <details>
            <summary className="cursor-pointer">
              Original imported wording
            </summary>
            <p className="mt-2 font-medium">{origin.originalWording.term}</p>
            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {origin.originalWording.definition ||
                "No definition was supplied."}
            </p>
          </details>
        ) : (
          <p className="text-muted-foreground">
            Original imported wording was kept private.
          </p>
        )}
        <details>
          <summary className="cursor-pointer">Import record</summary>
          <dl className="mt-2 grid min-w-0 gap-1 [&>dd]:break-all">
            <dt>Parser</dt>
            <dd>{origin.parserVersion}</dd>
          </dl>
        </details>
      </div>
    </details>
  )
}
