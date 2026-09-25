import "server-only"

import { TRPCError } from "@trpc/server"
import Link from "next/link"
import {
  BookOpenIcon,
  HistoryIcon,
  MessageSquareIcon,
  PaperclipIcon,
  SparklesIcon
} from "lucide-react"
import { StatusChip } from "@/components/definition"
import { PublicProfileName } from "@/components/public-profile-name"
import { TermVotes } from "@/components/term/votes"
import { Card } from "@/components/ui/card"
import { formatDate } from "@/lib/date"
import { definitionPath } from "@/lib/public-identifiers"
import { trpc } from "@/trpc/server"
import { ReferenceSnapshot } from "./reference-snapshot"

/** The selected identity remains fixed while its current revision receives votes. */
export async function TermDefaultDefinition({
  definitionId
}: {
  definitionId: number
}) {
  const definition = await trpc.definitions
    .get({ definitionId })
    .catch((error: unknown) => {
      if (error instanceof TRPCError && error.code === "NOT_FOUND") return null
      throw error
    })
  const headingId = `default-definition-${definitionId}`

  if (!definition)
    return (
      <section aria-labelledby={headingId} className="min-w-0 space-y-2">
        <h2 id={headingId} className="font-sans text-xl font-semibold">
          Default definition
        </h2>
        <p role="status" className="text-sm text-muted-foreground">
          This definition is no longer available. Refresh the page to see the
          current definitions.
        </p>
      </section>
    )

  const href = definitionPath(
    definition.termSlug,
    definition.definitionNumber,
    definition.termVocabularySlug
  )
  const linkClass = "text-primary underline underline-offset-4"
  const evidenceLinkClass =
    "inline-flex min-h-9 items-center gap-1.5 rounded-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
  const sourceFileCount = definition.attachments.filter(
    (file) => file.role === "source"
  ).length

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <Card className="min-w-0 gap-5 p-4 sm:p-5">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-5">
            <header className="space-y-2">
              <h2 id={headingId} className="font-sans text-xl font-semibold">
                Default definition
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <Link href={href} className={linkClass}>
                  Definition {definition.definitionNumber} · revision{" "}
                  {definition.version}
                </Link>
                <StatusChip score={definition.score} />
              </div>
            </header>
            <p className="whitespace-pre-wrap text-base leading-7 [overflow-wrap:anywhere] sm:text-lg sm:leading-8">
              {definition.definition}
            </p>
          </div>
          <TermVotes
            definitionId={definition.id}
            revisionId={definition.revisionId}
            initial={{ score: definition.score, vote: definition.vote }}
            readOnly={!definition.isCurrentRevision}
          />
        </div>

        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 [overflow-wrap:anywhere]">
            <span>By</span>
            <PublicProfileName
              user={definition.author}
              className={definition.author.isAi ? "text-ai" : undefined}
            />
            {definition.coauthors
              .filter((coauthor) => coauthor.id !== definition.author.id)
              .map((coauthor) => (
                <span
                  key={coauthor.id}
                  className="inline-flex min-w-0 flex-wrap items-baseline gap-1.5"
                >
                  and
                  <PublicProfileName
                    user={coauthor}
                    className={coauthor.isAi ? "text-ai" : undefined}
                  />
                </span>
              ))}
          </div>
          {definition.model && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-ai">
              <SparklesIcon aria-hidden className="size-3.5 shrink-0" />
              {definition.author.isAi ? "Model:" : "AI assistance:"}{" "}
              <span className="font-mono [overflow-wrap:anywhere]">
                {definition.model}
              </span>
            </p>
          )}
          <p className="text-xs">
            Revision published {formatDate(definition.revisionCreatedAt)}
          </p>
        </div>

        <nav
          aria-label={`Definition ${definition.definitionNumber} sources and review`}
          className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-sm"
        >
          {definition.references.length > 0 ? (
            <a href={`#${headingId}-references`} className={evidenceLinkClass}>
              <BookOpenIcon aria-hidden className="size-4 shrink-0" />
              {definition.references.length} cited{" "}
              {definition.references.length === 1 ? "reference" : "references"}
            </a>
          ) : sourceFileCount === 0 ? (
            <span className="inline-flex min-h-9 items-center gap-1.5 text-muted-foreground">
              <BookOpenIcon aria-hidden className="size-4 shrink-0" />
              No citations attached
            </span>
          ) : null}
          {sourceFileCount > 0 && (
            <Link
              href={`${href}#uploaded-sources`}
              className={evidenceLinkClass}
            >
              <PaperclipIcon aria-hidden className="size-4 shrink-0" />
              {sourceFileCount} source{" "}
              {sourceFileCount === 1 ? "file" : "files"}
            </Link>
          )}
          <Link href={`${href}#discussion`} className={evidenceLinkClass}>
            <MessageSquareIcon aria-hidden className="size-4 shrink-0" />
            Discussion
          </Link>
          <Link
            href={`${href}#revision-history-heading`}
            className={evidenceLinkClass}
          >
            <HistoryIcon aria-hidden className="size-4 shrink-0" />
            Revision history
          </Link>
        </nav>

        {definition.example?.trim() && (
          <section
            aria-labelledby={`${headingId}-example`}
            className="min-w-0 space-y-2 border-t pt-4"
          >
            <h3
              id={`${headingId}-example`}
              className="font-sans text-sm font-semibold"
            >
              Featured example
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">
              {definition.example}
            </p>
          </section>
        )}

        {definition.references.length > 0 && (
          <section
            aria-labelledby={`${headingId}-references`}
            className="min-w-0 space-y-3 border-t pt-4"
          >
            <h3
              id={`${headingId}-references`}
              className="scroll-mt-6 font-sans text-sm font-semibold"
            >
              Cited references
            </h3>
            {definition.references.map((reference) => (
              <ReferenceSnapshot key={reference.id} reference={reference} />
            ))}
          </section>
        )}

        {definition.modelReferences.length > 0 && (
          <details className="min-w-0 space-y-3 border-t pt-4">
            <summary className="cursor-pointer font-sans text-sm font-semibold">
              Sources supplied to the model
            </summary>
            {definition.modelReferences.map((reference) => (
              <ReferenceSnapshot
                key={reference.referenceId}
                reference={reference}
              />
            ))}
          </details>
        )}

        <footer className="border-t pt-4">
          <nav
            aria-label={`Definition ${definition.definitionNumber} details and actions`}
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm"
          >
            <Link href={href} className={linkClass}>
              Open definition
            </Link>
            {definition.isCurrentRevision && (
              <Link
                href={`${href}#definition-actions-heading`}
                className={linkClass}
              >
                Propose a change
              </Link>
            )}
            <Link href={`${href}#examples-heading`} className={linkClass}>
              {definition.example?.trim()
                ? "View all examples"
                : "Examples of use"}
            </Link>
          </nav>
        </footer>
      </Card>
    </section>
  )
}
