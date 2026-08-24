import { EditDefinitionDialog } from "@/components/definition/edit-dialog"
import { DefinitionExamples } from "@/components/definition/examples"
import { DefinitionContributionActions } from "@/components/definition/contribution-actions"
import { EditTags } from "@/components/tags/selector"
import { TermTags, TermTagsFallback } from "@/components/tags/tags"
import { TermCommentBox } from "@/components/term/comment-box"
import { TermComments } from "@/components/term/comments"
import { TermVotes } from "@/components/term/votes"
import { HydrateClient, trpc } from "@/trpc/server"
import { formatDate } from "@/lib/date"
import { aiRevisionSources, revisionSourceLabels } from "@/lib/revision-sources"
import {
  ArrowLeftIcon,
  HistoryIcon,
  ReplaceIcon,
  SparklesIcon,
  UserIcon
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Eyebrow, StatusChip } from "@/components/definition"
import Link from "next/link"
import { Suspense } from "react"
import { DeleteDefinitionButton } from "@/app/definition/[definitionId]/delete-button"
import { getSession } from "@/lib/session"
import { db, User, usersTable } from "@/drizzle"
import { eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { RestoreRevisionButton } from "@/components/definition/restore-revision-button"
import { PublicProfileName } from "@/components/public-profile-name"
import {
  definitionPath,
  definitionUri,
  revisionPath,
  revisionUri
} from "@/lib/public-identifiers"

export async function DefinitionDetailPage({
  definitionId,
  version
}: {
  definitionId: number
  version?: number
}) {
  const sesh = await getSession()
  const [definition] = await Promise.all([
    trpc.definitions.get({ definitionId, version }),
    trpc.comments.get.prefetch(definitionId),
    trpc.examples.list.prefetch({ definitionId }),
    trpc.tags.get.prefetch({ definitionId })
  ])
  if (!definition) notFound()

  const stableDefinitionPath = definitionPath(
    definition.termSlug,
    definition.definitionNumber
  )
  const displayedResourceUri =
    version === undefined
      ? definitionUri(definition.termSlug, definition.definitionNumber)
      : revisionUri(
          definition.termSlug,
          definition.definitionNumber,
          definition.version
        )

  await trpc.votes.get.prefetch({
    definitionId: definition.id,
    revisionId: definition.revisionId
  })

  let user: User | undefined = undefined
  if (sesh.id)
    user = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, sesh.id)
    })

  return (
    <HydrateClient>
      <main className="px-4 py-8 sm:py-10">
        <div className="mx-auto w-full max-w-4xl space-y-8">
          <Link
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
            href={`/vocabulary/${definition.termSlug}`}
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            Other definitions for {definition.term}
          </Link>

          {!definition.isCurrentRevision && (
            <aside className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
              <span>
                You are viewing revision {definition.version} of Definition{" "}
                {definition.definitionNumber}. Its current revision is{" "}
                {definition.currentVersion}.
              </span>
              <Button asChild size="sm" variant="outline">
                <Link href={stableDefinitionPath}>View current revision</Link>
              </Button>
            </aside>
          )}

          <Card className="flex-row gap-4 p-4 sm:gap-6 sm:p-6">
            <TermVotes
              initial={{ score: definition.score, vote: definition.vote }}
              definitionId={definition.id}
              revisionId={definition.revisionId}
              readOnly={!definition.isCurrentRevision}
            />
            <article className="min-w-0 flex-1">
              <header className="flex items-start justify-between gap-4 border-b pb-5">
                <div className="min-w-0 space-y-1">
                  <Eyebrow>Definition {definition.definitionNumber}</Eyebrow>
                  <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight">
                    {definition.term}
                  </h1>
                  <code className="block break-all text-xs font-normal text-muted-foreground">
                    {displayedResourceUri}
                  </code>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {definition.authorId === sesh.id &&
                    definition.isCurrentRevision && (
                      <EditDefinitionDialog
                        defaultValues={{
                          definition: definition.definition
                        }}
                        definitionId={definition.id}
                        expectedRevisionId={definition.revisionId}
                      />
                    )}
                  {user?.role === "admin" && (
                    <DeleteDefinitionButton
                      id={definition.id}
                      term={definition.term}
                    />
                  )}
                </div>
              </header>

              <div className="space-y-6 py-6">
                <section aria-labelledby="definition-heading">
                  <div id="definition-heading">
                    <Eyebrow>Definition</Eyebrow>
                  </div>
                  <p className="mt-1.5 text-lg leading-8">
                    {definition.definition}
                  </p>
                </section>

                <Suspense
                  fallback={
                    <p
                      className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
                      role="status"
                    >
                      Loading examples…
                    </p>
                  }
                >
                  <DefinitionExamples
                    definitionId={definition.id}
                    sourceRevisionId={
                      definition.currentRevisionId ?? definition.revisionId
                    }
                  />
                </Suspense>

                <section aria-labelledby="tags-heading">
                  <div className="flex items-center gap-1">
                    <div id="tags-heading">
                      <Eyebrow>Tags</Eyebrow>
                    </div>
                    {definition.authorId === sesh.id && (
                      <EditTags definitionId={definition.id} />
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Suspense fallback={<TermTagsFallback />}>
                      <TermTags definitionId={definition.id} />
                    </Suspense>
                  </div>
                </section>
              </div>

              <footer className="border-t pt-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                  {definition.author.isAi ? (
                    // A model appears by name, as an author. "MatBot" says it
                    // is a machine and the tag beside it says which one, so
                    // there is no separate "AI generated" label.
                    <span className="flex items-center gap-1 text-ai">
                      <SparklesIcon className="size-3.5" aria-hidden />
                      <PublicProfileName
                        user={definition.author}
                        fallback="AI"
                      />
                      {definition.model && (
                        <>
                          <span aria-hidden className="text-ai/50">
                            &middot;
                          </span>
                          <span className="font-mono">{definition.model}</span>
                        </>
                      )}
                    </span>
                  ) : (
                    // Co-attribution: the human author plus the model whose
                    // accepted suggestion produced this text
                    <span className="flex items-center gap-1">
                      <UserIcon className="size-3.5" aria-hidden />
                      <PublicProfileName user={definition.author} />
                      {definition.coauthors.map((coauthor) => (
                        <span
                          key={coauthor.id}
                          className="flex items-center gap-1"
                        >
                          and
                          {coauthor.isAi && (
                            <SparklesIcon
                              className="size-3.5 text-ai"
                              aria-hidden
                            />
                          )}
                          <span
                            className={coauthor.isAi ? "text-ai font-mono" : ""}
                          >
                            {coauthor.name}
                          </span>
                        </span>
                      ))}
                    </span>
                  )}
                  <span>Added {formatDate(definition.createdAt)}</span>
                  <Badge variant="outline">
                    Definition {definition.definitionNumber} · revision{" "}
                    {definition.version}
                    {definition.isCurrentRevision ? " · current" : ""}
                  </Badge>
                  <StatusChip score={definition.score} />
                  <span>
                    Published {formatDate(definition.revisionCreatedAt)}
                  </span>
                  {definition.refinedFromId && (
                    <Badge className="border-ai/30 bg-ai/15 text-ai">
                      {definition.model
                        ? `AI-assisted revision · ${definition.model}`
                        : "Suggested revision"}
                    </Badge>
                  )}
                  {definition.replacesDefinitionId && (
                    <Badge variant="outline">Replacement proposal</Badge>
                  )}
                </div>

                {(definition.refinedFromDefinitionNumber ||
                  definition.refinedVersionDefinitionNumber ||
                  definition.replacesDefinitionNumber ||
                  definition.replacementDefinitionNumbers.length > 0) && (
                  <nav
                    aria-label="Definition lineage"
                    className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-4 text-sm"
                  >
                    {definition.refinedFromDefinitionNumber && (
                      <Link
                        className="flex items-center gap-1.5 text-primary hover:underline"
                        href={definitionPath(
                          definition.termSlug,
                          definition.refinedFromDefinitionNumber
                        )}
                      >
                        <ArrowLeftIcon className="size-3.5" aria-hidden />
                        See the original definition
                      </Link>
                    )}
                    {definition.refinedVersionDefinitionNumber && (
                      <Link
                        className="flex items-center gap-1.5 text-primary hover:underline"
                        href={definitionPath(
                          definition.termSlug,
                          definition.refinedVersionDefinitionNumber
                        )}
                      >
                        <SparklesIcon
                          className="size-3.5 text-ai"
                          aria-hidden
                        />
                        See the AI-refined definition
                      </Link>
                    )}
                    {definition.replacesDefinitionNumber && (
                      <Link
                        className="flex items-center gap-1.5 text-primary hover:underline"
                        href={definitionPath(
                          definition.termSlug,
                          definition.replacesDefinitionNumber
                        )}
                      >
                        <ReplaceIcon className="size-3.5" aria-hidden />
                        Proposed to replace Definition{" "}
                        {definition.replacesDefinitionNumber}
                      </Link>
                    )}
                    {definition.replacementDefinitionNumbers.map(
                      (definitionNumber) => (
                        <Link
                          key={definitionNumber}
                          className="flex items-center gap-1.5 text-primary hover:underline"
                          href={definitionPath(
                            definition.termSlug,
                            definitionNumber
                          )}
                        >
                          <ReplaceIcon className="size-3.5" aria-hidden />
                          See replacement proposal Definition {definitionNumber}
                        </Link>
                      )
                    )}
                  </nav>
                )}
              </footer>
            </article>
          </Card>

          {definition.isCurrentRevision && (
            <section
              aria-labelledby="definition-actions-heading"
              className="space-y-4 border-t pt-8"
            >
              <header className="space-y-1">
                <h2
                  id="definition-actions-heading"
                  className="text-2xl font-semibold"
                >
                  Propose a change
                </h2>
                <p className="text-sm text-muted-foreground">
                  Suggest a revision to this candidate, or propose a separate
                  replacement for people to compare and vote on.
                </p>
              </header>
              <DefinitionContributionActions
                term={definition.term}
                definitionId={definition.id}
                revisionId={definition.revisionId}
              />
            </section>
          )}

          <section
            aria-labelledby="revision-history-heading"
            className="space-y-4 border-t pt-8"
          >
            <header className="space-y-1">
              <div className="flex items-center gap-2">
                <HistoryIcon className="size-5 text-primary" aria-hidden />
                <h2
                  id="revision-history-heading"
                  className="text-2xl font-semibold"
                >
                  Revision history
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Every published revision keeps its text, editor, change note,
                and community vote tally. Examples have their own contribution
                history above.
              </p>
            </header>
            <ol className="overflow-hidden rounded-xl border bg-card">
              {definition.revisions.map((revision) => {
                const current = revision.id === definition.currentRevisionId
                const selected = revision.id === definition.revisionId

                return (
                  <li
                    key={revision.id}
                    className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between ${
                      selected ? "bg-primary/5" : ""
                    } [&+li]:border-t`}
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={revisionPath(
                            definition.termSlug,
                            definition.definitionNumber,
                            revision.version
                          )}
                          className="font-semibold text-primary hover:underline"
                        >
                          Revision {revision.version}
                        </Link>
                        {current && <Badge variant="secondary">Current</Badge>}
                        {aiRevisionSources.has(revision.source) && (
                          <Badge className="bg-ai/15 text-ai border-ai/30">
                            <SparklesIcon className="size-3" aria-hidden />
                            {revisionSourceLabels[revision.source]}
                            {revision.model && (
                              <span className="font-mono">
                                {revision.model}
                              </span>
                            )}
                          </Badge>
                        )}
                        {revision.legacyIncomplete && (
                          <Badge variant="outline">Partial legacy record</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          score {revision.score}
                        </span>
                      </div>
                      <p className="text-sm">
                        {revision.changeNote ??
                          "No change note was recorded for this legacy revision."}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {revision.editor?.isAi && (
                          <SparklesIcon
                            className="mr-1 inline size-3 text-ai"
                            aria-hidden
                          />
                        )}
                        {revision.editor ? (
                          <PublicProfileName
                            user={revision.editor}
                            className={
                              revision.editor.isAi
                                ? "text-ai font-mono"
                                : undefined
                            }
                            fallback="Editor not recorded"
                          />
                        ) : (
                          "Editor not recorded"
                        )}
                        <span aria-hidden> · </span>
                        {formatDate(revision.createdAt)}
                      </p>
                    </div>
                    {definition.authorId === sesh.id &&
                      !current &&
                      revision.exampleDiff !== null && (
                        <RestoreRevisionButton
                          definitionId={definition.id}
                          revisionId={revision.id}
                          version={revision.version}
                          expectedRevisionId={
                            definition.currentRevisionId ??
                            definition.revisionId
                          }
                          returnHref={stableDefinitionPath}
                        />
                      )}
                  </li>
                )
              })}
            </ol>
          </section>

          <section
            id="discussion"
            aria-labelledby="comments-heading"
            className="space-y-4 border-t pt-8"
          >
            <header className="space-y-1">
              <h2 id="comments-heading" className="text-2xl font-semibold">
                Comments
              </h2>
              <p className="text-sm text-muted-foreground">
                Discuss this definition with the community. A comment records
                what you write without changing the definition.
              </p>
            </header>
            <TermComments
              id={definition.id}
              definitionNumber={definition.definitionNumber}
            />
            <TermCommentBox
              id={definition.id}
              revisionId={definition.revisionId}
            />
          </section>
        </div>
      </main>
    </HydrateClient>
  )
}
