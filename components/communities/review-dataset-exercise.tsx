"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { z } from "zod"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Button } from "@/components/ui/button"
import { InfoPopover } from "@/components/info-popover"
import { StandardXmlDownload } from "@/components/metadata-workspace/standard-xml-download"
import {
  MAX_REVIEW_EXERCISE_XML_LENGTH,
  reviewExercisePayloadSchema,
  saveReviewExerciseSchema,
  type ReviewExercisePayload
} from "@/lib/community-review-exercise-types"

type Exercise = RouterOutput["communityReviews"]["exercise"]
type Pending = z.infer<typeof saveReviewExerciseSchema>
type LocalExample = {
  payload: ReviewExercisePayload
  version: number
  pending?: Pending
}
type Register = (
  save: () => Promise<string | null>,
  dirty: () => boolean
) => void
const recoveryPayloadSchema = reviewExercisePayloadSchema.extend({
  datasetTitle: z.string().max(240),
  datasetSource: z.string().max(4000),
  reviewerName: z.string().max(200)
})

export function ReviewDatasetExercise({
  roundId,
  userId,
  register,
  revisionConflict,
  onReloaded
}: {
  roundId: string
  userId: number | null
  register: Register
  revisionConflict: boolean
  onReloaded: () => void
}) {
  const query = trpc.communityReviews.exercise.useQuery(
    { id: roundId },
    { refetchOnWindowFocus: false }
  )
  if (query.isPending) return <p role="status">Loading dataset example…</p>
  if (query.error) return <p role="alert">{query.error.message}</p>
  if (!query.data.config) return null
  return (
    <DatasetEditor
      key={roundId + ":" + userId}
      data={query.data}
      roundId={roundId}
      userId={userId}
      register={register}
      revisionConflict={revisionConflict}
      onReloaded={onReloaded}
    />
  )
}

