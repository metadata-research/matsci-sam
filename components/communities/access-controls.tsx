"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { authPathWithReturnTo } from "@/lib/auth-return"
import { Button } from "@/components/ui/button"

type Access = RouterOutput["communities"]["access"]
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The request could not be saved."

export function RequestCommunityAccess({
  access,
  signedIn
}: {
  access: Access
  signedIn: boolean
}) {
  const router = useRouter()
  const request = trpc.communities.requestAccess.useMutation()
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)
  const path = `/communities/${access.slug}`
  return (
    <section className="flex max-w-xl flex-col items-start gap-3 rounded-lg border p-5">
      <h2 className="text-xl font-semibold">Members only</h2>
      <p className="text-muted-foreground">
        This community’s vocabulary, sources and shared work are available to
        its members. A steward reviews requests to join.
      </p>
      {!signedIn ? (
        <Button asChild>
          <Link href={authPathWithReturnTo("/login", path)}>
            Sign in to request access
          </Link>
        </Button>
      ) : sent || access.requestStatus === "pending" ? (
        <p role="status" className="text-sm">
          Your request is awaiting review. You can check its status here.
        </p>
      ) : access.canRequest ? (
        <>
          {access.requestStatus === "declined" ? (
            <p className="text-sm">Your previous request was declined.</p>
          ) : null}
          <Button
            disabled={request.isPending}
            onClick={async () => {
              setError("")
              try {
                await request.mutateAsync({ communityId: access.id })
                setSent(true)
                router.refresh()
              } catch (failure) {
                setError(message(failure))
              }
            }}
          >
            {request.isPending ? "Sending request…" : "Request access"}
          </Button>
        </>
      ) : (
        <p className="text-sm">
          This community is not accepting access requests.
        </p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}

export function CommunityAccessSettings({ access }: { access: Access }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const update = trpc.communities.setVisibility.useMutation()
  const [visibility, setVisibility] = useState(access.visibility)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  if (!access.canManage) return null
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border p-4"
      aria-labelledby="community-access"
    >
      <h2 id="community-access" className="text-lg font-semibold">
        Content access
      </h2>
      <p className="text-sm text-muted-foreground">
        The community name is public. Choose who can read its vocabulary and
        shared work. Personal drafts are always visible only to their authors.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="community-content-visibility"
            className="text-sm font-medium"
          >
            Who can view content
          </label>
          <select
            id="community-content-visibility"
            value={visibility}
            disabled={update.isPending}
            onChange={(event) => {
              setVisibility(event.target.value as Access["visibility"])
              setSaved(false)
            }}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="public">Public</option>
            <option value="members">Members only</option>
          </select>
        </div>
        <Button
          variant="outline"
          disabled={update.isPending || visibility === access.visibility}
          onClick={async () => {
            setError("")
            setSaved(false)
            try {
              await update.mutateAsync({ communityId: access.id, visibility })
              await utils.invalidate()
              setSaved(true)
              router.refresh()
            } catch (failure) {
              setError(message(failure))
            }
          }}
        >
          {update.isPending ? "Saving…" : "Save content access"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {visibility === "members"
          ? "Members and site administrators can read content. Visitors can request access. Removing a member ends their access without deleting their work."
          : "Anyone can read shared content, including visitors who are not signed in."}
      </p>
      {saved ? (
        <p role="status" className="text-sm">
          Content access saved.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}

export function CommunityAccessRequests({
  communityId
}: {
  communityId: number
}) {
  const router = useRouter()
  const requests = trpc.communities.accessRequests.useQuery({ communityId })
  const review = trpc.communities.reviewAccessRequest.useMutation()
  const [error, setError] = useState("")
  async function decide(id: number, approve: boolean) {
    setError("")
    try {
      await review.mutateAsync({ id, approve })
      await requests.refetch()
      router.refresh()
    } catch (failure) {
      setError(message(failure))
    }
  }
  return (
    <section aria-labelledby="access-requests" className="space-y-3">
      <h2
        id="access-requests"
        tabIndex={-1}
        data-section-target
        className="text-xl font-semibold"
      >
        Access requests
      </h2>
      {requests.isPending ? <p className="text-sm">Loading requests…</p> : null}
      {requests.error ? (
        <p role="alert" className="text-sm text-destructive">
          {requests.error.message}
        </p>
      ) : null}
      {requests.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No requests are awaiting review.
        </p>
      ) : null}
      <ul className="space-y-2">
        {requests.data?.map((request) => (
          <li
            key={request.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
          >
            <span>{request.name?.trim() || `Account ${request.userId}`}</span>
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={review.isPending}
                onClick={() => void decide(request.id, true)}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={review.isPending}
                onClick={() => void decide(request.id, false)}
              >
                Decline
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}
