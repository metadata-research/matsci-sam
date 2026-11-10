"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { ReviewPacketButton } from "./review-packet"
import type { CommunityContribution } from "@/lib/community-contributions"
import { communityContributionActions } from "@/lib/community-actions"
import { proposalStatusLabels } from "@/lib/community-standard-types"
import {
  emptyMatcoreDraftPayload,
  type MatcoreProfileKey
} from "@/lib/matcore-workflow-types"
import { withCommunityContributionReturn } from "@/lib/community-contribution-return"
import { authPathWithReturnTo } from "@/lib/auth-return"
import { trpc } from "@/trpc/client"

export function CommunityContributions({
  slug,
  vocabularySlug,
  rows,
  canManage,
  viewerId,
  metadataEnabled,
  profiles,
  referenceReleaseId,
  hasMore,
  offset
}: {
  slug: string
  vocabularySlug: string
  rows: CommunityContribution[]
  canManage: boolean
  viewerId: number | null
  metadataEnabled: boolean
  profiles: { id: string; label?: string }[]
  referenceReleaseId?: string
  hasMore: boolean
  offset: number
}) {
  const query = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [selected, setSelected] = useState<string[]>([])
  const [label, setLabel] = useState("")
  const [profile, setProfile] = useState(query.get("profile") ?? "")
  const [error, setError] = useState("")
  const requestId = useRef<string | null>(null)
  const create = trpc.matcoreWorkflow.createDraft.useMutation()
  const actions = communityContributionActions({
    communitySlug: slug,
    vocabularySlug,
    metadataEnabled,
    profile: query.get("profile") ?? undefined,
    release: query.get("release") ?? referenceReleaseId
  })
  function href(changes: Record<string, string | null>) {
    const params = new URLSearchParams(query)
    params.set("view", "contributions")
    params.delete("action")
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    return `${pathname}?${params}`
  }
  const returnTo = href({})
  const requestFeedback = new URLSearchParams({ view: "review", manage: "1" })
  if (query.get("profile"))
    requestFeedback.set("profile", query.get("profile")!)
  if (selected.some((target) => target.startsWith("definition:")))
    requestFeedback.set("communityWide", "1")
  for (const target of selected) requestFeedback.append("target", target)
  return (
    <section
      className="flex flex-col gap-4"
      aria-labelledby="contributions-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="contributions-heading" className="text-2xl font-semibold">
          Contributions
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={actions.term.href}>Add term</Link>
          </Button>
          {actions.field ? (
            <Button asChild>
              <Link href={actions.field.href}>Propose field</Link>
            </Button>
          ) : null}
        </div>
      </div>
      <form className="flex flex-wrap items-end gap-3" action={pathname}>
        <input type="hidden" name="view" value="contributions" />
        {["release", "standard", "edition", "layout"].map((name) =>
          query.get(name) ? (
            <input key={name} type="hidden" name={name} value={query.get(name)!} />
          ) : null
        )}
        {query.get("profile") ? (
          <input type="hidden" name="profile" value={query.get("profile")!} />
        ) : null}
        <label className="min-w-44 flex-1 text-sm">
          Find a contribution
          <Input name="q" defaultValue={query.get("q") ?? ""} maxLength={200} />
        </label>
        <label className="text-sm">
          Type
          <select
            name="type"
            defaultValue={
              query.get("type") ??
              (query.get("view") === "proposals" ? "proposal" : "all")
            }
            className="block h-9 rounded-md border bg-background px-2"
          >
            <option value="all">All contributions</option>
            <option value="definition">Term definitions</option>
            {metadataEnabled ? (
              <option value="proposal">Metadata proposals</option>
            ) : null}
          </select>
        </label>
        <label className="text-sm">
          Status
          <select
            name="status"
            defaultValue={query.get("status") ?? "all"}
            className="block h-9 rounded-md border bg-background px-2"
          >
            <option value="all">All statuses</option>
            <option value="published">Published definitions</option>
            {metadataEnabled
              ? Object.entries(proposalStatusLabels).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))
              : null}
          </select>
        </label>
        <Button variant="outline" type="submit">
          Apply filters
        </Button>
      </form>
      {query.get("profile") ? (
        <p className="text-sm text-muted-foreground">
          Metadata proposals for this area and term definitions from the
          community.
        </p>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
          <span className="text-sm">{selected.length} selected</span>
          <Button
            variant="ghost"
            onClick={() => setSelected(rows.map((row) => row.target))}
          >
            Select this page
          </Button>
          <Button
            variant="ghost"
            disabled={!selected.length}
            onClick={() => setSelected([])}
          >
            Clear selection
          </Button>
          {selected.length ? (
            <Button asChild>
              <Link href={`${pathname}?${requestFeedback}`}>
                Request feedback
              </Link>
            </Button>
          ) : (
            <Button disabled>Request feedback</Button>
          )}
          <ReviewPacketButton communitySlug={slug} targets={selected} />
        </div>
      ) : null}
      {rows.length ? (
        <ul className="divide-y rounded-lg border">
          {rows.map((row) => (
            <li key={row.target} className="flex items-start gap-3 p-4">
              {canManage ? (
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  aria-label={`Select ${row.label}, ${row.version}`}
                  checked={selected.includes(row.target)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, row.target]
                        : current.filter((value) => value !== row.target)
                    )
                  }
                />
              ) : null}
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="font-semibold underline underline-offset-4"
                    href={withCommunityContributionReturn(row.href, returnTo)}
                  >
                    {row.label}
                  </Link>
                  <Badge variant="outline">
                    {row.kind === "definition"
                      ? "Term definition"
                      : "Metadata proposal"}
                  </Badge>
                  <Badge variant="secondary">
                    {row.status === "published"
                      ? "Published"
                      : (proposalStatusLabels[row.status] ?? row.status)}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {row.version}
                  {row.author ? ` · ${row.author}` : ""}
                </p>
                {row.description ? (
                  <p className="line-clamp-2 break-words text-sm">
                    {row.description}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border p-5 text-muted-foreground">
          No contributions match these filters.
        </p>
      )}
      <div className="flex gap-3">
        {offset > 0 ? (
          <Button asChild variant="outline">
            <Link href={href({ offset: String(Math.max(0, offset - 50)) })}>
              Previous page
            </Link>
          </Button>
        ) : null}
        {hasMore && offset < 10000 ? (
          <Button asChild variant="outline">
            <Link href={href({ offset: String(offset + 50) })}>Next page</Link>
          </Button>
        ) : null}
      </div>
      {hasMore && offset >= 10000 ? (
        <p className="text-sm text-muted-foreground">
          Refine the search or filters to find more contributions.
        </p>
      ) : null}
      <Dialog
        open={metadataEnabled && query.get("action") === "new"}
        onOpenChange={(open) => {
          if (!open && !create.isPending) router.replace(href({ action: null }))
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Propose a new field</DialogTitle>
            <DialogDescription>
              Your draft stays private until you submit it for review.
            </DialogDescription>
          </DialogHeader>
          {viewerId === null ? (
            <Button asChild>
              <Link
                href={authPathWithReturnTo("/login", `${pathname}?${query}`)}
              >
                Sign in to contribute
              </Link>
            </Button>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (create.isPending) return
                requestId.current ??= crypto.randomUUID()
                const payload = emptyMatcoreDraftPayload()
                payload.label = label.trim()
                payload.specification.path = label
                  .trim()
                  .toLowerCase()
                  .replace(/\s+/g, "-")
                setError("")
                void create
                  .mutateAsync({
                    id: requestId.current,
                    vocabularySlug,
                    expectedOwnerId: viewerId,
                    payload,
                    ...(profile && referenceReleaseId
                      ? {
                          profileKey: profile as MatcoreProfileKey,
                          profileReleaseId: referenceReleaseId
                        }
                      : {})
                  })
                  .then((draft) =>
                    window.location.assign(
                      withCommunityContributionReturn(
                        `/metadata/workspace/${draft.id}`,
                        returnTo
                      )
                    )
                  )
                  .catch((error) =>
                    setError(error.message ?? "Could not create this draft.")
                  )
              }}
            >
              <label className="block text-sm">
                Field name
                <Input
                  autoFocus
                  required
                  maxLength={200}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </label>
              {profiles.length ? (
                <label className="block text-sm">
                  Area
                  <select
                    className="mt-1 block h-9 w-full rounded-md border bg-background px-2"
                    value={profile}
                    onChange={(event) => setProfile(event.target.value)}
                  >
                    <option value="">Community-wide</option>
                    {profiles.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.label ?? area.id}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {error ? (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Opening…" : "Create draft"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
