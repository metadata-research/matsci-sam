"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { trpc } from "@/trpc/client"
import type { RouterInput, RouterOutput } from "@/trpc/trpc-helpers"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { termPath } from "@/lib/public-identifiers"
import { termLabelKey } from "@/lib/term-label-key"

type Preview = RouterOutput["importDrafts"]["preview"]
type Input = RouterInput["importDrafts"]["preview"]

/** A preview is deliberately separate from publication: only selected rows become drafts. */
export function ImportDraftPreview({
  preview,
  input,
  ownerId,
  storageKey,
  vocabularyTitle,
  collectionTitle,
  disabled,
  onBusyChange,
  onBack,
  onIgnoreColumns,
  onCreated
}: {
  preview: Preview
  input: Input
  ownerId: number
  storageKey: string
  vocabularyTitle: string
  collectionTitle?: string
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  onBack: () => void
  onIgnoreColumns: (columns: string[]) => Promise<void>
  onCreated: (id: string, count: number) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const operation = useRef(false)
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null)
  const create = trpc.importDrafts.create.useMutation()
  const duplicateGroups = new Set(
    preview.rows.flatMap((row) => (row.duplicateOf ? [row.duplicateOf] : []))
  )
  const available = preview.rows.filter(
    (row) => row.status === "new" && !duplicateGroups.has(row.rowId)
  )
  const remaining = preview.availableDraftSlots
  const blocked = disabled || saving
  const needsColumnDecision = preview.unknownColumns.some(
    (column) => !input.ignoredColumns?.includes(column)
  )

  async function createDrafts() {
    if (operation.current) return
    operation.current = true
    setSaving(true)
    onBusyChange(true)
    setError("")
    const payload = {
      ...input,
      expectedOwnerId: ownerId,
      selectedRowIds: selected,
      name: name.trim() || undefined
    }
    const fingerprint = JSON.stringify(payload)
    try {
      if (!attempt.current) {
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey) || "null")
          if (
            saved?.fingerprint === fingerprint &&
            typeof saved.id === "string"
          )
            attempt.current = saved
        } catch {
          /* In-memory retries work when browser storage is unavailable. */
        }
      }
      if (attempt.current?.fingerprint !== fingerprint)
        attempt.current = { fingerprint, id: crypto.randomUUID() }
      try {
        localStorage.setItem(storageKey, JSON.stringify(attempt.current))
      } catch {
        /* Keep the same request identity for retries in this page. */
      }
      const result = await create.mutateAsync({
        ...payload,
        id: attempt.current.id
      })
      onCreated(result.batch.id, selected.length)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The import could not be saved. Your input is still available."
      )
    } finally {
      operation.current = false
      setSaving(false)
      onBusyChange(false)
    }
  }

  return (
    <section aria-label="Preview imported drafts" className="space-y-5">
      <div className="space-y-1 text-sm">
        <p>
          <strong>Vocabulary:</strong> {vocabularyTitle}
        </p>
        <p>
          <strong>Collection:</strong> {collectionTitle ?? "No collection"}
          {collectionTitle ? " (added when terms are published)" : ""}
        </p>
        <p className="text-muted-foreground">
          Imported terms are saved as private drafts. Review them before
          publishing.
        </p>
      </div>
      <label className="grid gap-2 text-sm font-medium">
        Import name (optional)
        <Input
          value={name}
          maxLength={120}
          disabled={blocked}
          placeholder="For example, electrolyte terminology"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {needsColumnDecision ? (
        <Alert>
          <AlertTitle>Unrecognized columns</AlertTitle>
          <AlertDescription>
            <p>
              These columns are not supported:{" "}
              {preview.unknownColumns.join(", ")}. Rename them to supported
              template columns, or explicitly leave them out. The original input
              will remain in your private import record.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={blocked}
              onClick={() => void onIgnoreColumns(preview.unknownColumns)}
            >
              Leave these columns out
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {preview.errors.length ? (
        <Alert variant="destructive">
          <AlertTitle>Check the import</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {preview.errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            blocked ||
            !available.length ||
            new Set([...selected, ...available.map((row) => row.rowId)]).size >
              remaining
          }
          onClick={() =>
            setSelected((current) => [
              ...new Set([...current, ...available.map((row) => row.rowId)])
            ])
          }
        >
          Select unambiguous new terms
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={blocked || !selected.length}
          onClick={() => setSelected([])}
        >
          Clear selection
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {selected.length} selected · {remaining} draft slots available ·{" "}
          {preview.rows.length - selected.length} rows not imported
        </p>
      </div>
      {available.length > remaining ? (
        <p className="text-sm text-muted-foreground">
          Select up to {remaining} new rows, or publish/delete existing drafts
          to make room. Unselected rows stay in the private import record.
        </p>
      ) : null}
      <ul className="divide-y">
        {preview.rows.map((row) => {
          const checked = selected.includes(row.rowId)
          const group = termLabelKey(row.term)
          const selectable = row.status === "new" || !!row.duplicateOf
          const anotherVersionSelected = preview.rows.some(
            (item) =>
              item.rowId !== row.rowId &&
              termLabelKey(item.term) === group &&
              selected.includes(item.rowId)
          )
          return (
            <li key={row.rowId} className="space-y-2 py-4">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={checked}
                  disabled={
                    blocked ||
                    !selectable ||
                    anotherVersionSelected ||
                    (!checked && selected.length >= remaining)
                  }
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, row.rowId]
                        : current.filter((id) => id !== row.rowId)
                    )
                  }
                />
                <span className="min-w-0 space-y-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-words">
                      {row.term || `Record ${row.record}`}
                    </span>
                    <Badge
                      variant={
                        row.status === "error" ? "destructive" : "secondary"
                      }
                    >
                      {row.status === "new"
                        ? "New term"
                        : row.status === "existing"
                          ? "Already exists — skipped"
                          : row.status === "duplicate"
                            ? row.duplicateOf
                              ? "Duplicate — choose one version"
                              : "Duplicate — not imported"
                            : "Needs attention"}
                    </Badge>
                  </span>
                  <span className="block whitespace-pre-wrap break-words text-sm">
                    {row.definition || "Definition can be completed later."}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {row.message}
                    {anotherVersionSelected
                      ? " Deselect the other version to choose this one."
                      : duplicateGroups.has(row.rowId)
                        ? " Another input row has this label. Select the version you want."
                        : ""}
                  </span>
                </span>
              </label>
              {row.existingTerm ? (
                <Link
                  className="ml-7 text-sm underline"
                  href={termPath(row.existingTerm.slug, input.vocabularySlug)}
                >
                  View existing term
                </Link>
              ) : row.existingDraftId ? (
                <Link
                  className="ml-7 text-sm underline"
                  href={`/add?draftId=${row.existingDraftId}`}
                >
                  Resume existing draft
                </Link>
              ) : null}
            </li>
          )
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error} You can retry this request or check{" "}
          <Link href="/profile/drafts" className="underline">
            My drafts
          </Link>
          .
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={blocked}
          onClick={onBack}
        >
          Edit input
        </Button>
        <Button
          type="button"
          disabled={
            blocked ||
            !selected.length ||
            selected.length > remaining ||
            !!preview.errors.length ||
            needsColumnDecision
          }
          onClick={() => void createDrafts()}
        >
          {saving
            ? "Saving private drafts…"
            : `Create ${selected.length || ""} private drafts`}
        </Button>
      </div>
    </section>
  )
}
