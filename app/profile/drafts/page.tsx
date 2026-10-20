import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeftIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { authPathWithReturnTo } from "@/lib/auth-return"
import { getCurrentUser } from "@/lib/current-user"
import { SITE_NAME } from "@/lib/site"
import { trpc } from "@/trpc/server"
import { DraftList, type DraftListItem } from "./draft-list"
import { formatDateTime } from "@/lib/date"
import type { RouterOutput } from "@/trpc/trpc-helpers"

export const metadata: Metadata = { title: `My drafts | ${SITE_NAME}` }

export default async function MyDraftsPage() {
  const user = await getCurrentUser()
  if (!user) redirect(authPathWithReturnTo("/login", "/profile/drafts"))

  // Fetch for this request's owner rather than keeping private lists in a
  // shared browser query cache across sign-ins.
  const [draftResult, importResult] = await Promise.allSettled([
    trpc.termDrafts.list(),
    trpc.importDrafts.list()
  ])
  const drafts: DraftListItem[] | null =
    draftResult.status === "fulfilled" ? draftResult.value : null
  const imports: RouterOutput["importDrafts"]["list"] | null =
    importResult.status === "fulfilled" ? importResult.value : null

  return (
    <main className="px-4 py-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href="/profile">
            <ArrowLeftIcon aria-hidden />
            Back to profile
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1 className="text-3xl font-bold">My drafts</h1>
            <p className="text-muted-foreground">
              Private drafts saved to your account. Resume one to review or
              publish it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/setup?task=import">Import terms</Link>
            </Button>
            <Button asChild>
              <Link href="/add">
                <PlusIcon aria-hidden />
                Start a term
              </Link>
            </Button>
          </div>
        </div>
        {imports === null ? (
          <p role="alert" className="text-sm text-destructive">
            Import groups could not be loaded. Your drafts are listed below.
          </p>
        ) : imports.length ? (
          <section aria-label="Imported drafts" className="space-y-4">
            <h2 className="text-xl font-semibold">Imports</h2>
            {imports.map((batch) => (
              <article
                key={batch.id}
                className="space-y-3 rounded-lg border bg-card p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h3 className="break-words font-semibold">{batch.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {batch.counts.needsReview} need review ·{" "}
                      {batch.counts.ready} ready · {batch.counts.published}{" "}
                      published
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <time dateTime={batch.createdAt}>
                        {formatDateTime(batch.createdAt)}
                      </time>
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <Link href={`/profile/drafts/imports/${batch.id}`}>
                      Review import
                    </Link>
                  </Button>
                </div>
                {drafts?.some((draft) => draft.importBatchId === batch.id) ? (
                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground">
                      Resume or delete individual drafts
                    </summary>
                    <DraftList
                      key={`${user.id}:${batch.id}`}
                      drafts={drafts.filter(
                        (draft) => draft.importBatchId === batch.id
                      )}
                    />
                  </details>
                ) : null}
              </article>
            ))}
          </section>
        ) : null}
        {!imports ||
        drafts === null ||
        drafts.some((draft) => !draft.importBatchId) ||
        !imports.length ? (
          <section className="space-y-3">
            {imports?.length ? (
              <h2 className="text-xl font-semibold">Individual drafts</h2>
            ) : null}
            <DraftList
              key={user.id}
              drafts={
                !imports || drafts === null
                  ? drafts
                  : drafts.filter((draft) => !draft.importBatchId)
              }
            />
          </section>
        ) : null}
      </div>
    </main>
  )
}
