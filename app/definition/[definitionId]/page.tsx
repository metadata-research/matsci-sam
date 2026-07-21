import { EditDefinitionDialog } from "@/components/definition/edit-dialog"
import { RefinePanel } from "@/components/definition/refine-panel"
import { EditTags } from "@/components/tags/selector"
import { TermTags, TermTagsFallback } from "@/components/tags/tags"
import { TermCommentBox } from "@/components/term/comment-box"
import { TermComments } from "@/components/term/comments"
import { TermVotes } from "@/components/term/votes"
import { HydrateClient, trpc } from "@/trpc/server"
import { formatDate } from "@/lib/date"
import { ArrowLeftIcon, SparklesIcon, UserIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Eyebrow, StatusChip } from "@/components/definition"
import Link from "next/link"
import { Suspense } from "react"
import { DeleteDefinitionButton } from "./delete-button"
import { getSession } from "@/lib/session"
import { db, User, usersTable } from "@/drizzle"
import { eq } from "drizzle-orm"

export default async function TermPage(props: {
  params: Promise<{ definitionId: string }>
}) {
  const sesh = await getSession()
  const { definitionId } = await props.params

  trpc.comments.get.prefetch(Number(definitionId))
  trpc.tags.get.prefetch({ definitionId: Number(definitionId) })
  trpc.votes.get.prefetch({ definitionId: Number(definitionId) })

  const definition = await trpc.definitions.get({
    definitionId: Number(definitionId)
  })

  let user: User | undefined = undefined
  if (sesh.id)
    user = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, sesh.id)
    })

  return (
    <HydrateClient>
      <main className="px-4 py-8">
        <div className="max-w-4xl w-full mx-auto space-y-4">
          <Link
            className="flex items-center gap-1 text-primary text-sm"
            href={`/vocabulary/${definition.termSlug}`}
          >
            <ArrowLeftIcon className="size-4" />
            Other definitions for {definition.term}
          </Link>

          {/* Mirrors the <Definition> card on /terms/[termId]: votes rail,
              flex-1 body with eyebrow-labelled sections, and one metadata row
              closing it out. */}
          <Card className="flex-row p-4 gap-4">
            <TermVotes
              initial={{ score: definition.score, vote: definition.vote }}
              definitionId={definition.id}
            />
            <section className="flex-1 space-y-2">
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-3xl font-bold font-serif leading-tight">
                  {definition.term}
                </h1>
                <div className="flex items-center gap-2 shrink-0">
                  {user?.role === "admin" && (
                    <DeleteDefinitionButton id={definition.id} />
                  )}
                  {definition.authorId === sesh.id && (
                    <EditDefinitionDialog
                      defaultValues={definition}
                      definitionId={definition.id}
                    />
                  )}
                </div>
              </div>

              <div>
                <Eyebrow>Definition</Eyebrow>
                <p>{definition.definition}</p>
              </div>

              <div>
                <Eyebrow>Example</Eyebrow>
                <p className="text-muted-foreground">{definition.example}</p>
              </div>

              <div>
                <div className="flex items-center gap-1">
                  <Eyebrow>Tags</Eyebrow>
                  {definition.authorId === sesh.id && (
                    <EditTags definitionId={definition.id} />
                  )}
                </div>
                <div className="flex items-center gap-0.5 flex-wrap">
                  <Suspense fallback={<TermTagsFallback />}>
                    <TermTags definitionId={definition.id} />
                  </Suspense>
                </div>
              </div>

              <div className="flex items-center gap-x-4 gap-y-2 text-sm text-muted-foreground pt-1 flex-wrap">
                {definition.author.isAi ? (
                  <span className="flex items-center gap-1 text-ai">
                    <SparklesIcon className="size-3.5" />
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
                    <UserIcon className="size-3.5" />
                    {definition.author.name}
                    {definition.coauthors.map((coauthor) => (
                      <span
                        key={coauthor.id}
                        className="flex items-center gap-1"
                      >
                        and
                        {coauthor.isAi && (
                          <SparklesIcon className="size-3.5 text-ai" />
                        )}
                        <span className={coauthor.isAi ? "text-ai" : ""}>
                          {coauthor.name}
                        </span>
                      </span>
                    ))}
                  </span>
                )}
                <span>{formatDate(definition.createdAt)}</span>
                <StatusChip score={definition.score} />
                {definition.updatedAt && (
                  <span>updated {formatDate(definition.updatedAt)}</span>
                )}
                {/* Just "Refined" here, unlike the cards on /terms/[termId]:
                    this page lists coauthors, so the model is already named in
                    the attribution chip above. Same rule either way -- the
                    model appears once per view. */}
                {definition.refinedFromId && (
                  <Badge className="ml-auto bg-ai/15 text-ai border-ai/30">
                    Refined
                  </Badge>
                )}
              </div>

              {(definition.refinedFromId || definition.refinedVersionId) && (
                <div className="flex items-center gap-4 flex-wrap text-sm pt-1">
                  {definition.refinedFromId && (
                    <Link
                      className="text-primary flex items-center gap-1"
                      href={`/definition/${definition.refinedFromId}`}
                    >
                      <ArrowLeftIcon className="size-3.5" />
                      See the original definition
                    </Link>
                  )}
                  {definition.refinedVersionId && (
                    <Link
                      className="text-primary flex items-center gap-1"
                      href={`/definition/${definition.refinedVersionId}`}
                    >
                      <SparklesIcon className="size-3.5 text-ai" />
                      See the AI-refined version
                    </Link>
                  )}
                </div>
              )}
            </section>
          </Card>

          {definition.authorId === sesh.id &&
            definition.createdVia === "interactive" &&
            !definition.refinedFromId && (
              <RefinePanel
                definitionId={definition.id}
                current={{
                  definition: definition.definition,
                  example: definition.example
                }}
              />
            )}

          <section className="space-y-2 pt-2">
            <h2 className="text-2xl font-semibold font-serif">Comments</h2>
            <TermComments id={definition.id} />
            <TermCommentBox id={definition.id} />
          </section>
        </div>
      </main>
    </HydrateClient>
  )
}
