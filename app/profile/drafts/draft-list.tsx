"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useRef, useState, useTransition } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { authPathWithReturnTo } from "@/lib/auth-return"
import { formatDateTime } from "@/lib/date"
import { trpc } from "@/trpc/client"
import { withCommunityWorkReturn } from "@/lib/community-work-return"

export type DraftListItem = {
  id: string
  version: number
  term: string
  vocabularySlug: string | null
  vocabularyTitle: string | null
  updatedAt: string
  createdAt: string
  importBatchId?: string | null
}

const draftName = (draft: DraftListItem) => draft.term.trim() || "Untitled term"

export function DraftList({
  drafts,
  returnTo,
  compact = false
}: {
  drafts: DraftListItem[] | null
  returnTo?: string
  compact?: boolean
}) {
  const router = useRouter()
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const [selected, setSelected] = useState<DraftListItem | null>(null)
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [changed, setChanged] = useState(false)
  const [accountUnavailable, setAccountUnavailable] = useState(false)
  const [refreshing, startRefresh] = useTransition()
  const refresh = () => startRefresh(() => router.refresh())
  const deletion = trpc.termDrafts.delete.useMutation({
    onSuccess: (_result, { id }) => {
      setRemovedIds((ids) => [...ids, id])
      setSelected(null)
      setNotice("Draft deleted.")
      refresh()
    },
    onError: (failure, { id }) => {
      if (
        failure.data?.code === "UNAUTHORIZED" ||
        failure.data?.code === "FORBIDDEN"
      ) {
        setSelected(null)
        setAccountUnavailable(true)
        refresh()
      } else if (failure.data?.code === "NOT_FOUND") {
        setRemovedIds((ids) => [...ids, id])
        setSelected(null)
        setNotice(
          "That draft is no longer available. It may have been deleted or published."
        )
        refresh()
      } else if (failure.data?.code === "CONFLICT") {
        setChanged(true)
        setError(
          "This draft changed in another tab. Reload your drafts before deleting it."
        )
      } else {
        setError("Your draft could not be deleted. Try again.")
      }
    }
  })

  if (accountUnavailable)
    return (
      <Alert>
        <AlertTitle>Your account needs to be checked</AlertTitle>
        <AlertDescription>
          <p>Sign in to open the drafts saved to your account.</p>
          <Button asChild variant="outline">
            <Link
              href={authPathWithReturnTo(
                "/login",
                returnTo ?? "/profile/drafts"
              )}
            >
              Sign in
            </Link>
          </Button>
        </AlertDescription>
      </Alert>
    )

  if (drafts === null)
    return (
      <Alert variant="destructive">
        <AlertTitle>Your drafts could not be loaded</AlertTitle>
        <AlertDescription>
          <p>Try loading your saved drafts again.</p>
          <Button variant="outline" disabled={refreshing} onClick={refresh}>
            {refreshing ? "Loading drafts…" : "Try again"}
          </Button>
        </AlertDescription>
      </Alert>
    )

  const visibleDrafts = drafts.filter((draft) => !removedIds.includes(draft.id))

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 id={headingId} ref={heading} tabIndex={-1} className="sr-only">
        Saved term drafts
      </h2>
      <p role="status" className="text-sm text-muted-foreground">
        {notice || (refreshing ? "Updating your drafts…" : "")}
      </p>
      {visibleDrafts.length ? (
        <ul className="space-y-3">
          {visibleDrafts.map((draft) => (
            <li
              key={draft.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4"
            >
              <div className="min-w-0 flex-1 basis-56 space-y-1 break-words">
                <h3 className="font-semibold">{draftName(draft)}</h3>
                <p className="text-sm text-muted-foreground">
                  {draft.vocabularyTitle || draft.vocabularySlug
                    ? `Vocabulary: ${draft.vocabularyTitle || draft.vocabularySlug}`
                    : "Choose a vocabulary when you resume."}
                </p>
                <p className="text-xs text-muted-foreground">
                  Updated{" "}
                  <time dateTime={draft.updatedAt}>
                    {formatDateTime(draft.updatedAt)}
                  </time>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link
                    href={withCommunityWorkReturn(
                      `/add?draftId=${encodeURIComponent(draft.id)}`,
                      returnTo
                    )}
                  >
                    Resume
                    <span className="sr-only"> {draftName(draft)}</span>
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={deletion.isPending || refreshing}
                  onClick={(event) => {
                    deleteTrigger.current = event.currentTarget
                    setError("")
                    setChanged(false)
                    setSelected(draft)
                  }}
                >
                  Delete
                  <span className="sr-only"> {draftName(draft)}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : compact ? (
        <p className="text-sm text-muted-foreground">
          No saved term drafts yet.
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border bg-card p-6">
          <p className="font-medium">No saved drafts yet.</p>
          <p className="text-sm text-muted-foreground">
            Saved drafts appear here until you publish or delete them. Published
            terms are in your{" "}
            <Link
              href="/profile#authored-terms"
              className="text-primary underline underline-offset-4"
            >
              contribution history
            </Link>
            .
          </p>
        </div>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !deletion.isPending) setSelected(null)
        }}
      >
        <DialogContent
          showCloseButton={!deletion.isPending}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            cancelButton.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (deleteTrigger.current?.isConnected)
              deleteTrigger.current.focus()
            else heading.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete draft?</DialogTitle>
            <DialogDescription className="break-words">
              Delete {selected ? `“${draftName(selected)}”` : "this draft"}? You
              will no longer be able to resume it. Communities, vocabularies,
              and collections you created will stay.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              ref={cancelButton}
              variant="outline"
              disabled={deletion.isPending}
              onClick={() => setSelected(null)}
            >
              Cancel
            </Button>
            {changed ? (
              <Button
                onClick={() => {
                  setSelected(null)
                  refresh()
                }}
              >
                Reload drafts
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={deletion.isPending || !selected}
                onClick={() => {
                  if (selected)
                    deletion.mutate({
                      id: selected.id,
                      expectedVersion: selected.version
                    })
                }}
              >
                {deletion.isPending ? "Deleting…" : "Delete draft"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
