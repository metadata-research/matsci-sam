import { sourceFieldName } from "@/lib/metadata-field-name"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { formatDateTime } from "@/lib/date"
import { profileLabel } from "./workspace-presenters"

type Draft = RouterOutput["matcoreWorkflow"]["getDraft"]

export function ProfileContext({
  context
}: {
  context: Draft["profileContext"]
}) {
  if (!context) return null
  return (
    <details className="mb-6 rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Profile context · MatCore {context.release.version} ·{" "}
        {profileLabel(context.profile.id)}
      </summary>
      <div className="flex flex-col gap-3 pt-3 text-muted-foreground">
        <p>{context.profile.description}</p>
        {context.profile.inherits.length ? (
          <p>
            Includes: {context.profile.inherits.map(profileLabel).join(", ")}.
            Inherited fields keep their own source paths.
          </p>
        ) : null}
        {context.profile.inheritanceNote ? (
          <p>{context.profile.inheritanceNote}</p>
        ) : null}
        {context.profile.methodSelectionRequired ? (
          <p>
            Choose the applicable method profile for the derived result; this
            does not include every method profile.
          </p>
        ) : null}
        <a
          className="w-fit underline underline-offset-4"
          href={`${context.release.sourceUrl}#${context.profile.sourceAnchor}`}
          target="_blank"
          rel="noreferrer"
        >
          Read the source profile
        </a>
      </div>
    </details>
  )
}

export function SourceBaseline({
  baseline,
  sourceRelease,
  sourceOccurrence
}: Pick<Draft, "baseline" | "sourceRelease" | "sourceOccurrence">) {
  if (!baseline || !sourceRelease || !sourceOccurrence)
    return (
      <p className="text-sm text-muted-foreground">
        This field has no reference version.
      </p>
    )
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Reference</Badge>
          <Badge variant="secondary">MatCore {sourceRelease.version}</Badge>
        </div>
        <CardTitle>
          <h3>{sourceFieldName(sourceOccurrence)}</h3>
        </CardTitle>
        <CardDescription>{sourceOccurrence.path.join(" / ")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="whitespace-pre-wrap break-words">{baseline.definition}</p>
        <a
          className="w-fit underline underline-offset-4"
          href={sourceOccurrence.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Read the source specification
        </a>
        {sourceOccurrence.warnings.length ? (
          <ul className="flex list-disc flex-col gap-2 pl-5">
            {sourceOccurrence.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        ) : null}
        <details>
          <summary className="cursor-pointer py-1">
            Source text and attribution
          </summary>
          <div className="flex flex-col gap-3 pt-3">
            <p className="whitespace-pre-wrap break-words">
              {sourceOccurrence.rawText}
            </p>
            <p>{sourceRelease.attribution}</p>
            <p className="text-muted-foreground">
              Source key: {sourceOccurrence.sourceKey}
              <br />
              Location: {sourceOccurrence.sourceTableId}, row{" "}
              {sourceOccurrence.sourceRow}
              <br />
              Reuse terms:{" "}
              {sourceRelease.license ||
                "Not established for this source snapshot"}
            </p>
            <p className="break-all text-xs text-muted-foreground">
              SHA-256: {sourceRelease.sha256}
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}

export function FieldHistory({ history }: { history: Draft["history"] }) {
  const actionLabels: Record<string, string> = {
    imported: "Source imported",
    draft_created: "Private draft created",
    draft_updated: "Draft saved",
    published: "Proposal published",
    reviewed: "Review decision recorded",
    commented: "Comment added",
    revised: "Revision draft created",
    import: "Source imported",
    update: "Draft saved",
    create: "Private draft created",
    publish: "Proposal published",
    review: "Review decision recorded"
  }
  return (
    <section
      aria-labelledby="field-history-heading"
      className="flex flex-col gap-4"
    >
      <h3 id="field-history-heading" className="font-semibold">
        History
      </h3>
      {history.length ? (
        <ol className="flex flex-col gap-4">
          {history.map((event) => (
            <li key={event.id} className="border-l-2 pl-4">
              <p className="text-sm font-medium">
                {actionLabels[event.action] ??
                  event.action.replaceAll("_", " ")}
              </p>
              <p className="text-sm text-muted-foreground">
                {event.actorName || `Contributor ${event.actorId}`} ·{" "}
                <time dateTime={event.createdAt}>
                  {formatDateTime(event.createdAt)}
                </time>
              </p>
              {event.detail.reason ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {event.detail.reason}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {event.detail.authority === "site_administrator"
                  ? "MatSci-SAM administrator decision"
                  : event.detail.authority === "source_import"
                    ? "Attributed source import"
                    : "Contributor action"}
                {event.detail.decision
                  ? ` · ${event.detail.decision.replaceAll("_", " ")}`
                  : ""}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          History will appear as this proposal is saved and reviewed.
        </p>
      )}
    </section>
  )
}
