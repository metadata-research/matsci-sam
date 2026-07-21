import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import { trpc } from "@/trpc/server"
import { Card } from "@/components/ui/card"
import { Eyebrow } from "@/components/definition"
import { DiscussionCommentBox } from "./comment-box"
import { formatDate } from "@/lib/date"
import { SparklesIcon } from "lucide-react"
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

              <div className="pt-1">
                <DiscussionCommentBox definitionId={item.def.definitionId} />
              </div>

              <p className="text-xs text-muted-foreground">
                added {formatDate(item.createdAt)}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </main>
  )
}
