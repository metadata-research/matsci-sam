import Link from "next/link"
import type { ContributionEvidence } from "@/lib/contribution-evidence"
import { contributionEvidenceAnchor } from "@/lib/contribution-evidence"
import { revisionPath } from "@/lib/public-identifiers"
import { formatDateTime } from "@/lib/date"
import { ReferenceSnapshot } from "@/components/definition/reference-snapshot"

function StoredText({ title, text }: { title: string; text: string | null }) {
  if (text === null) return null
  return (
    <details className="min-w-0 rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <p className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
        {text}
      </p>
    </details>
  )
}

export function ContributionEvidencePanel({
  contributions,
  termSlug,
  vocabularySlug
}: {
  contributions: ContributionEvidence[]
  termSlug: string
  vocabularySlug: string
}) {
  if (!contributions.length) return null
  return (
    <section
      aria-labelledby="contribution-evidence-heading"
      className="space-y-4 py-4"
    >
      <h2 id="contribution-evidence-heading" className="text-xl font-semibold">
        Sources and AI assistance
      </h2>
      <p className="text-sm text-muted-foreground">
        Evidence attached to published revisions. Contributor citations,
        references supplied to a model, and sources reported in its answer have
        different roles.
      </p>
      {contributions.map((entry) => (
        <details
          key={`${entry.definitionNumber}-${entry.version}`}
          id={contributionEvidenceAnchor(entry.definitionNumber, entry.version)}
          className="min-w-0 scroll-mt-6 rounded-lg border bg-card p-4"
        >
          <summary className="cursor-pointer font-medium">
            Definition {entry.definitionNumber} · revision {entry.version}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {entry.model ? entry.model.name : "Cited references"} ·{" "}
              {entry.citations.length}{" "}
              {entry.citations.length === 1 ? "citation" : "citations"}
            </span>
          </summary>
          <div className="mt-4 min-w-0 space-y-5">
            <p className="text-sm text-muted-foreground">
              Revision recorded {formatDateTime(entry.publishedAt)}.{" "}
              <Link
                href={revisionPath(
                  termSlug,
                  entry.definitionNumber,
                  entry.version,
                  vocabularySlug
                )}
                className="text-primary underline"
              >
                Open this revision
              </Link>
            </p>
            {entry.citations.length > 0 && (
              <section
                aria-label="Contributor-declared citations"
                className="space-y-3"
              >
                <h3 className="text-base font-semibold">
                  Contributor-declared citations ({entry.citations.length})
                </h3>
                <p className="text-sm text-muted-foreground">
                  The contributor attached these sources when publishing this
                  revision. Retrieval or copying alone does not establish a
                  citation.
                </p>
                {entry.citations.map((source, index) => (
                  <ReferenceSnapshot key={index} reference={source} />
                ))}
              </section>
            )}
            {entry.model && (
              <section
                aria-label="Recorded model assistance"
                className="min-w-0 space-y-4"
              >
                <h3 className="text-base font-semibold">
                  Recorded model assistance
                </h3>
                <dl className="grid min-w-0 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)] [&>dd]:break-words [&>dd]:[overflow-wrap:anywhere] [&>dt]:text-muted-foreground">
                  <dt>Assistant / model</dt>
                  <dd>{entry.model.name}</dd>
                  {entry.model.inference?.provider && (
                    <>
                      <dt>Provider</dt>
                      <dd>{entry.model.inference.provider}</dd>
                    </>
                  )}
                  {entry.model.inference?.responseModel && (
                    <>
                      <dt>Provider-reported model</dt>
                      <dd>{entry.model.inference.responseModel}</dd>
                    </>
                  )}
                  {entry.model.inference?.responseId && (
                    <>
                      <dt>Provider response identifier</dt>
                      <dd className="font-mono text-xs">
                        {entry.model.inference.responseId}
                      </dd>
                    </>
                  )}
                  {entry.model.recordedAt && (
                    <>
                      <dt>Suggestion recorded</dt>
                      <dd>{formatDateTime(entry.model.recordedAt)}</dd>
                    </>
                  )}
                  {entry.model.acceptedAt && (
                    <>
                      <dt>Accepted for publication</dt>
                      <dd>{formatDateTime(entry.model.acceptedAt)}</dd>
                    </>
                  )}
                </dl>
                <p className="text-sm text-muted-foreground">
                  {entry.model.publication === "unchanged"
                    ? "The contributor published the recorded suggestion unchanged."
                    : entry.model.publication === "edited"
                      ? "The published wording differs from the recorded suggestion. Both texts are preserved below."
                      : "No separate accepted suggestion record is linked to this revision. Only the available model evidence is shown."}
                </p>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <StoredText
                    title="Original model response"
                    text={entry.model.output}
                  />
                  <StoredText
                    title="Published wording"
                    text={entry.publishedText}
                  />
                </div>
                <details className="min-w-0 rounded-md border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Recorded request inputs and configuration
                  </summary>
                  <div className="mt-3 min-w-0 space-y-3">
                    <StoredText
                      title="Definition / notes supplied to the model"
                      text={entry.model.inputDefinition}
                    />
                    <StoredText
                      title="Example supplied to the model"
                      text={entry.model.inputExample}
                    />
                    <StoredText
                      title="Revision guidance"
                      text={entry.model.feedback}
                    />
                    <StoredText
                      title="Exact user message"
                      text={entry.model.userPrompt}
                    />
                    <StoredText
                      title="Definition instructions"
                      text={entry.model.systemPrompt}
                    />
                    {entry.model.inference && (
                      <p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        Profile: {entry.model.inference.profile}. Configuration
                        fingerprint: {entry.model.inference.configHash}.
                      </p>
                    )}
                  </div>
                </details>
                <section
                  aria-label="References supplied to the model"
                  className="min-w-0 space-y-3"
                >
                  <h4 className="font-medium">
                    References supplied to the model (
                    {entry.model.references.length})
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {entry.model.output === null
                      ? "No separate reference-input record is linked here."
                      : "These are the stored references included in this request. Inclusion does not establish which facts the model used."}
                  </p>
                  {entry.model.references.map((source, index) => (
                    <ReferenceSnapshot key={index} reference={source} />
                  ))}
                </section>
                {entry.model.reportedSources.length > 0 && (
                  <section
                    aria-label="Sources reported by the assistant"
                    className="space-y-2"
                  >
                    <h4 className="font-medium">
                      Sources reported by the assistant (
                      {entry.model.reportedSources.length})
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Links returned with the original model response. They are
                      provider-reported references, not independently verified
                      sources or contributor-declared citations.
                    </p>
                    <ul className="list-disc space-y-2 pl-5 text-sm">
                      {entry.model.reportedSources.map((source) => (
                        <li
                          key={source.url}
                          className="break-words [overflow-wrap:anywhere]"
                        >
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline"
                          >
                            {source.title || source.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {Boolean(entry.model.inference?.toolEvidence?.length) && (
                  <details className="min-w-0 rounded-md border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Provider-reported tool activity
                    </summary>
                    <p className="my-3 text-sm text-muted-foreground">
                      Tool identities reported by the provider. Arguments,
                      private payloads and reasoning are excluded.
                    </p>
                    <ul className="space-y-2 text-xs">
                      {entry.model.inference!.toolEvidence!.map(
                        (tool, index) => (
                          <li
                            key={index}
                            className="break-words [overflow-wrap:anywhere]"
                          >
                            {tool.type}
                            {tool.tool ? ` · ${tool.tool}` : ""}
                            {tool.requestId
                              ? ` · Request ${tool.requestId}`
                              : ""}
                          </li>
                        )
                      )}
                    </ul>
                  </details>
                )}
              </section>
            )}
          </div>
        </details>
      ))}
    </section>
  )
}
