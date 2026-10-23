"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/date"
import { definitionPath, vocabularyPath } from "@/lib/public-identifiers"
import { profileCompletionPath } from "@/lib/auth-return"
import { CONTRIBUTION_LIMITS } from "@/lib/contribution-limits"
import { withCommunityWorkReturn } from "@/lib/community-work-return"

type Import = RouterOutput["importDrafts"]["get"]
type Review = RouterOutput["importDrafts"]["review"]
const readinessLabels = {
  needs_review: "Needs review",
  ready: "Ready",
  published: "Published",
  deleted: "Deleted",
  skipped: "Not imported"
} as const

export function ImportOverview({
  initialData,
  reviewDraftId,
  profileComplete,
  workspaceReturnTo
}: {
  initialData: Import
  reviewDraftId?: string
  profileComplete: boolean
  workspaceReturnTo?: string
}) {
  const router = useRouter()
  const query = trpc.importDrafts.get.useQuery(
    { id: initialData.batch.id },
    { initialData, staleTime: 0 }
  )
  const data = query.data
  const allowance = trpc.importDrafts.allowance.useQuery()
  const [selected, setSelected] = useState<string[]>(
    reviewDraftId &&
      initialData.rows.some(
        (row) => row.draft?.id === reviewDraftId && row.draft.status === "draft"
      )
      ? [reviewDraftId]
      : []
  )
  const [review, setReview] = useState<Review | null>(null)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [localBusy, setLocalBusy] = useState(false)
  const [sourceId, setSourceId] = useState("")
  const [shareTargets, setShareTargets] = useState<string[]>([])
  const operation = useRef(false)
  const reuseAttempt = useRef<{
    fingerprint: string
    targets: { draftId: string; expectedVersion: number; mutationId: string }[]
  } | null>(null)
  const reviewMutation = trpc.importDrafts.review.useMutation()
  const publishMutation = trpc.importDrafts.publish.useMutation()
  const archiveMutation = trpc.importDrafts.archive.useMutation()
  const busy = localBusy || query.isFetching
  const activeRows = data.rows.filter((row) => row.draft?.status === "draft")
  const selectedDrafts = activeRows.flatMap((row) =>
    row.draft && selected.includes(row.draft.id) ? [row.draft] : []
  )
  const donors = data.rows.flatMap((row) =>
    (row.draft?.files ?? [])
      .filter((file) => file.role === "source")
      .map((file) => ({
        ...file,
        draftId: row.draft!.id,
        term: row.term
      }))
  )
  const selectedSource = donors.find((file) => file.id === sourceId)
  const counts = data.rows.reduce(
    (result, row) => {
      result[row.readiness] += 1
      return result
    },
    { needs_review: 0, ready: 0, published: 0, deleted: 0, skipped: 0 }
  )
  const staleReview = !!review?.drafts.some(
    (reviewed) =>
      !activeRows.some(
        (row) =>
          row.draft?.id === reviewed.id &&
          row.draft.version === reviewed.expectedVersion
      )
  )

  async function perform(work: () => Promise<void>) {
    if (operation.current) return
    operation.current = true
    setLocalBusy(true)
    setError("")
    setNotice("")
    try {
      await work()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "This action could not be completed. Your saved drafts remain available."
      )
    } finally {
      operation.current = false
      setLocalBusy(false)
    }
  }

  async function shareSource() {
    if (!selectedSource || !shareTargets.length) return
    const targets = activeRows.flatMap((row) =>
      row.draft && shareTargets.includes(row.draft.id)
        ? [{ draftId: row.draft.id, expectedVersion: row.draft.version }]
        : []
    )
    const fingerprint = JSON.stringify({ sourceId, targets })
    if (reuseAttempt.current?.fingerprint !== fingerprint)
      reuseAttempt.current = {
        fingerprint,
        targets: targets.map((target) => ({
          ...target,
          mutationId: crypto.randomUUID()
        }))
      }
    const response = await fetch(
      `/api/contribution-files/${encodeURIComponent(sourceId)}/reuse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: reuseAttempt.current.targets })
      }
    )
    const result = await response.json()
    if (!response.ok)
      throw new Error(result.error || "The source could not be assigned.")
    setShareTargets([])
    setReview(null)
    await query.refetch()
    setNotice(
      "Source assigned. Open each draft to check its term match, passages and citation choice. No assistant was called."
    )
  }

  return (
    <>
      <header className="space-y-2">
        <h1 className="break-words text-3xl font-semibold">
          {data.batch.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Imported{" "}
          <time dateTime={data.batch.createdAt}>
            {formatDateTime(data.batch.createdAt)}
          </time>
          {" · "}
          <Link
            href={vocabularyPath(data.batch.vocabularySlug)}
            className="underline"
          >
            {data.batch.vocabularySlug}
          </Link>
        </p>
        <p className="max-w-3xl text-muted-foreground">
          Review each term in the existing editor, then select the terms to
          publish. Unpublished drafts and the original spreadsheet stay private.
        </p>
        <p role="status" className="text-sm">
          {counts.needs_review} need review · {counts.ready} ready ·{" "}
          {counts.published} published
          {counts.skipped ? ` · ${counts.skipped} not imported` : ""}
          {counts.deleted ? ` · ${counts.deleted} deleted` : ""}
        </p>
      </header>
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      {error || query.error ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to complete this step</AlertTitle>
          <AlertDescription>
            <p>{error || query.error?.message}</p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void query.refetch()}
            >
              Refresh saved drafts
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {data.batch.archivedAt ? (
        <Alert>
          <AlertDescription>
            This import is archived. Its published records remain available.
          </AlertDescription>
        </Alert>
      ) : null}
      {!profileComplete && activeRows.length ? (
        <Alert>
          <AlertTitle>Add your name before publishing</AlertTitle>
          <AlertDescription>
            <p>
              You can continue editing these private drafts. Add your name when
              you are ready to publish so readers can identify the contributor.
            </p>
            <Link
              className="underline"
              href={profileCompletionPath(
                withCommunityWorkReturn(
                  `/profile/drafts/imports/${data.batch.id}`,
                  workspaceReturnTo
                )
              )}
            >
              Add your name
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <section aria-label="Imported terms" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-lg font-semibold">Terms</h2>
          <span className="text-sm text-muted-foreground">
            {selected.length} selected
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || !selected.length}
            onClick={() => {
              setSelected([])
              setReview(null)
            }}
          >
            Clear selection
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Select up to {CONTRIBUTION_LIMITS.definition.count} drafts for a
          publication review. The contribution allowance over the past{" "}
          {CONTRIBUTION_LIMITS.definition.seconds / 60} minutes is checked
          before anything is published.
          {allowance.data
            ? ` ${allowance.data.remaining} publications are available now.`
            : ""}
        </p>
        <ul className="divide-y rounded-lg border px-4">
          {data.rows.map((row) => {
            const draft = row.draft
            const active = draft?.status === "draft"
            const checked = !!draft && selected.includes(draft.id)
            const publication = draft?.publication
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-start gap-3 py-4"
              >
                {active ? (
                  <input
                    aria-label={`Select ${draft?.payload?.term || row.term}`}
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    disabled={
                      busy ||
                      !active ||
                      !!data.batch.archivedAt ||
                      (!checked &&
                        selected.length >= CONTRIBUTION_LIMITS.definition.count)
                    }
                    onChange={(event) => {
                      if (!draft) return
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, draft.id]
                          : current.filter((id) => id !== draft.id)
                      )
                      setReview(null)
                    }}
                  />
                ) : (
                  <span aria-hidden className="w-3 shrink-0" />
                )}
                <div className="min-w-0 flex-1 basis-60 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <h3 className="break-words font-medium">
                      {draft?.payload?.term || row.term}
                    </h3>
                    <Badge variant="secondary">
                      {readinessLabels[row.readiness]}
                    </Badge>
                  </div>
                  {draft?.payload ? (
                    <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {draft.payload.definition ||
                        "Add a definition before publication."}
                    </p>
                  ) : null}
                </div>
                {active ? (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={withCommunityWorkReturn(
                        `/add?draftId=${draft.id}`,
                        workspaceReturnTo
                      )}
                    >
                      Review term
                    </Link>
                  </Button>
                ) : publication ? (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={definitionPath(
                        publication.term.slug,
                        publication.definition.definitionNumber,
                        publication.term.vocabularySlug
                      )}
                    >
                      View published term
                    </Link>
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
        <Button
          type="button"
          disabled={busy || !selectedDrafts.length || !!data.batch.archivedAt}
          onClick={() =>
            void perform(async () => {
              const result = await reviewMutation.mutateAsync({
                id: data.batch.id,
                drafts: selectedDrafts.map((draft) => ({
                  id: draft.id,
                  expectedVersion: draft.version
                }))
              })
              setReview(result)
              await query.refetch()
            })
          }
        >
          {reviewMutation.isPending
            ? "Checking selected drafts…"
            : "Review selected for publication"}
        </Button>
      </section>
      {review ? (
        <section
          aria-label="Publication review"
          className="space-y-4 rounded-lg border p-4"
        >
          <h2 className="text-lg font-semibold">Review publication</h2>
          <p className="text-sm">
            {review.allowance.remaining} new definitions can be published now.
            {review.allowance.availableAt
              ? ` The allowance next opens at ${formatDateTime(review.allowance.availableAt)}.`
              : ""}
          </p>
          {staleReview ? (
            <p role="alert" className="text-sm text-destructive">
              A selected draft changed. Review the selected drafts again before
              publishing.
            </p>
          ) : null}
          {review.errors.length ? (
            <ul
              role="alert"
              className="list-disc pl-5 text-sm text-destructive"
            >
              {review.errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          ) : null}
          {review.drafts.map((draft) => {
            const row = data.rows.find((row) => row.draft?.id === draft.id)
            return (
              <article key={draft.id} className="space-y-3 border-t pt-4">
                <h3 className="font-semibold">{draft.term}</h3>
                <p className="text-sm font-medium">Current definition</p>
                <p className="whitespace-pre-wrap rounded-md border bg-definition p-3 text-sm">
                  {draft.definition}
                </p>
                <p className="text-sm">
                  {draft.importEvidence?.publishOriginalWording
                    ? "Original wording will be included in public provenance."
                    : "Original wording will be omitted from public provenance."}
                </p>
                {row?.original ? (
                  <details className="rounded-md border p-3 text-sm">
                    <summary className="cursor-pointer font-medium">
                      Original imported wording
                    </summary>
                    <div className="mt-3 space-y-2">
                      <p className="text-muted-foreground">
                        {draft.importEvidence?.publishOriginalWording
                          ? "You chose to make this original wording public in provenance, including any text you changed in the editor."
                          : "This comparison is private. The original wording will not appear in public provenance."}
                      </p>
                      <p className="break-words">
                        <strong>Original term:</strong> {row.original.term}
                      </p>
                      <p className="font-medium">Original definition</p>
                      <p className="whitespace-pre-wrap break-words">
                        {row.original.definition ||
                          "No definition was supplied."}
                      </p>
                    </div>
                  </details>
                ) : null}
                {draft.initialExample ? (
                  <p className="whitespace-pre-wrap text-sm">
                    <strong>Example:</strong> {draft.initialExample}
                  </p>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  Vocabulary: {draft.vocabularySlug}
                  {draft.collectionId
                    ? ` · Collection ${draft.collectionId}`
                    : ""}
                </p>
                <PublicationEvidence draft={draft} saved={row?.draft ?? null} />
              </article>
            )
          })}
          <p className="text-sm text-muted-foreground">
            Publishing makes the selected definitions, included evidence and
            collection memberships public. Original imported wording stays out
            of public provenance unless you explicitly include it in the editor.
            Readers can open each complete attached file or pasted note, not
            only its selected passages. All selected drafts publish together; an
            error leaves them saved.
          </p>
          <Button
            type="button"
            disabled={
              busy || !review.canPublish || !review.reviewToken || staleReview
            }
            onClick={() =>
              void perform(async () => {
                if (!review.reviewToken) return
                const result = await publishMutation.mutateAsync({
                  id: data.batch.id,
                  reviewToken: review.reviewToken
                })
                setReview(null)
                setSelected([])
                await Promise.all([query.refetch(), allowance.refetch()])
                setNotice(
                  `${result.publications.length} terms published. Remaining drafts are still private.`
                )
              })
            }
          >
            {publishMutation.isPending
              ? "Publishing…"
              : `Publish ${review.drafts.length} selected terms`}
          </Button>
        </section>
      ) : null}
      {activeRows.length > 0 && data.rows.length > 1 ? (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-medium">
            Share a source between drafts
          </summary>
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              First upload or paste a source in any draft. Reuse it here without
              uploading it again. Each term keeps its own match, selected
              passages and citation choice. Assignment does not cite the source
              or send it to an assistant.
            </p>
            {donors.length ? (
              <>
                <label className="grid gap-2 text-sm font-medium">
                  Source
                  <select
                    aria-label="Source"
                    className="h-10 rounded-md border bg-background px-3 font-normal"
                    value={sourceId}
                    disabled={busy}
                    onChange={(event) => {
                      setSourceId(event.target.value)
                      setShareTargets([])
                    }}
                  >
                    <option value="">Choose a source</option>
                    {donors.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.title} — {source.term}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedSource ? (
                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-sm font-medium">
                      Assign to drafts
                    </legend>
                    {activeRows
                      .filter((row) => row.draft!.id !== selectedSource.draftId)
                      .map((row) => (
                        <label
                          key={row.draft!.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={shareTargets.includes(row.draft!.id)}
                            disabled={busy}
                            onChange={(event) =>
                              setShareTargets((current) =>
                                event.target.checked
                                  ? [...current, row.draft!.id]
                                  : current.filter((id) => id !== row.draft!.id)
                              )
                            }
                          />
                          {row.draft!.payload!.term}
                        </label>
                      ))}
                  </fieldset>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !sourceId || !shareTargets.length}
                  onClick={() => void perform(shareSource)}
                >
                  Assign source to selected drafts
                </Button>
              </>
            ) : (
              <p className="text-sm">
                No source has been attached to these drafts yet.
              </p>
            )}
          </div>
        </details>
      ) : null}
      {!data.batch.archivedAt && !activeRows.length ? (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              await archiveMutation.mutateAsync({ id: data.batch.id })
              router.push("/profile/drafts")
              router.refresh()
            })
          }
        >
          Archive completed import
        </Button>
      ) : null}
    </>
  )
}

function PublicationEvidence({
  draft,
  saved
}: {
  draft: Review["drafts"][number]
  saved: Import["rows"][number]["draft"]
}) {
  const evidence = draft.importEvidence
  const assistant = saved?.payload?.editorState?.appliedDraft
  const assistantSources = assistant?.sourceInputs ?? []
  const sourceIds = new Set(draft.publicFiles.map((file) => file.id))
  const citations =
    evidence?.citations.filter((item) => item.decision === "include") ?? []
  const ontology =
    evidence?.ontology.filter((item) => item.decision === "include") ?? []
  const lookupCitations = draft.citedReferenceCount
  const omitted = [
    evidence?.origin,
    evidence?.scopeNote,
    ...(evidence?.citations ?? []),
    ...(evidence?.ontology ?? []),
    ...(evidence?.sourceKeys ?? [])
  ].filter((item) => item?.decision === "omit").length
  return (
    <div className="space-y-3 text-sm">
      <p>
        {sourceIds.size} public attachment{sourceIds.size === 1 ? "" : "s"} ·{" "}
        {citations.length} declared citation{citations.length === 1 ? "" : "s"}{" "}
        · {lookupCitations} lookup citation{lookupCitations === 1 ? "" : "s"} ·{" "}
        {ontology.length} ontology link{ontology.length === 1 ? "" : "s"}
      </p>
      {sourceIds.size ? (
        <ul className="list-disc space-y-1 pl-5">
          {[...sourceIds].map((id) => {
            const file = draft.publicFiles.find((item) => item.id === id)
            const used = draft.assistantSourceFileIds.includes(id)
            const cited = draft.files.some(
              (item) => item.fileId === id && item.publish
            )
            return (
              <li key={id}>
                {file?.title ??
                  assistantSources.find((item) => item.fileId === id)?.title ??
                  "Attached source"}{" "}
                —{" "}
                {cited ? "cited by contributor" : "included as model evidence"}
                {used ? "; used by assistant" : ""}
              </li>
            )
          })}
        </ul>
      ) : null}
      {assistant ? (
        <p>
          AI assistance:{" "}
          {assistant.assistantLabel ?? assistant.model ?? "Recorded assistant"};{" "}
          {assistantSources.length} source input
          {assistantSources.length === 1 ? "" : "s"} recorded.
        </p>
      ) : (
        <p>No model draft is applied.</p>
      )}
      {evidence?.origin?.decision === "include" ? (
        <p>
          Declared origin: {evidence.origin.title || evidence.origin.url};
          source credited to{" "}
          {evidence.origin.creator || "creator not specified"}
          {evidence.origin.version
            ? `; version ${evidence.origin.version}`
            : ""}
          {evidence.origin.license
            ? `; licence ${evidence.origin.license}`
            : ""}
          .
        </p>
      ) : null}
      {citations.map((citation) => (
        <p key={citation.id} className="break-words">
          <strong>Citation:</strong> {citation.title || citation.url}
          {citation.creator ? ` — ${citation.creator}` : ""}
          {citation.version ? ` (${citation.version})` : ""}
          {citation.url && citation.title ? `; ${citation.url}` : ""}
        </p>
      ))}
      {ontology.map((concept) => (
        <div key={concept.id} className="space-y-1 break-words">
          <p>
            <strong>Related external concept:</strong>{" "}
            {concept.label || concept.iri}
            {concept.label ? ` — ${concept.iri}` : ""}
          </p>
          <p>
            {concept.ontology}
            {concept.version ? `; ${concept.version}` : ""}
            {concept.sourceUrl ? `; ${concept.sourceUrl}` : ""}
          </p>
          <p>{concept.note}</p>
        </div>
      ))}
      {evidence?.scopeNote?.decision === "include" ? (
        <p>
          <strong>Usage scope:</strong> {evidence.scopeNote.text}
        </p>
      ) : null}
      {ontology.length || evidence?.scopeNote?.decision === "include" ? (
        <p>Metadata will be proposed for curator review.</p>
      ) : null}
      {omitted ? (
        <p className="text-muted-foreground">
          {omitted} imported evidence item{omitted === 1 ? "" : "s"} explicitly
          left out of publication.
        </p>
      ) : null}
    </div>
  )
}