function DatasetEditor({
  data,
  roundId,
  userId,
  register,
  revisionConflict,
  onReloaded
}: {
  data: Exercise
  roundId: string
  userId: number | null
  register: Register
  revisionConflict: boolean
  onReloaded: () => void
}) {
  const utils = trpc.useUtils()
  const mutation = trpc.communityReviews.saveExercise.useMutation()
  const initial: LocalExample = {
    payload: data.own?.payload ?? {
      datasetTitle: "",
      datasetSource: "",
      completedXml: "",
      notes: "",
      reviewerName: data.defaults.reviewerName,
      reviewerAffiliation: data.defaults.reviewerAffiliation
    },
    version: data.own?.version ?? 0
  }
  const key = `community-review-exercise:${userId}:${roundId}`
  const [recovery] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) return { value: initial, warning: false }
      const parsed = z
        .object({
          payload: recoveryPayloadSchema,
          version: z.number().int().nonnegative(),
          pending: saveReviewExerciseSchema.optional()
        })
        .parse(JSON.parse(raw))
      if (parsed.pending && parsed.pending.roundId !== roundId)
        throw new Error("Wrong review")
      return { value: parsed, warning: false }
    } catch {
      return { value: initial, warning: true }
    }
  })
  const [value, setValue] = useState<LocalExample>(recovery.value)
  const valueRef = useRef(value)
  const saved = useRef(initial)
  const revisionId = useRef(data.own?.revisionId ?? null)
  const [savedValue, setSavedValue] = useState(initial)
  const [open, setOpen] = useState(
    !data.own || JSON.stringify(recovery.value) !== JSON.stringify(initial)
  )
  const [error, setError] = useState("")
  const [conflict, setConflict] = useState(false)
  const [storageWarning, setStorageWarning] = useState(recovery.warning)
  const [xmlStatus, setXmlStatus] = useState(data.own?.xmlStatus ?? "empty")
  const flight = useRef<Promise<string | null> | null>(null)
  const dirty = (current: LocalExample) =>
    Boolean(current.pending) ||
    JSON.stringify(current.payload) !== JSON.stringify(saved.current.payload)
  const isDirty =
    Boolean(value.pending) ||
    JSON.stringify(value.payload) !== JSON.stringify(savedValue.payload)
  function keep(current: LocalExample) {
    valueRef.current = current
    setValue(current)
    try {
      if (dirty(current)) sessionStorage.setItem(key, JSON.stringify(current))
      else sessionStorage.removeItem(key)
    } catch {
      setStorageWarning(true)
    }
  }
  const change = (field: keyof ReviewExercisePayload, text: string) =>
    keep({
      ...valueRef.current,
      payload: { ...valueRef.current.payload, [field]: text }
    })
  async function persist() {
    if (flight.current) return flight.current
    const current = valueRef.current
    if (!dirty(current)) return revisionId.current
    try {
      if (!data.canSave)
        throw new Error(
          "This dataset example cannot be saved. The review may be closed or your access may have changed."
        )
      const checked = saveReviewExerciseSchema.safeParse(
        current.pending ?? {
          roundId,
          payload: current.payload,
          expectedVersion: current.version,
          mutationId: crypto.randomUUID()
        }
      )
      if (!checked.success)
        throw new Error(
          "Add your name, a dataset title and its source before saving."
        )
      const pending = checked.data
      keep({ ...current, pending })
      setError("")
      setConflict(false)
      const request = mutation
        .mutateAsync(pending)
        .then((result) => {
          const latest = { payload: result.payload, version: result.version }
          saved.current = latest
          revisionId.current = result.revisionId
          setSavedValue(latest)
          setXmlStatus(result.xmlStatus)
          keep(latest)
          return result.revisionId
        })
        .catch((cause) => {
          setConflict(cause.data?.code === "CONFLICT")
          // A rejected payload was never committed. Allow correction without losing text.
          if (cause.data?.code === "BAD_REQUEST")
            keep({ ...valueRef.current, pending: undefined })
          throw cause
        })
        .finally(() => {
          flight.current = null
        })
      flight.current = request
      return await request
    } catch (cause) {
      setOpen(true)
      setError(
        cause instanceof Error
          ? cause.message
          : "Your dataset example could not be saved."
      )
      throw cause
    }
  }
  const persistRef = useRef(persist)
  useLayoutEffect(() => {
    persistRef.current = persist
  })
  useEffect(() => {
    register(
      () => persistRef.current(),
      () => dirty(valueRef.current)
    )
    return () =>
      register(
        async () => null,
        () => false
      )
  }, [register])
  async function save(continueToFields = false) {
    try {
      await persist()
      if (continueToFields) {
        setOpen(false)
        document
          .getElementById("review-fields")
          ?.scrollIntoView({ block: "start", behavior: "smooth" })
      }
    } catch {
      /* The editor retains the input and displays the save failure. */
    }
  }
  const config = data.config!
  return (
    <section aria-label="Dataset example" className="rounded-xl border p-4">
      <details
        open={open || revisionConflict}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="min-h-11 cursor-pointer font-semibold">
          Dataset example (optional){savedValue.version ? " · Saved" : ""}
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {data.referenceLabel} · {data.profileLabel}
            </span>
            <InfoPopover label="About the dataset exercise">
              {config.instructions} You can also review fields without a dataset
              example.
            </InfoPopover>
            {config.sourceDocumentUrl && (
              <a
                className="text-sm underline"
                href={config.sourceDocumentUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Review guide
              </a>
            )}
          </div>
          <div className="w-fit">
            <StandardXmlDownload
              vocabularySlug={data.vocabularySlug}
              mode="reference"
              versionLabel={data.referenceLabel ?? config.referenceReleaseId}
              referenceReleaseId={config.referenceReleaseId}
              fingerprint=""
              profile={config.profile}
              sections={[
                {
                  id: config.profile,
                  label: data.profileLabel ?? config.profile
                }
              ]}
            />
          </div>
          <fieldset
            disabled={
              !data.canSave ||
              mutation.isPending ||
              conflict ||
              Boolean(value.pending)
            }
            className="flex flex-col gap-4"
          >
            <label className="flex flex-col gap-2 text-sm">
              Dataset title
              <input
                className="h-10 rounded-md border bg-background px-3"
                maxLength={240}
                value={value.payload.datasetTitle}
                onChange={(event) => change("datasetTitle", event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              Dataset source
              <textarea
                rows={2}
                className="rounded-md border bg-background p-3"
                maxLength={4000}
                placeholder="URL, citation or description of your own dataset"
                value={value.payload.datasetSource}
                onChange={(event) =>
                  change("datasetSource", event.target.value)
                }
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              Completed metadata XML
              <textarea
                rows={6}
                spellCheck={false}
                className="w-full rounded-md border bg-background p-3 font-mono text-sm"
                maxLength={MAX_REVIEW_EXERCISE_XML_LENGTH}
                value={value.payload.completedXml}
                onChange={(event) => change("completedXml", event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              Dataset notes (optional)
              <textarea
                rows={2}
                className="rounded-md border bg-background p-3"
                maxLength={4000}
                value={value.payload.notes}
                onChange={(event) => change("notes", event.target.value)}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                Your name
                <input
                  className="h-10 rounded-md border bg-background px-3"
                  maxLength={200}
                  value={value.payload.reviewerName}
                  onChange={(event) =>
                    change("reviewerName", event.target.value)
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                Affiliation (optional)
                <input
                  className="h-10 rounded-md border bg-background px-3"
                  maxLength={300}
                  value={value.payload.reviewerAffiliation}
                  onChange={(event) =>
                    change("reviewerAffiliation", event.target.value)
                  }
                />
              </label>
            </div>
          </fieldset>
          <p className="text-sm text-muted-foreground">
            Visible to you and the community stewards.
          </p>
          {!data.canSave && (
            <p className="text-sm text-muted-foreground">
              Dataset editing is unavailable. Your saved example remains
              available.
            </p>
          )}
          <p role="status" className="text-sm text-muted-foreground">
            {mutation.isPending
              ? "Saving dataset example…"
              : isDirty
                ? "Unsaved dataset example"
                : savedValue.version
                  ? "Dataset example saved"
                  : "No dataset example saved"}
            {!isDirty &&
              savedValue.version > 0 &&
              (xmlStatus === "template"
                ? ". XML still contains FILL placeholders."
                : xmlStatus === "well_formed"
                  ? ". XML syntax checked, field values not validated."
                  : ". XML not added yet.")}
          </p>
          {storageWarning && (
            <p className="text-sm">
              Browser recovery is unavailable. Save before closing this page.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error} Your text is still here.
            </p>
          )}
          {(conflict || revisionConflict) && (
            <Button
              variant="outline"
              className="w-fit"
              onClick={async () => {
                try {
                  const latest = await utils.communityReviews.exercise.fetch(
                    { id: roundId },
                    { staleTime: 0 }
                  )
                  const next = {
                    payload: latest.own?.payload ?? initial.payload,
                    version: latest.own?.version ?? 0
                  }
                  saved.current = next
                  revisionId.current = latest.own?.revisionId ?? null
                  setSavedValue(next)
                  setXmlStatus(latest.own?.xmlStatus ?? "empty")
                  keep(next)
                  setConflict(false)
                  setError("")
                  onReloaded()
                } catch {
                  setError(
                    "Could not reload the saved dataset example. Try again."
                  )
                }
              }}
            >
              Reload saved dataset example
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            {data.canSave && (
              <Button
                disabled={mutation.isPending || conflict || !isDirty}
                onClick={() => void save()}
              >
                {error && !conflict && value.pending
                  ? "Retry saving dataset example"
                  : "Save dataset example"}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={mutation.isPending || conflict}
              onClick={() => void save(true)}
            >
              Review fields
            </Button>
          </div>
        </div>
      </details>
    </section>
  )
}

export function ReviewDatasetResults({ roundId }: { roundId: string }) {
  const query = trpc.communityReviews.exerciseResults.useQuery({ id: roundId })
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">
        Dataset examples ({query.data?.length ?? 0})
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <Button
          className="w-fit"
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh dataset examples
        </Button>
        {query.error && <p role="alert">{query.error.message}</p>}
        {query.isPending && <p role="status">Loading dataset examples…</p>}
        {query.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No dataset examples yet.
          </p>
        )}
        {query.data?.map((row) => (
          <details key={row.revisionId} className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {row.payload.datasetTitle} · {row.payload.reviewerName}
            </summary>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              {row.payload.reviewerAffiliation && (
                <p>{row.payload.reviewerAffiliation}</p>
              )}
              <p className="whitespace-pre-wrap break-words">
                <strong>Dataset source: </strong>
                {row.payload.datasetSource}
              </p>
              {row.payload.notes && (
                <p className="whitespace-pre-wrap break-words">
                  <strong>Notes: </strong>
                  {row.payload.notes}
                </p>
              )}
              <p className="text-muted-foreground">
                Revision {row.version} ·{" "}
                {new Date(row.updatedAt).toLocaleString()}
              </p>
              <details>
                <summary className="cursor-pointer">Metadata XML</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3">
                  {row.payload.completedXml || "No XML added."}
                </pre>
              </details>
            </div>
          </details>
        ))}
      </div>
    </details>
  )
}
