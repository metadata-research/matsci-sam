"use client"
import Link from "next/link"
import { useState } from "react"
import { trpc } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { InfoPopover } from "@/components/info-popover"
import {
  communityReviewHref,
  type ReviewStyle
} from "@/lib/community-review-types"

export function CommunityReviewSettings({
  communityId,
  slug,
  area: initialArea,
  selectedRound
}: {
  communityId: number
  slug: string
  area?: string
  selectedRound?: string
}) {
  const [area, setArea] = useState(initialArea ?? "")
  const [name, setName] = useState("")
  const [style, setStyle] = useState<ReviewStyle>("assessment")
  const [fields, setFields] = useState(true)
  const [proposals, setProposals] = useState(true)
  const [selected, setSelected] = useState<string[] | null>(null)
  const [search, setSearch] = useState("")
  const [error, setError] = useState("")
  const [roundId, setRoundId] = useState(selectedRound ?? "")
  function selectRound(id: string) {
    setRoundId(id)
    const params = new URLSearchParams({
      view: "settings",
      ...(area ? { profile: area } : {}),
      ...(id ? { round: id } : {})
    })
    window.history.replaceState(
      window.history.state,
      "",
      "/communities/" + slug + "?" + params + "#community-reviews"
    )
  }
  const candidates = trpc.communityReviews.candidates.useQuery({
    communityId,
    area: area || undefined
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
  return (
    <section
      id="community-reviews"
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-xl font-semibold">Reviews</h3>
        <InfoPopover label="About review rounds">
          A round keeps the selected versions and response labels fixed. Create
          another round to review updated content. This does not change existing
          surveys or definition votes.
        </InfoPopover>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault()
          if (create.isPending) return
          setError("")
          try {
            const result = await create.mutateAsync({
              communityId,
              name,
              area: area || undefined,
              style,
              includeFields: fields,
              includeProposals: proposals,
              targetIds: selected ?? undefined
            })
            selectRound(result.id)
            setName("")
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
        {candidates.error && <p role="alert">{candidates.error.message}</p>}
        <details>
          <summary className="cursor-pointer text-sm">
            Choose items ({selected?.length ?? eligible.length})
          </summary>
          <label className="mt-3 flex flex-col gap-2 text-sm">
            Find a field or proposal
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
              onClick={() => setSelected(null)}
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
                  checked={selected === null || selected.includes(row.key)}
                  onChange={(event) => {
                    const current = selected ?? eligible.map((row) => row.key)
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
                  </span>
                </span>
              </label>
            ))}
          </div>
        </details>
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
            selected?.length === 0
          }
        >
          {create.isPending ? "Creating review…" : "Create review"}
        </Button>
      </form>
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
      <Link
        className="underline"
        href={communityReviewHref(slug, id, round.data?.round.area)}
      >
        Open review
      </Link>
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
      <details
        onToggle={(event) => {
          if (event.currentTarget.open) {
            void results.refetch()
            void round.refetch()
          }
        }}
      >
        <summary className="cursor-pointer font-medium">
          Participant responses (
          {results.data?.filter((row) => row.response).length ?? 0})
        </summary>
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
                ?.filter((row) => row.response)
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
                      {
                        round.data?.items
                          .find((item) => item.id === row.itemId)
                          ?.preset.options.find(
                            (option) => option.value === row.response
                          )?.label
                      }
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
