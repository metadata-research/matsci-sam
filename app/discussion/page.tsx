import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import { trpc } from "@/trpc/server"
import { Card } from "@/components/ui/card"
import { Eyebrow } from "@/components/definition"
import { DiscussionCommentBox } from "./comment-box"
import { formatDate } from "@/lib/date"
import { ChevronRightIcon, SparklesIcon } from "lucide-react"
import Link from "next/link"

export const metadata: Metadata = {
  title: `Discussion | ${SITE_NAME}`,
  description:
    "Comment on recently added terms without leaving the page. Comments on an AI definition are sent to the model for its next revision."
}

/*
 * Lightweight discussion feed: the most-recent terms, each with the definition
 * a comment attaches to and an inline box, so contributors can weigh in without
 * opening each term page. Comments on an AI definition feed the model a
 * revision (comments.create), which is what the note under each box states.
 */
export default async function DiscussionPage() {
  const items = await trpc.discussion.recent({ limit: 8 })

  return (
    <main className="px-4 py-8">
      <div className="max-w-4xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold font-serif">Discussion</h1>
          <p className="text-muted-foreground">
            Suggest revision sends your comment to the model for a proposed
            rewrite you can review. Comment posts it as-is to this
            definition&apos;s discussion.
          </p>
        </div>

        <div className="space-y-4">
          {items.map((item) => (
            <Card key={item.id} className="p-4 gap-3">
              <div className="flex items-baseline justify-between gap-4">
                <Link
                  href={`/vocabulary/${item.slug}`}
                  className="text-2xl font-semibold font-serif hover:underline"
                >
                  {item.term}
                </Link>
                <Link
                  href={`/vocabulary/${item.slug}`}
                  className="text-sm text-muted-foreground shrink-0 hover:text-primary"
                >
                  {item.def.comments === 1
                    ? "1 comment"
                    : `${item.def.comments} comments`}
                </Link>
              </div>

              <div>
                {item.def.isAi ? (
                  <span className="flex items-center gap-1 text-ai text-xs font-semibold uppercase tracking-[0.12em]">
                    <SparklesIcon className="size-3.5" />
                    AI Definition
                    {item.def.model && (
                      <>
                        <span aria-hidden className="text-ai/50">
                          &middot;
                        </span>
                        <span className="font-mono normal-case tracking-normal">
                          {item.def.model}
                        </span>
                      </>
                    )}
                  </span>
                ) : (
                  <Eyebrow>Definition</Eyebrow>
                )}
                <p className="mt-1">{item.def.definition}</p>
              </div>

              {/* Native <details>: collapsible with no dependency, and it
                  works before hydration. The plain-language counterpart to the
                  provenance graph -- the same events, in order, as prose. */}
              {item.history.length > 1 && (
                <details className="group border-t pt-3">
                  <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5">
                    <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />
                    History
                    <span className="text-xs">
                      ({item.history.length} entries)
                    </span>
                  </summary>

                  <ol className="mt-3 space-y-3 border-l pl-4">
                    {item.history.map((event, i) => (
                      <li key={i} className="space-y-0.5">
                        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                          <span
                            className={
                              event.kind === "comment"
                                ? "font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                                : "font-semibold uppercase tracking-[0.12em] text-primary"
                            }
                          >
                            {event.kind === "comment"
                              ? "Comment"
                              : event.isRefinement
                                ? "Refined definition"
                                : "Definition"}
                          </span>
                          <span className="text-muted-foreground flex items-center gap-1">
                            {event.isAi && (
                              <SparklesIcon className="size-3 text-ai" />
                            )}
                            {event.author ?? "unknown"}
                          </span>
                          <span aria-hidden className="text-muted-foreground/50">
                            &middot;
                          </span>
                          <span className="text-muted-foreground">
                            {formatDate(event.at)}
                          </span>
                        </div>
                        <p
                          className={
                            event.kind === "comment"
                              ? "text-sm text-muted-foreground italic"
                              : "text-sm"
                          }
                        >
                          {event.body}
                        </p>
                      </li>
                    ))}
                  </ol>
                </details>
              )}

              <div className="pt-1">
                <DiscussionCommentBox definitionId={item.def.definitionId} />
              </div>

              {/* Credit line: date, then everyone who has contributed, oldest
                  first. The model appears once however many times it ran. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>added {formatDate(item.createdAt)}</span>
                {item.contributors.map((c) => (
                  <span key={c.name} className="flex items-center gap-1">
                    <span aria-hidden className="text-muted-foreground/50">
                      &middot;
                    </span>
                    {c.isAi && <SparklesIcon className="size-3 text-ai" />}
                    <span className={c.isAi ? "text-ai font-mono" : ""}>
                      {c.name}
                    </span>
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </main>
  )
}
