import { EditDefinitionDialog } from "@/components/definition/edit-dialog"
import { RefinePanel } from "@/components/definition/refine-panel"
import { EditTags } from "@/components/tags/selector"
import { TermTags, TermTagsFallback } from "@/components/tags/tags"
import { TermCommentBox } from "@/components/term/comment-box"
import { TermComments } from "@/components/term/comments"
import { TermVotes } from "@/components/term/votes"
import { HydrateClient, trpc } from "@/trpc/server"
import { formatDate } from "@/lib/date"
import {
  ArrowLeftIcon,
  HistoryIcon,
  SparklesIcon,
  UserIcon
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Eyebrow, StatusChip } from "@/components/definition"
import Link from "next/link"
import { Suspense } from "react"
import { DeleteDefinitionButton } from "./delete-button"
import { getSession } from "@/lib/session"
import { db, User, usersTable } from "@/drizzle"
import { eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { RestoreRevisionButton } from "@/components/definition/restore-revision-button"
import { PublicProfileName } from "@/components/public-profile-name"

export default async function TermPage(props: {
  params: Promise<{ definitionId: string }>
  searchParams: Promise<{ version?: string }>
}) {
  const sesh = await getSession()
  const { definitionId } = await props.params
  const { version: versionParam } = await props.searchParams
  const requestedVersion = versionParam ? Number(versionParam) : undefined
  const version =
    requestedVersion && Number.isInteger(requestedVersion)
      ? requestedVersion
      : undefined

  const id = Number(definitionId)
  trpc.comments.get.prefetch(id)
  trpc.tags.get.prefetch({ definitionId: Number(definitionId) })

  const definition = await trpc.definitions.get({
    definitionId: id,
    version
  })
  if (!definition) notFound()

  trpc.votes.get.prefetch({
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
                You are viewing version {definition.version}. The current
                definition is version {definition.currentVersion}.
              </span>
              <Button asChild size="sm" variant="outline">
                <Link href={`/definition/${definition.id}`}>
                  View current version
                </Link>
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
                  <Eyebrow>Term</Eyebrow>
                  <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight">
                    {definition.term}
                  </h1>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {definition.authorId === sesh.id &&
                    definition.isCurrentRevision && (
                      <EditDefinitionDialog
                        defaultValues={{
                          definition: definition.definition,
                          example: definition.example ?? ""
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

                {definition.example ? (
                  <section aria-labelledby="example-heading">
                    <div id="example-heading">
                      <Eyebrow>Example of use</Eyebrow>
                    </div>
                    <p className="mt-1.5 leading-7 text-muted-foreground">
                      {definition.example}
                    </p>
                  </section>
                ) : (
                  <section aria-labelledby="example-heading">
                    <div id="example-heading">
                      <Eyebrow>Example of use</Eyebrow>
                    </div>
                    <p className="mt-1.5 text-sm italic leading-7 text-muted-foreground">
                      No example was recorded for this imported legacy version.
                    </p>
                  </section>
                )}

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
                    <span className="flex items-center gap-1 text-ai">
                      <SparklesIcon className="size-3.5" aria-hidden />
                      AI
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
                          <span className={coauthor.isAi ? "text-ai" : ""}>
                            {coauthor.name}
                          </span>
                        </span>
                      ))}
                    </span>
                  )}
                  <span>Added {formatDate(definition.createdAt)}</span>
                  <Badge variant="outline">
                    Version {definition.version}
                    {definition.isCurrentRevision ? " · current" : ""}
                  </Badge>
                  <StatusChip score={definition.score} />
                  <span>
                    Published {formatDate(definition.revisionCreatedAt)}
                  </span>
                  {definition.refinedFromId && (
                    <Badge className="ml-auto bg-ai/15 text-ai border-ai/30">
                      Refined
                    </Badge>
                  )}
                </div>

                {(definition.refinedFromId || definition.refinedVersionId) && (
                  <nav
                    aria-label="Definition lineage"
                    className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-4 text-sm"
                  >
                    {definition.refinedFromId && (
                      <Link
                        className="flex items-center gap-1.5 text-primary hover:underline"
                        href={`/definition/${definition.refinedFromId}`}
                      >
                        <ArrowLeftIcon className="size-3.5" aria-hidden />
                        See the original definition
                      </Link>
                    )}
                    {definition.refinedVersionId && (
                      <Link
                        className="flex items-center gap-1.5 text-primary hover:underline"
                        href={`/definition/${definition.refinedVersionId}`}
                      >
                        <SparklesIcon
                          className="size-3.5 text-ai"
                          aria-hidden
                        />
                        See the AI-refined version
                      </Link>
                    )}
                  </nav>
                )}
              </footer>
            </article>
          </Card>

          {definition.authorId === sesh.id &&
            definition.isCurrentRevision &&
            definition.createdVia === "interactive" &&
            !definition.refinedFromId && (
              <RefinePanel
                definitionId={definition.id}
                revisionId={definition.revisionId}
                current={{
                  definition: definition.definition,
                  example: definition.example ?? ""
                }}
              />
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
                  className="font-serif text-2xl font-semibold"
                >
                  Revision history
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Every published version keeps its text, example, editor, change
                note, and community vote tally.
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
                          href={
                            current
                              ? `/definition/${definition.id}`
                              : `/definition/${definition.id}?version=${revision.version}`
                          }
                          className="font-semibold text-primary hover:underline"
                        >
                          Version {revision.version}
                        </Link>
                        {current && <Badge variant="secondary">Current</Badge>}
                        {revision.legacyIncomplete && (
                          <Badge variant="outline">Partial legacy record</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          score {revision.score}
                        </span>
                      </div>
                      <p className="text-sm">
                        {revision.changeNote ??
                          "No change note was recorded for this legacy version."}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {revision.editor ? (
                          <PublicProfileName
                            user={revision.editor}
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
                      revision.example !== null && (
                        <RestoreRevisionButton
                          definitionId={definition.id}
                          revisionId={revision.id}
                          version={revision.version}
                          expectedRevisionId={
                            definition.currentRevisionId ??
                            definition.revisionId
                          }
                        />
                      )}
                  </li>
                )
              })}
            </ol>
          </section>

          <section
            aria-labelledby="comments-heading"
            className="space-y-4 border-t pt-8"
          >
            <header className="space-y-1">
              <h2
                id="comments-heading"
                className="font-serif text-2xl font-semibold"
              >
                Comments
              </h2>
              <p className="text-sm text-muted-foreground">
                Discuss this definition and suggest changes for community
                review.
              </p>
            </header>
            <TermComments id={definition.id} />
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
