"use client"

import { useState } from "react"
import { PlusIcon } from "lucide-react"
import {
  matcoreCitationSchema,
  type MatCoreDraftPayload
} from "@/lib/matcore-workflow-types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type Citation = MatCoreDraftPayload["citations"][number]

export function FieldCitations({
  citations,
  hasBaseline = false,
  onChange
}: {
  citations: Citation[]
  hasBaseline?: boolean
  onChange?(citations: Citation[]): void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [source, setSource] = useState<Citation>({
    title: "",
    url: "",
    note: ""
  })
  const [error, setError] = useState("")
  function open(index: number) {
    setEditing(index)
    setSource(citations[index] ?? { title: "", url: "", note: "" })
    setError("")
  }
  return (
    <section
      aria-labelledby="field-citations-heading"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="field-citations-heading" className="font-semibold">
          Supporting citations
        </h3>
        {onChange ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={citations.length >= 30}
            onClick={() => open(citations.length)}
          >
            <PlusIcon data-icon="inline-start" aria-hidden />
            Add citation
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Cite sources that support the definition or proposed field rules.
        {hasBaseline ? " The imported baseline is recorded separately." : ""}
      </p>
      {citations.length ? (
        <ol className="flex flex-col gap-3">
          {citations.map((citation, index) => (
            <li
              key={`${index}:${citation.url}`}
              className="rounded-md border p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <a
                  className="min-w-0 break-words text-sm font-medium underline underline-offset-4"
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {citation.title}
                </a>
                {onChange ? (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => open(index)}
                      aria-label={`Edit citation ${index + 1}`}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        onChange(
                          citations.filter((_, position) => position !== index)
                        )
                      }
                      aria-label={`Remove citation ${index + 1}`}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>
              {citation.note ? (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {citation.note}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          No additional citations yet.
        </p>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing !== null && editing < citations.length
                ? "Edit citation"
                : "Add a citation"}
            </DialogTitle>
            <DialogDescription>
              Record a source address and how it supports the proposal.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const result = matcoreCitationSchema.safeParse(source)
              if (!result.success) {
                setError(
                  result.error.issues[0]?.message ?? "Check the citation."
                )
                return
              }
              if (editing === null || !onChange) return
              const next = [...citations]
              next[editing] = result.data
              onChange(next)
              setEditing(null)
            }}
            className="flex flex-col gap-5"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="citation-title">Source title</FieldLabel>
                <Input
                  id="citation-title"
                  value={source.title}
                  maxLength={500}
                  required
                  onChange={(event) =>
                    setSource({ ...source, title: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="citation-url">Source address</FieldLabel>
                <Input
                  id="citation-url"
                  type="url"
                  value={source.url}
                  maxLength={2000}
                  required
                  placeholder="https://…"
                  onChange={(event) =>
                    setSource({ ...source, url: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="citation-note">
                  How this source supports the proposal
                </FieldLabel>
                <Textarea
                  id="citation-note"
                  value={source.note}
                  maxLength={2000}
                  rows={3}
                  onChange={(event) =>
                    setSource({ ...source, note: event.target.value })
                  }
                />
              </Field>
            </FieldGroup>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button type="submit">Save citation</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
