"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useDebounce } from "use-debounce"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { termPath } from "@/lib/public-identifiers"
import { formatDate } from "@/lib/date"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from "@/components/ui/field"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"

type Term = RouterOutput["admin"]["moderation"]["terms"][number]

function VisibilityDialog({ term, close }: { term: Term; close: () => void }) {
  const [reason, setReason] = useState("")
  const utils = trpc.useUtils()
  const router = useRouter()
  const restoring = Boolean(term.hiddenAt)
  const history = trpc.admin.moderation.history.useQuery(term.id)
  const change = trpc.admin.moderation.setVisibility.useMutation({
    onSuccess: async () => {
      await utils.invalidate()
      router.refresh()
      toast.success(
        restoring ? "Term restored to listings" : "Term hidden from listings"
      )
      close()
    },
    onError: async (error) => {
      toast.error(error.message)
      if (error.data?.code === "CONFLICT") {
        await utils.admin.moderation.terms.invalidate()
        router.refresh()
        close()
      }
    }
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !change.isPending) close()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {restoring ? "Restore to listings" : "Hide from listings"}:{" "}
            {term.term}
          </DialogTitle>
          <DialogDescription>
            {restoring
              ? "The term will return to public discovery with its existing identifiers and history."
              : "The term will leave public lists, search and current vocabulary exports. Existing links and historical provenance remain readable."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!reason.trim() || change.isPending) return
            change.mutate({
              termId: term.id,
              hidden: !restoring,
              reason: reason.trim(),
              expectedVersion: term.visibilityVersion
            })
          }}
          className="flex flex-col gap-6"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="visibility-reason">
                {restoring
                  ? "Reason for restoration"
                  : "Public reason for hiding"}
              </FieldLabel>
              <Textarea
                id="visibility-reason"
                required
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={change.isPending}
                aria-describedby="visibility-reason-help"
              />
              <FieldDescription id="visibility-reason-help">
                {restoring
                  ? "Saved in the administrator history."
                  : "Displayed at the term’s existing address. Keep private information out of this reason."}
              </FieldDescription>
            </Field>
          </FieldGroup>
          {history.data?.length ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Visibility history ({history.data.length})
              </summary>
              <ol className="mt-3 flex max-h-40 flex-col gap-3 overflow-y-auto text-sm">
                {history.data.map((event) => (
                  <li key={event.id}>
                    <p>
                      {event.action === "hide" ? "Hidden" : "Restored"} by{" "}
                      {event.actorName || "Administrator"} ·{" "}
                      {formatDate(event.createdAt)}
                    </p>
                    <p className="break-words text-muted-foreground">
                      {event.reason}
                    </p>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                disabled={change.isPending}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!reason.trim() || change.isPending}>
              {change.isPending
                ? "Saving…"
                : restoring
                  ? "Restore to listings"
                  : "Hide from listings"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function VisibilityTable() {
  const [query, setQuery] = useState("")
  const [debouncedQuery] = useDebounce(query, 200)
  const [selected, setSelected] = useState<Term | null>(null)
  const { data, isPending, error } = trpc.admin.moderation.terms.useQuery({
    status: "all",
    ...(debouncedQuery ? { query: debouncedQuery } : {})
  })

  return (
    <section
      className="flex flex-col gap-5"
      aria-label="Term visibility controls"
    >
      <Field className="max-w-md">
        <FieldLabel htmlFor="visibility-search">Find a term</FieldLabel>
        <Input
          id="visibility-search"
          type="search"
          maxLength={200}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search term names"
        />
      </Field>
      {error ? <p role="alert">{error.message}</p> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Term</TableHead>
            <TableHead>Vocabulary</TableHead>
            <TableHead>Visibility</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.map((term) => (
            <TableRow key={term.id}>
              <TableCell>
                <Link
                  href={termPath(term.slug, term.vocabularySlug)}
                  className="font-medium text-primary hover:underline"
                >
                  {term.term}
                </Link>
              </TableCell>
              <TableCell>{term.vocabularyTitle}</TableCell>
              <TableCell>
                <Badge variant={term.hiddenAt ? "outline" : "secondary"}>
                  {term.hiddenAt ? "Hidden" : "Listed"}
                </Badge>
              </TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(term)}
                >
                  {term.hiddenAt ? "Restore" : "Hide"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!data?.length ? (
            <TableRow>
              <TableCell colSpan={4}>
                {isPending ? "Loading terms…" : "No matching terms."}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
      {data?.length === 200 ? (
        <p className="text-sm text-muted-foreground">
          Showing the first 200 matches. Search to narrow the list.
        </p>
      ) : null}
      {selected ? (
        <VisibilityDialog
          key={selected.id}
          term={selected}
          close={() => setSelected(null)}
        />
      ) : null}
    </section>
  )
}
