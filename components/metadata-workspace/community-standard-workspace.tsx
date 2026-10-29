"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { trpc } from "@/trpc/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog"
import { InfoPopover } from "@/components/info-popover"
import { HierarchyOutline } from "@/components/hierarchy-outline"
import { buildHierarchy } from "@/lib/hierarchy"
import {
  emptyMatcoreDraftPayload,
  type MatcoreProfileKey
} from "@/lib/matcore-workflow-types"
import { proposalStatusLabels } from "@/lib/community-standard-types"
import {
  matcoreCatalogHref,
  withMatcoreCatalogReturn
} from "@/lib/matcore-catalog-navigation"
import { SourceCatalogEntry } from "./source-catalog-entry"
import {
  FieldRuleOverview,
  SpecificationComparison
} from "./field-specification"
import { WorkspaceSelect } from "./workspace-select"
import { errorMessage, profileLabel } from "./workspace-presenters"
import { formatDateTime } from "@/lib/date"
import { cn } from "@/lib/utils"

type Props = {
  community: { slug: string; title: string }
  data: RouterOutput["matcoreWorkflow"]["standard"]
  viewerId: number | null
  section: "standard" | "proposals" | "releases"
  mode: "reference" | "working" | "release"
  layout: "list" | "hierarchy"
  profile?: string
  search: string
  selectedId?: string
}

