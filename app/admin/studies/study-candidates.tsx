"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { trpc } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { definitionPath } from "@/lib/public-identifiers"
import type { AdminStudyCandidate } from "@/lib/admin-study-queries"
import styles from "../admin.module.css"

const dateLabel = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "UTC",
    timeZoneName: "short"
  })

export function StudyCandidates({
  studyId,
  candidates
}: {
  studyId: number
  candidates: AdminStudyCandidate[]
}) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [selected, setSelected] = useState<AdminStudyCandidate | null>(null)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const mutation = trpc.admin.studies.setCandidateExcluded.useMutation({
    onSuccess: async () => {
      toast.success(
        selected?.exclusionId
          ? "Definition restored to this study"
          : "Definition excluded from this study"
      )
      setSelected(null)
      await utils.definitions.list.invalidate()
      router.refresh()
    },
    onError: (failure) => setError(failure.message)
  })
  const excludedCount = candidates.filter(
    (candidate) => candidate.exclusionId !== null
  ).length

  return (
    <section className={styles.panel} aria-labelledby="study-candidates-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="study-candidates-title" className={styles.panelTitle}>
            Definitions in this study
          </h2>
          <p className={styles.studyPanelDescription}>
            Excluded definitions are omitted from Position and Review. Earlier
            contributions remain in the study record. You can restore a
            definition at any time.
          </p>
        </div>
        <Badge variant="secondary">
          {candidates.length - excludedCount} included · {excludedCount}{" "}
          excluded
        </Badge>
      </div>
      <div className={styles.studyPanelBody}>
        {candidates.length === 0 ? (
          <p>Generate the study steps to review its definitions.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {candidates.map((candidate) => (
              <details key={candidate.id} className="rounded-md border p-4">
                <summary className="cursor-pointer">
                  {candidate.term} · Definition {candidate.definitionNumber}
                  {candidate.exclusionId !== null && (
                    <Badge variant="outline" className="ml-2">
                      Excluded
                    </Badge>
                  )}
                </summary>
                <div className="mt-4 flex flex-col gap-3">
                  <p>{candidate.definition}</p>
                  <p className="text-sm text-muted-foreground">
                    Definition by {candidate.author ?? "Unnamed contributor"}
                  </p>
                  {candidate.example && (
                    <p className="text-sm">Example: {candidate.example}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelected(candidate)
                        setReason("")
                        setError(null)
                      }}
                    >
                      {candidate.exclusionId !== null
                        ? "Restore to this study"
                        : "Exclude from this study"}
                    </Button>
                    <Button asChild variant="link" size="sm">
                      <Link
                        href={definitionPath(
                          candidate.termSlug,
                          candidate.definitionNumber,
                          candidate.vocabularySlug
                        )}
                      >
                        View definition and history
                      </Link>
                    </Button>
                  </div>
                  {candidate.history.length > 0 && (
                    <div className="flex flex-col gap-3 text-sm">
                      <h3 className="font-medium">Exclusion history</h3>
                      {candidate.history.map((entry) => (
                        <div key={entry.id} className="flex flex-col gap-1">
                          <p>
                            Excluded by{" "}
                            {entry.excludedBy ?? "Unnamed administrator"} on{" "}
                            {dateLabel(entry.excludedAt)}.
                          </p>
                          <p>{entry.reason}</p>
                          {entry.restoredAt && (
                            <>
                              <p>
                                Restored by{" "}
                                {entry.restoredBy ?? "Unnamed administrator"} on{" "}
                                {dateLabel(entry.restoredAt)}.
                              </p>
                              <p>{entry.restorationReason}</p>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setSelected(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected?.exclusionId
                ? "Restore to this study"
                : "Exclude from this study"}
            </DialogTitle>
            <DialogDescription>
              {selected?.term} · Definition {selected?.definitionNumber}.{" "}
              {selected?.exclusionId
                ? "This definition will be available in Position and Review again."
                : "The definition and its history remain in the vocabulary and other studies."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!selected) return
              setError(null)
              mutation.mutate({
                studyId,
                definitionId: selected.id,
                excluded: selected.exclusionId === null,
                expectedExclusionId: selected.exclusionId,
                reason
              })
            }}
          >
            <FieldGroup>
              <Field
                data-invalid={Boolean(error)}
                data-disabled={mutation.isPending}
              >
                <FieldLabel htmlFor="study-exclusion-reason">Reason</FieldLabel>
                <Textarea
                  id="study-exclusion-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={1000}
                  required
                  disabled={mutation.isPending}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "study-exclusion-error" : undefined}
                />
                {error && (
                  <FieldError id="study-exclusion-error">{error}</FieldError>
                )}
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setSelected(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!reason.trim() || mutation.isPending}
              >
                {mutation.isPending
                  ? "Saving…"
                  : selected?.exclusionId
                    ? "Restore definition"
                    : "Exclude definition"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
