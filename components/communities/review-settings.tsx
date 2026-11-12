"use client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { trpc } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { InfoPopover } from "@/components/info-popover"
import { ReviewDatasetResults } from "./review-dataset-exercise"
import { ReviewPacketButton } from "./review-packet"
import {
  communityReviewHref,
  matchesReviewTarget,
  reviewTargetKey,
  type ReviewStyle
} from "@/lib/community-review-types"

export function CommunityReviewSettings({
  communityId,
  slug,
  area: initialArea,
  selectedRound,
  initialTargetIds,
  initialName,
  initialReferenceReleaseId,
  view = "review"
}: {
  communityId: number
  slug: string
  area?: string
  selectedRound?: string
  initialTargetIds?: string[]
  initialName?: string
  initialReferenceReleaseId?: string
  view?: "review" | "settings"
}) {
  const router = useRouter()
  const [area, setArea] = useState(initialArea ?? "")
  const [name, setName] = useState(initialName ?? "")
  const [style, setStyle] = useState<ReviewStyle>("assessment")
  const [fields, setFields] = useState(true)
  const [proposals, setProposals] = useState(true)
  const [referenceReleaseId, setReferenceReleaseId] = useState(
    initialReferenceReleaseId ?? ""
  )
  const [datasetExercise, setDatasetExercise] = useState(false)
  const [exerciseInstructions, setExerciseInstructions] = useState(
    "Describe a dataset, complete its metadata XML, then leave feedback on the fields."
  )
  const [exerciseGuide, setExerciseGuide] = useState("")
  const exerciseSetup = trpc.communityReviews.exerciseSetup.useQuery({
    communityId
  })
  const chosenReference = exerciseSetup.data?.releases.find(
    (release) => release.id === referenceReleaseId
  )
  const exerciseReady = !!chosenReference?.profiles.some(
    (profile) => profile.key === area
  )
  const [selected, setSelected] = useState<string[] | null>(
    initialTargetIds ?? null
  )
  const [includeCommunityWide, setIncludeCommunityWide] = useState(
    Boolean(
      initialArea &&
        initialTargetIds?.some((key) => key.startsWith("definition:"))
    )
  )
  const createReceipt = useRef<{
    fingerprint: string
    requestId: string
  } | null>(null)
  const [search, setSearch] = useState("")
  const [error, setError] = useState("")
  const [roundId, setRoundId] = useState(selectedRound ?? "")
  const [showCreate, setShowCreate] = useState(
    !selectedRound || !!initialTargetIds?.length
  )
  function selectRound(id: string) {
    setRoundId(id)
    setShowCreate(!id)
    const params = new URLSearchParams({
      view,
      ...(view === "review" ? { manage: "1" } : {}),
      ...(area ? { profile: area } : {}),
      ...(id ? { round: id } : {})
    })
    router.replace(
      "/communities/" + slug + "?" + params + "#community-reviews",
      { scroll: false }
    )
  }
  const candidates = trpc.communityReviews.candidates.useQuery({
    communityId,
    area: area || undefined,
    referenceReleaseId: referenceReleaseId || undefined,
    includeCommunityWide,
    targetIds: initialTargetIds
  })
  const rounds = trpc.communityReviews.list.useQuery({ communityId })
  const create = trpc.communityReviews.create.useMutation()
  const eligible =
    candidates.data?.candidates.filter((row) =>
      row.kind === "proposal" ? proposals : fields
    ) ?? []
  const matching = eligible.filter((row) =>
    `${row.snapshot.label} ${row.snapshot.path} ${row.snapshot.definition}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase())
  )
  const selectedKeys = eligible
    .filter(
      (row) =>
        selected === null ||
        selected.some((key) => matchesReviewTarget(row.key, key))
    )
    .map((row) => row.key)
  const staleSelection = !!selected?.some(
    (key) => !eligible.some((row) => matchesReviewTarget(row.key, key))
  )
  return (
    <section
      id="community-reviews"
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-xl font-semibold">
          {showCreate ? "Request feedback" : "Review management"}
        </h3>
        <InfoPopover label="About review rounds">
          A round keeps the selected versions and response labels fixed. Create
          another round to review updated content. This does not change existing
          surveys or definition votes.
        </InfoPopover>
      </div>
      {!showCreate && (
        <Button
          className="w-fit"
          variant="outline"
          onClick={() => setShowCreate(true)}
        >
          Request feedback on other items
        </Button>
      )}
      {showCreate && (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (create.isPending) return
            setError("")
            try {
              const input = {
                communityId,
                name,
                area: area || undefined,
                referenceReleaseId: referenceReleaseId || undefined,
                datasetExercise: datasetExercise
                  ? {
                      instructions: exerciseInstructions,
                      sourceDocumentUrl: exerciseGuide.trim() || undefined
                    }
                  : undefined,
                style,
                includeFields: fields,
                includeProposals: proposals,
                includeCommunityWide,
                targetIds: selectedKeys
              }
              const fingerprint = JSON.stringify(input)
              if (createReceipt.current?.fingerprint !== fingerprint)
                createReceipt.current = {
                  fingerprint,
                  requestId: crypto.randomUUID()
                }
              const result = await create.mutateAsync({
                ...input,
                requestId: createReceipt.current.requestId
              })
              selectRound(result.id)
              setName("")
              createReceipt.current = null
              await rounds.refetch()
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Could not create the review."
              )
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              Review name
              <input
                required
                maxLength={120}
                className="h-10 rounded-md border bg-background px-3"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Community feedback"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              Area
              <select
                aria-label="Area"
                className="h-10 rounded-md border bg-background px-3"
                value={area}
                onChange={(event) => {
                  setArea(event.target.value)
                  setSelected(null)
                  setSearch("")
                }}
              >
                <option value="">All areas</option>
                {candidates.data?.areas.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!!exerciseSetup.data?.releases.length && (
            <label className="flex max-w-lg flex-col gap-2 text-sm">
              Reference version
              <select
                aria-label="Reference version"
                className="h-10 rounded-md border bg-background px-3"
                value={referenceReleaseId}
                onChange={(event) => {
                  setReferenceReleaseId(event.target.value)
                  setSelected(null)
                  setSearch("")
                }}
              >
                <option value="">Current reference</option>
                {exerciseSetup.data.releases.map((release) => (
                  <option value={release.id} key={release.id}>
                    {release.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex max-w-lg flex-col gap-2 text-sm">
            Response style
            <select
              aria-label="Response style"
              className="h-10 rounded-md border bg-background px-3"
              value={style}
              onChange={(event) => setStyle(event.target.value as ReviewStyle)}
            >
              <option value="assessment">
                Assessment: suitable / needs revision / unable to assess
              </option>
              <option value="up_down">Upvote / Downvote</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={fields}
                onChange={(event) => {
                  setFields(event.target.checked)
                  setSelected(null)
                }}
              />
              Existing fields or definitions
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={proposals}
                onChange={(event) => {
                  setProposals(event.target.checked)
                  setSelected(null)
                }}
              />
              Proposed changes
            </label>
          </div>
          {area && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeCommunityWide}
                onChange={(event) => {
                  setIncludeCommunityWide(event.target.checked)
                  setSelected(null)
                }}
              />
              Include community-wide definitions in this area review
            </label>
          )}
          {candidates.error && <p role="alert">{candidates.error.message}</p>}
          {candidates.data?.truncated && (
            <p role="status" className="text-sm text-muted-foreground">
              Only the first {candidates.data.candidates.length} items fit this
              selection. Choose items below, or narrow the area.
            </p>
          )}
          {staleSelection && !candidates.isFetching && (
            <p role="alert">
              Some selected items are no longer available in this scope. Clear
              the selection and choose the items to review.
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-sm">
              Choose items ({selectedKeys.length})
            </summary>
            <label className="mt-3 flex flex-col gap-2 text-sm">
              Find a term, field or proposal
              <input
                type="search"
                className="h-10 rounded-md border bg-background px-3"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSelected(eligible.map((row) => row.key))}
              >
                Select all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSelected([])}
              >
                Clear selection
              </Button>
            </div>
            <div className="mt-3 max-h-64 overflow-y-auto">
              {matching.length === 0 && (
                <p className="py-3 text-sm text-muted-foreground">
                  No matching items.
                </p>
              )}
              {matching.map((row) => (
                <label
                  key={row.key}
                  className="flex items-start gap-2 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedKeys.includes(row.key)}
                    onChange={(event) => {
                      const current = selectedKeys
                      setSelected(
                        event.target.checked
                          ? [...current, row.key]
                          : current.filter((id) => id !== row.key)
                      )
                    }}
                  />
                  <span>
                    {row.snapshot.label}{" "}
                    <span className="text-muted-foreground">
                      · {row.snapshot.versionLabel} · {row.snapshot.path}
                      {row.kind === "definition" && area
                        ? " · Community-wide"
                        : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </details>
          {!!exerciseSetup.data?.releases.length && (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex items-center gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={datasetExercise}
                    onChange={(event) =>
                      setDatasetExercise(event.target.checked)
                    }
                  />
                  Include a dataset exercise
                </label>
                <InfoPopover label="About dataset exercises">
                  Members can describe a dataset and complete an XML template
                  before reviewing fields. Their examples are visible only to
                  them and community stewards.
                </InfoPopover>
              </div>
              {datasetExercise && (
                <>
                  {!exerciseReady && (
                    <p className="text-sm">
                      Choose a reference version and one of its areas for the
                      XML template.
                    </p>
                  )}
                  <label className="flex flex-col gap-2 text-sm">
                    Exercise guidance
                    <textarea
                      rows={2}
                      maxLength={2000}
                      value={exerciseInstructions}
                      onChange={(event) =>
                        setExerciseInstructions(event.target.value)
                      }
                      className="rounded-md border bg-background p-3"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm">
                    Review guide link (optional)
                    <input
                      type="url"
                      maxLength={2000}
                      value={exerciseGuide}
                      onChange={(event) => setExerciseGuide(event.target.value)}
                      placeholder="https://"
                      className="h-10 rounded-md border bg-background px-3"
                    />
                  </label>
                </>
              )}
            </div>
          )}
          {exerciseSetup.error && (
            <p role="alert">{exerciseSetup.error.message}</p>
          )}
          <p className="text-sm text-muted-foreground">
            Open reviews appear in every member&apos;s My work under Requested
            feedback.
          </p>
          {error && <p role="alert">{error}</p>}
          <Button
            className="w-fit"
            disabled={
              create.isPending ||
              candidates.isFetching ||
              !eligible.length ||
              !selectedKeys.length ||
              staleSelection ||
              (datasetExercise && !exerciseReady) ||
              (!!candidates.data?.truncated && selected === null)
            }
          >
            {create.isPending ? "Creating review…" : "Create review"}
          </Button>
        </form>
      )}
      {rounds.error && <p role="alert">{rounds.error.message}</p>}
      {!!rounds.data?.length && (
        <label className="flex flex-col gap-2 border-t pt-4 text-sm">
          Manage a review
          <select
            aria-label="Manage a review"
            className="h-10 rounded-md border bg-background px-3"
            value={roundId}
            onChange={(event) => selectRound(event.target.value)}
          >
            <option value="">Select a review</option>
            {rounds.data.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
                {row.closedAt ? " · Closed" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {roundId && (
        <ReviewManagement
          key={roundId}
          id={roundId}
          slug={slug}
          onChange={() => void rounds.refetch()}
        />
      )}
    </section>
  )
}

function ReviewManagement({
  id,
  slug,
  onChange
}: {
  id: string
  slug: string
  onChange: () => void
}) {
  const round = trpc.communityReviews.get.useQuery({ id })
  const results = trpc.communityReviews.results.useQuery({ id })
  const invitations = trpc.communityReviews.invitations.useQuery({ id })
  const invite = trpc.communityReviews.invite.useMutation()
  const revoke = trpc.communityReviews.revokeInvitation.useMutation()
  const close = trpc.communityReviews.close.useMutation()
  const [link, setLink] = useState("")
  const [days, setDays] = useState(14)
  const [error, setError] = useState("")
  async function run(action: () => Promise<unknown>) {
    setError("")
    try {
      await action()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not update this review."
      )
    }
  }
  return (
    <div className="flex flex-col gap-4">
      {round.error && <p role="alert">{round.error.message}</p>}
      {invitations.error && <p role="alert">{invitations.error.message}</p>}
      <Link
        className="underline"
        href={communityReviewHref(slug, id, round.data?.round.area)}
      >
        Open review
      </Link>
      {round.data?.canManage && (
        <div className="w-fit">
          <ReviewPacketButton
            communitySlug={slug}
            targets={round.data.items.flatMap((item) => {
              const id =
                item.kind === "reference"
                  ? item.sourceOccurrenceId
                  : item.kind === "proposal"
                    ? item.proposalRevisionId
                    : item.definitionRevisionId
              return id === null ? [] : [reviewTargetKey(item.kind, id)]
            })}
          />
        </div>
      )}
      <details
        id="participant-responses"
        open
        className="scroll-mt-24"
        onToggle={(event) => {
          if (event.currentTarget.open) {
            void results.refetch()
            void round.refetch()
          }
        }}
      >
        <summary className="cursor-pointer font-medium">
          Participant responses (
          {results.data?.filter((row) => row.response || row.comment.trim())
            .length ?? 0}
          )
        </summary>
        <div className="mt-3 flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={results.isFetching}
            onClick={() => {
              void results.refetch()
              void round.refetch()
            }}
          >
            Refresh responses
          </Button>
          {!results.isPending &&
            !results.data?.some((row) => row.response || row.comment.trim()) &&
            !results.error && (
              <p className="text-sm text-muted-foreground">No responses yet.</p>
            )}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {["Entry", "Participant", "Response", "Comment", "Updated"].map(
                  (label) => (
                    <th className="p-2" key={label}>
                      {label}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {results.data
                ?.filter((row) => row.response || row.comment.trim())
                .map((row) => (
                  <tr key={row.itemId + ":" + row.userId} className="border-t">
                    <td className="p-2">
                      {row.label.label}
                      <div className="text-muted-foreground">
                        {row.label.versionLabel}
                      </div>
                    </td>
                    <td className="p-2">
                      {row.name || "Member " + row.userId}
                    </td>
                    <td className="p-2">
                      {round.data?.items
                        .find((item) => item.id === row.itemId)
                        ?.preset.options.find(
                          (option) => option.value === row.response
                        )?.label ?? "Comment only"}
                    </td>
                    <td className="max-w-sm whitespace-pre-wrap break-words p-2">
                      {row.comment}
                    </td>
                    <td className="p-2">
                      {new Date(row.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {results.error && <p role="alert">{results.error.message}</p>}
      </details>
      {round.data?.round.datasetExercise && (
        <ReviewDatasetResults roundId={id} />
      )}
      {!round.data?.round.closedAt && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-2 text-sm">
            Link expires in (days)
            <input
              type="number"
              min={1}
              max={30}
              value={days}
              className="h-10 w-24 rounded-md border bg-background px-3"
              onChange={(event) => setDays(Number(event.target.value))}
            />
          </label>
          <Button
            variant="outline"
            disabled={
              !round.data?.canManage ||
              invite.isPending ||
              !Number.isInteger(days) ||
              days < 1 ||
              days > 30
            }
            onClick={() =>
              void run(async () => {
                const result = await invite.mutateAsync({ roundId: id, days })
                setLink(location.origin + result.href)
                await invitations.refetch()
              })
            }
          >
            Create conference invitation
          </Button>
          <InfoPopover label="About conference invitations">
            Anyone with this link can sign up and choose to join the whole
            community, including its private sections. The link opens this
            review after joining. Revoke it when registration ends.
          </InfoPopover>
        </div>
      )}
      {link && (
        <label className="flex flex-col gap-2 text-sm">
          Invitation link
          <input
            aria-label="Invitation link"
            readOnly
            value={link}
            onFocus={(event) => event.target.select()}
            className="w-full rounded-md border bg-background p-3"
          />
          <span className="text-muted-foreground">
            Copy this link now. It is shown only during this visit.
          </span>
        </label>
      )}
      {invitations.data?.map((row) => (
        <div
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-2 text-sm"
        >
          <span>
            {row.revokedAt
              ? "Revoked"
              : "Expires " + new Date(row.expiresAt).toLocaleDateString()}
          </span>
          {!row.revokedAt && (
            <Button
              size="sm"
              variant="ghost"
              disabled={revoke.isPending}
              onClick={() =>
                void run(async () => {
                  await revoke.mutateAsync({ id: row.id })
                  setLink("")
                  await invitations.refetch()
                })
              }
            >
              Revoke link
            </Button>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}

      {round.data && !round.data.round.closedAt && (
        <Button
          className="w-fit"
          variant="outline"
          disabled={close.isPending}
          onClick={() =>
            void run(async () => {
              await close.mutateAsync({ id })
              await round.refetch()
              onChange()
            })
          }
        >
          Close review
        </Button>
      )}
    </div>
  )
}