export function CommunityStandardWorkspace({
  community,
  data,
  viewerId,
  section,
  mode,
  layout,
  profile,
  search,
  selectedId
}: Props) {
  const router = useRouter()
  const [status, setStatus] = useState("awaiting_review")
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [name, setName] = useState("")
  const [note, setNote] = useState("")
  const [newName, setNewName] = useState("")
  const [newProfile, setNewProfile] = useState(
    profile ?? data.profiles[0]?.id ?? ""
  )
  const [error, setError] = useState("")
  const requestId = useRef<string | null>(null)
  const createRelease = trpc.matcoreWorkflow.createStandardRelease.useMutation()
  const createField = trpc.matcoreWorkflow.createDraft.useMutation()
  const activeMode = !data.reference && mode === "reference" ? "working" : mode
  const entries =
    activeMode === "reference"
      ? data.referenceEntries
      : activeMode === "release"
        ? (data.selectedRelease?.snapshot.entries ?? [])
        : data.working.entries
  const inherited =
    data.profiles.find((row) => row.id === profile)?.inherits ?? []
  const visible = entries.filter(
    (entry) => !profile || entry.profileKey === profile
  )
  const needle = search.trim().toLocaleLowerCase()
  const matches = (entry: (typeof entries)[number]) =>
    !needle ||
    [
      entry.payload.label,
      entry.payload.definition,
      entry.payload.specification.path
    ].some((value) => value.toLocaleLowerCase().includes(needle))
  const filtered = visible.filter(matches)
  const selected =
    entries.find((row) => row.id === selectedId) ??
    (!selectedId ? filtered[0] : null)
  const baseline = data.referenceEntries.find((row) => row.id === selected?.id)
  const showSourceEntry =
    activeMode === "reference" ||
    (activeMode === "working" &&
      !selected?.revisionId &&
      Boolean(selected?.sourceOccurrenceId))
  const href = (
    next: {
      source?: string
      profileKey?: string
      search?: string
      layout?: "list" | "hierarchy"
      standard?: "reference" | "working" | "release"
      edition?: string
      releaseId?: string
    } = {}
  ) =>
    matcoreCatalogHref(community.slug, {
      releaseId: data.reference?.id,
      profileKey: profile,
      search,
      layout,
      standard: activeMode,
      edition: data.selectedRelease?.id,
      ...next
    })
  const listHref = href()
  const detailHref = selected ? href({ source: selected.id }) : listHref
  const source = trpc.matcoreWorkflow.sourceEntry.useQuery(
    {
      vocabularySlug: data.workspace.vocabularySlug,
      releaseId: data.reference?.id ?? "none",
      occurrenceId: selected?.sourceOccurrenceId ?? "none"
    },
    {
      enabled:
        section === "standard" &&
        showSourceEntry &&
        Boolean(data.reference && selected?.sourceOccurrenceId)
    }
  )
  const groups = [
    ...data.profiles.map((row) => ({
      id: row.id as string,
      label: profileLabel(row.id)
    })),
    ...(visible.some((row) => !row.profileKey)
      ? [{ id: "community", label: "Community fields" }]
      : [])
  ]
  const outline = buildHierarchy(
    groups.filter((group) => !profile || group.id === profile),
    visible.map((row) => ({
      id: row.id,
      group: row.profileKey ?? "community",
      path: row.payload.specification.path.split("."),
      label: row.payload.label,
      href: href({ source: row.id }),
      matches: matches(row),
      labels:
        activeMode !== "reference" && row.revisionId ? ["Community change"] : []
    }))
  )
  const busy = createRelease.isPending || createField.isPending
  const proposals = data.proposals.filter(
    (row) =>
      (!profile || row.profileKey === profile) &&
      (status === "all" || row.status === status)
  )
  const canCreate = Boolean(
    viewerId && data.workspace.metadataEnabled && !data.workspace.retired
  )

  const actions = (
    <div className="flex flex-wrap gap-2">
      {canCreate && section !== "releases" ? (
        <Button
          variant="outline"
          onClick={() => {
            requestId.current = null
            setError("")
            setNewProfile(profile ?? data.profiles[0]?.id ?? "")
            setNewOpen(true)
          }}
        >
          Propose a new field
        </Button>
      ) : null}
      {data.workspace.canManage &&
      (activeMode === "working" || section === "releases") ? (
        <Button
          onClick={() => {
            requestId.current = null
            setError("")
            setReleaseOpen(true)
          }}
        >
          Create community release
        </Button>
      ) : null}
    </div>
  )

  return (
    <section
      className="flex min-w-0 flex-col gap-5"
      aria-label={
        section === "standard"
          ? "Community standard"
          : section === "proposals"
            ? "Community proposals"
            : "Community releases"
      }
    >
      {section !== "standard" ? (
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold">
              {section === "proposals" ? "Proposals" : "Community releases"}
            </h2>
            <InfoPopover label="About community standards">
              Reference versions preserve the published specification. Accepted
              proposals form the community working version. A community release
              records a named snapshot and does not imply approval by the
              reference publisher.
            </InfoPopover>
          </div>
          {actions}
        </header>
      ) : null}

      {section === "standard" ? (
        <>
          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-end gap-4">
              <h2 className="sr-only">Standard</h2>
              <nav
                aria-label="Standard version"
                className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
              >
                {[
                  { value: "working" as const, label: "Working version" },
                  ...(data.releases.length
                    ? [
                        {
                          value: "release" as const,
                          label: "Community release"
                        }
                      ]
                    : []),
                  ...(data.reference
                    ? [{ value: "reference" as const, label: "Reference" }]
                    : [])
                ].map(({ value, label }) => (
                  <Button
                    key={value}
                    asChild
                    size="sm"
                    variant={activeMode === value ? "secondary" : "ghost"}
                  >
                    <Link
                      aria-current={activeMode === value ? "page" : undefined}
                      href={href({
                        standard: value,
                        edition:
                          value === "release"
                            ? data.releases[0]?.id
                            : undefined,
                        releaseId:
                          value === "release"
                            ? (data.releases[0]?.referenceReleaseId ??
                              undefined)
                            : data.reference?.id
                      })}
                    >
                      {label}
                    </Link>
                  </Button>
                ))}
              </nav>
              {activeMode === "release" ? (
                <Field className="w-full sm:w-64">
                  <FieldLabel htmlFor="standard-edition">
                    Community release
                  </FieldLabel>
                  <WorkspaceSelect
                    id="standard-edition"
                    value={data.selectedRelease?.id ?? ""}
                    onChange={(e) => {
                      const release = data.releases.find(
                        (row) => row.id === e.target.value
                      )!
                      router.push(
                        href({
                          edition: release.id,
                          releaseId: release.referenceReleaseId ?? undefined
                        })
                      )
                    }}
                  >
                    {data.releases.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </WorkspaceSelect>
                </Field>
              ) : data.reference ? (
                <Field className="w-full sm:w-64">
                  <FieldLabel htmlFor="standard-reference">
                    Reference version
                  </FieldLabel>
                  <WorkspaceSelect
                    id="standard-reference"
                    value={data.reference.id}
                    onChange={(e) =>
                      router.push(
                        href({
                          releaseId: e.target.value,
                          profileKey: undefined,
                          search: ""
                        })
                      )
                    }
                  >
                    {data.referenceVersions.map((row) => (
                      <option key={row.id} value={row.id}>
                        MatCore {row.version}
                      </option>
                    ))}
                  </WorkspaceSelect>
                </Field>
              ) : null}
              <div className="flex items-center gap-2 sm:ml-auto">
                <InfoPopover label="About community standards">
                  Reference versions preserve the published specification.
                  Accepted proposals form the community working version. A named
                  community release records a snapshot and does not imply
                  approval by the reference publisher.
                </InfoPopover>
                {actions}
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              {data.profiles.length ? (
                <Field className="sm:w-56">
                  <FieldLabel htmlFor="standard-profile">Profile</FieldLabel>
                  <WorkspaceSelect
                    id="standard-profile"
                    value={profile ?? ""}
                    onChange={(e) =>
                      router.push(
                        href({ profileKey: e.target.value || undefined })
                      )
                    }
                  >
                    <option value="">All profiles</option>
                    {data.profiles.map((row) => (
                      <option key={row.id} value={row.id}>
                        {profileLabel(row.id)}
                      </option>
                    ))}
                  </WorkspaceSelect>
                </Field>
              ) : null}
              <form
                role="search"
                aria-label="Community fields"
                className="flex min-w-0 flex-1 items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  router.push(
                    href({
                      search: String(
                        new FormData(e.currentTarget).get("q") ?? ""
                      )
                    })
                  )
                }}
              >
                <Field>
                  <FieldLabel htmlFor="standard-search">
                    Find a field
                  </FieldLabel>
                  <Input
                    key={search}
                    id="standard-search"
                    name="q"
                    type="search"
                    defaultValue={search}
                    maxLength={200}
                  />
                </Field>
                <Button type="submit" variant="outline">
                  Search
                </Button>
                {search ? (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => router.push(href({ search: "" }))}
                  >
                    Clear
                  </Button>
                ) : null}
              </form>
              <nav
                aria-label="Catalog view"
                className="flex gap-1 rounded-lg bg-muted p-1"
              >
                {(["hierarchy", "list"] as const).map((value) => (
                  <Button
                    asChild
                    key={value}
                    size="sm"
                    variant={layout === value ? "secondary" : "ghost"}
                  >
                    <Link
                      href={href({ layout: value })}
                      aria-current={layout === value ? "page" : undefined}
                    >
                      {value === "list" ? "List" : "Hierarchy"}
                    </Link>
                  </Button>
                ))}
              </nav>
            </div>
          </div>
          {inherited.length ? (
            <p className="text-sm text-muted-foreground">
              Includes fields from{" "}
              {inherited.map((id, index) => (
                <span key={id}>
                  {index ? ", " : ""}
                  <Link className="underline" href={href({ profileKey: id })}>
                    {profileLabel(id)}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
          {activeMode === "release" && data.selectedRelease ? (
            <p className="text-sm text-muted-foreground">
              {data.selectedRelease.name} · Released{" "}
              {formatDateTime(data.selectedRelease.createdAt)}
              {data.reference
                ? ` · Based on MatCore ${data.reference.version}`
                : ""}
            </p>
          ) : null}
          <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.8fr)]">
            <aside
              className={cn("min-w-0", selectedId && "hidden lg:block")}
              aria-label="Fields"
            >
              <p className="mb-2 text-sm text-muted-foreground">
                {filtered.length} fields
              </p>
              {layout === "hierarchy" ? (
                <HierarchyOutline
                  key={`${activeMode}:${profile ?? ""}:${search}`}
                  nodes={outline}
                  storageKey={`${viewerId}:${community.slug}:${data.reference?.id ?? "community"}:${activeMode}:${profile ?? "all"}`}
                  search={search}
                  label="Field hierarchy"
                  initialExpanded={
                    selected
                      ? [JSON.stringify([selected.profileKey ?? "community"])]
                      : []
                  }
                  activeHref={detailHref}
                  restoreFocus={!selectedId}
                />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {filtered.map((row) => (
                    <li key={row.id}>
                      <Link
                        href={href({ source: row.id })}
                        aria-current={
                          selected?.id === row.id ? "page" : undefined
                        }
                        className={cn(
                          "flex flex-col gap-1 p-3 hover:bg-accent",
                          selected?.id === row.id && "bg-muted"
                        )}
                      >
                        <span className="break-words font-medium">
                          {row.payload.label}
                        </span>
                        <span className="break-words text-xs text-muted-foreground">
                          {row.profileKey
                            ? `${profileLabel(row.profileKey)} · `
                            : ""}
                          {row.payload.specification.path}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {!filtered.length ? (
                <p className="py-4 text-sm text-muted-foreground">
                  {search ? "No fields match this search." : "No fields yet."}
                </p>
              ) : null}
            </aside>
            <div
              className={cn(
                "min-w-0 rounded-lg border p-4 sm:p-6",
                !selectedId && "hidden lg:block"
              )}
            >
              {selected ? (
                showSourceEntry ? (
                  source.data ? (
                    <SourceCatalogEntry
                      key={`${activeMode}:${selected.id}`}
                      viewLabel={
                        activeMode === "working"
                          ? "Working version"
                          : "Reference"
                      }
                      focusOnOpen={Boolean(selectedId)}
                      community={community}
                      entry={source.data}
                      viewerId={viewerId}
                      listHref={listHref}
                      detailHref={detailHref}
                    />
                  ) : (
                    <p role="status">
                      {source.error
                        ? "This reference field is unavailable."
                        : "Loading field…"}
                    </p>
                  )
                ) : (
                  <article
                    aria-label={selected.payload.label}
                    className="flex flex-col gap-5"
                  >
                    <Link
                      className="text-sm underline lg:hidden"
                      href={listHref}
                    >
                      Back to fields
                    </Link>
                    <header className="flex flex-col gap-2">
                      <p className="break-words text-sm text-muted-foreground">
                        {selected.profileKey
                          ? `${profileLabel(selected.profileKey)} / `
                          : ""}
                        {selected.payload.specification.path.replaceAll(
                          ".",
                          " / "
                        )}
                      </p>
                      <h3 className="break-words text-2xl font-semibold">
                        {selected.payload.label}
                      </h3>
                      <span className="text-sm text-muted-foreground">
                        {selected.revisionId
                          ? "Accepted community change"
                          : "Unchanged from reference"}
                        {activeMode === "release"
                          ? ` · ${data.selectedRelease?.name}`
                          : ""}
                      </span>
                    </header>
                    {selected.fieldId && selected.revisionId ? (
                      <Button asChild className="w-fit">
                        <Link
                          href={`/metadata/fields/${selected.fieldId}?revision=${selected.revisionId}`}
                        >
                          View change and discussion
                        </Link>
                      </Button>
                    ) : selected.sourceOccurrenceId ? (
                      <Button asChild className="w-fit">
                        <Link
                          href={href({
                            source: selected.sourceOccurrenceId,
                            standard: "reference",
                            edition: undefined
                          })}
                        >
                          Propose a change
                        </Link>
                      </Button>
                    ) : null}
                    <section>
                      <h4 className="mb-2 font-semibold">Definition</h4>
                      <p className="whitespace-pre-wrap break-words rounded-md border bg-definition p-4 text-sm">
                        {selected.payload.definition}
                      </p>
                    </section>
                    <section>
                      <h4 className="mb-3 font-semibold">Field rules</h4>
                      <FieldRuleOverview
                        specification={selected.payload.specification}
                        profileKey={selected.profileKey}
                      />
                    </section>
                    {selected.revisionId && baseline ? (
                      <details className="rounded-md border p-4">
                        <summary className="cursor-pointer font-medium">
                          Compare with reference
                        </summary>
                        <div className="mt-4 flex flex-col gap-4">
                          <div>
                            <h4 className="mb-2 font-medium">
                              Reference definition
                            </h4>
                            <p className="whitespace-pre-wrap break-words text-sm">
                              {baseline.payload.definition}
                            </p>
                          </div>
                          <SpecificationComparison
                            specification={selected.payload.specification}
                            baseline={baseline.payload.specification}
                            currentLabel="Community version"
                          />
                        </div>
                      </details>
                    ) : null}
                  </article>
                )
              ) : (
                <p className="text-sm text-muted-foreground">
                  No field selected.
                </p>
              )}
            </div>
          </div>
        </>
      ) : section === "proposals" ? (
        <>
          {data.reference ? (
            <Field className="max-w-xs">
              <FieldLabel htmlFor="proposal-reference">
                Reference version
              </FieldLabel>
              <WorkspaceSelect
                id="proposal-reference"
                value={data.reference.id}
                onChange={(event) =>
                  router.push(
                    `/communities/${community.slug}?${new URLSearchParams({ view: "proposals", release: event.target.value, ...(profile ? { profile } : {}) })}`
                  )
                }
              >
                {data.referenceVersions.map((row) => (
                  <option key={row.id} value={row.id}>
                    MatCore {row.version}
                  </option>
                ))}
              </WorkspaceSelect>
            </Field>
          ) : null}
          {data.profiles.length ? (
            <Field className="max-w-xs">
              <FieldLabel htmlFor="proposal-area">Area</FieldLabel>
              <WorkspaceSelect
                id="proposal-area"
                value={profile ?? ""}
                onChange={(event) =>
                  router.push(
                    `/communities/${community.slug}?` +
                      new URLSearchParams({
                        view: "proposals",
                        ...(data.reference
                          ? { release: data.reference.id }
                          : {}),
                        ...(event.target.value
                          ? { profile: event.target.value }
                          : {})
                      })
                  )
                }
              >
                <option value="">All areas</option>
                {data.profiles.map((row) => (
                  <option key={row.id} value={row.id}>
                    {profileLabel(row.id)}
                  </option>
                ))}
              </WorkspaceSelect>
            </Field>
          ) : null}
          <Field className="max-w-xs">
            <FieldLabel htmlFor="proposal-status">Status</FieldLabel>
            <WorkspaceSelect
              id="proposal-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All proposals</option>
              {Object.entries(proposalStatusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </WorkspaceSelect>
          </Field>
          <ul className="divide-y rounded-lg border">
            {proposals.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/metadata/fields/${row.fieldId}?revision=${row.id}`}
                  className="flex flex-col gap-2 p-4 hover:bg-accent"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{row.label}</span>
                    <Badge variant="outline">
                      {proposalStatusLabels[row.status]}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {row.profileKey ? `${profileLabel(row.profileKey)} · ` : ""}
                    {row.path} · {row.author ?? "Contributor"}
                  </span>
                  <p className="line-clamp-2 break-words text-sm">
                    {row.rationale}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          {!proposals.length ? (
            <p className="text-sm text-muted-foreground">
              {status === "awaiting_review"
                ? "No proposals awaiting review."
                : "No proposals with this status."}
            </p>
          ) : null}
          <Button asChild className="w-fit" variant="outline">
            <Link href={href({ standard: "reference", edition: undefined })}>
              Browse fields to propose a change
            </Link>
          </Button>
        </>
      ) : (
        <>
          <ul className="divide-y rounded-lg border">
            {data.releases.map((row) => (
              <li key={row.id}>
                <Link
                  className="flex flex-col gap-1 p-4 hover:bg-accent"
                  href={href({
                    standard: "release",
                    edition: row.id,
                    releaseId: row.referenceReleaseId ?? undefined
                  })}
                >
                  <span className="font-medium">{row.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatDateTime(row.createdAt)} · {row.fieldCount} fields
                  </span>
                  {row.note ? <p className="text-sm">{row.note}</p> : null}
                </Link>
              </li>
            ))}
          </ul>
          {!data.releases.length ? (
            <p className="text-sm text-muted-foreground">
              No community releases yet.
            </p>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <Dialog
        open={releaseOpen}
        onOpenChange={(open) => {
          if (!busy) setReleaseOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create community release</DialogTitle>
            <DialogDescription>
              Record the working version with its accepted changes. This release
              is attributed to {community.title}.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (busy) return
              requestId.current ??= crypto.randomUUID()
              setError("")
              void createRelease
                .mutateAsync({
                  id: requestId.current,
                  vocabularySlug: data.workspace.vocabularySlug,
                  referenceReleaseId: data.reference?.id,
                  name,
                  note,
                  expectedFingerprint: data.fingerprint
                })
                .then((result) => {
                  setReleaseOpen(false)
                  router.push(href({ standard: "release", edition: result.id }))
                  router.refresh()
                })
                .catch((err) => setError(errorMessage(err)))
            }}
          >
            <Field>
              <FieldLabel htmlFor="release-name">Release name</FieldLabel>
              <Input
                id="release-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
                placeholder="Community 1.0"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="release-note">Release notes</FieldLabel>
              <Textarea
                id="release-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={4000}
              />
            </Field>
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setReleaseOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create release"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={newOpen}
        onOpenChange={(open) => {
          if (!busy) setNewOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Propose a new field</DialogTitle>
            <DialogDescription>
              Your draft stays private until you submit it for review.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (busy || viewerId === null) return
              requestId.current ??= crypto.randomUUID()
              setError("")
              const payload = emptyMatcoreDraftPayload()
              payload.label = newName.trim()
              payload.specification.path = newName
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "-")
              void createField
                .mutateAsync({
                  id: requestId.current,
                  vocabularySlug: data.workspace.vocabularySlug,
                  expectedOwnerId: viewerId,
                  payload,
                  ...(newProfile && data.reference
                    ? {
                        profileKey: newProfile as MatcoreProfileKey,
                        profileReleaseId: data.reference.id
                      }
                    : {})
                })
                .then((draft) =>
                  window.location.assign(
                    withMatcoreCatalogReturn(
                      `/metadata/workspace/${draft.id}`,
                      listHref
                    )
                  )
                )
                .catch((err) => setError(errorMessage(err)))
            }}
          >
            <Field>
              <FieldLabel htmlFor="new-field-name">Field name</FieldLabel>
              <Input
                id="new-field-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                maxLength={200}
              />
            </Field>
            {data.profiles.length ? (
              <Field>
                <FieldLabel htmlFor="new-field-profile">Profile</FieldLabel>
                <WorkspaceSelect
                  id="new-field-profile"
                  value={newProfile}
                  onChange={(e) => setNewProfile(e.target.value)}
                >
                  <option value="">No reference profile</option>
                  {data.profiles.map((row) => (
                    <option key={row.id} value={row.id}>
                      {profileLabel(row.id)}
                    </option>
                  ))}
                </WorkspaceSelect>
              </Field>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setNewOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Opening…" : "Create draft"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
