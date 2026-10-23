"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { PlusIcon } from "lucide-react"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import type { MatcoreProfileKey } from "@/lib/matcore-workflow-types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { formatDateTime } from "@/lib/date"
import { profileCompletionPath } from "@/lib/auth-return"
import { withCommunityWorkReturn } from "@/lib/community-work-return"
import { matcoreCatalogHref } from "@/lib/matcore-catalog-navigation"
import {
  emptyFieldPayload,
  errorMessage,
  profileChoices,
  profileLabel
} from "./workspace-presenters"
import { WorkspaceSelect } from "./workspace-select"

type Props = {
  ownerId: number
  options: RouterOutput["setup"]["options"]
  catalog: RouterOutput["matcoreWorkflow"]["catalog"]
  result: RouterOutput["matcoreWorkflow"]["list"]
  vocabularySlug: string
  workspace: RouterOutput["matcoreWorkflow"]["workspace"]
  workPath: string
  returnTo?: string
  profileKey?: MatcoreProfileKey
  offset: number
}

export function WorkspaceList({
  ownerId,
  options,
  catalog,
  result,
  vocabularySlug,
  workspace,
  workPath,
  returnTo,
  profileKey,
  offset
}: Props) {
  const router = useRouter()
  const importStandard = trpc.matcoreWorkflow.importStandard.useMutation()
  const create = trpc.matcoreWorkflow.createDraft.useMutation()
  const destination = vocabularySlug
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [importComplete, setImportComplete] = useState(false)
  const [error, setError] = useState("")
  const [confirmImport, setConfirmImport] = useState(false)
  const [newField, setNewField] = useState(false)
  const [label, setLabel] = useState("")
  const [newProfile, setNewProfile] = useState<MatcoreProfileKey | "">("")
  const mounted = useRef(false)
  const stop = useRef(false)
  const createId = useRef<string | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stop.current = true
    }
  }, [])
  const destinationItem = options.vocabularies.find(
    (item) => item.slug === destination
  )

  function href(next: {
    vocabularySlug?: string
    profileKey?: string
    offset?: number
  }) {
    const [path, query] = workPath.split("?")
    const params = new URLSearchParams(query)
    params.delete("profile")
    params.delete("offset")
    if (next.profileKey) params.set("profile", next.profileKey)
    if (next.offset) params.set("offset", String(next.offset))
    return `${path}${params.size ? `?${params}` : ""}`
  }

  async function beginImport() {
    if (!destinationItem?.canContribute || importing || !catalog.releaseId)
      return
    setConfirmImport(false)
    stop.current = false
    setImporting(true)
    setImportComplete(false)
    setError("")
    try {
      while (!stop.current) {
        const response = await importStandard.mutateAsync({
          vocabularySlug: destination,
          releaseId: catalog.releaseId,
          expectedOwnerId: ownerId
        })
        if (!mounted.current) break
        setProgress(
          Math.min(response.total, response.existing + response.created)
        )
        if (response.complete) {
          setImportComplete(true)
          break
        }
        if (response.created === 0)
          throw new Error(
            "No additional drafts were imported. Your completed chunks are saved; resume after checking the destination."
          )
      }
    } catch (error) {
      if (mounted.current) setError(errorMessage(error))
    } finally {
      if (mounted.current) {
        setImporting(false)
        router.refresh()
      }
    }
  }

  return (
    <section
      aria-labelledby="my-field-drafts"
      className="flex min-w-0 flex-col gap-4"
    >
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="my-field-drafts"
            tabIndex={-1}
            data-section-target
            className="text-xl font-semibold"
          >
            My field drafts
          </h2>
          <p className="text-sm text-muted-foreground">
            {result.total} {result.total === 1 ? "entry" : "entries"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workspace.metadataEnabled && destinationItem?.canContribute ? (
            <Button
              variant="outline"
              size="sm"
              disabled={importing || create.isPending}
              onClick={() => {
                setNewField(true)
                createId.current = null
                setError("")
              }}
            >
              <PlusIcon data-icon="inline-start" aria-hidden />
              New metadata field
            </Button>
          ) : null}
          {workspace.hasMatcoreCatalog && workspace.community ? (
            <Button asChild variant="outline" size="sm">
              <Link href={matcoreCatalogHref(workspace.community.slug)}>
                Browse MatCore catalog
              </Link>
            </Button>
          ) : null}
          {importing ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                stop.current = true
              }}
            >
              Pause after this group
            </Button>
          ) : null}
          <Link
            className="text-sm underline underline-offset-4"
            href="/docs/matcore-workflow"
          >
            Field workflow guide
          </Link>
        </div>
        {workspace.hasMatcoreCatalog ? (
          <p className="text-sm text-muted-foreground">
            The MatCore catalog preserves source versions. These drafts are your
            private working copies; editing them does not change the source.
          </p>
        ) : null}
        {workspace.matcoreEnabled &&
        workspace.metadataEnabled &&
        catalog.release &&
        destinationItem?.canContribute ? (
          <details className="text-sm">
            <summary className="w-fit cursor-pointer py-1 text-muted-foreground">
              Prepare drafts in bulk
            </summary>
            <div className="flex flex-col items-start gap-2 pt-2">
              <p className="text-muted-foreground">
                Use this when you want a private working copy of every field in
                MatCore {catalog.release?.version}. Existing drafts and edits
                are kept. You can also propose changes to individual fields from
                the catalog.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={importing || create.isPending}
                onClick={() => setConfirmImport(true)}
              >
                Import all sections as drafts
              </Button>
            </div>
          </details>
        ) : null}
        {!workspace.metadataEnabled ? (
          <p className="text-sm text-muted-foreground">
            New metadata fields are disabled. Existing drafts and published
            proposals remain available.
          </p>
        ) : null}
        {!options.profileComplete ? (
          <p className="text-sm">
            <Link
              className="underline"
              href={profileCompletionPath(returnTo ?? workPath)}
            >
              Add your name to your profile
            </Link>{" "}
            before publishing.
          </p>
        ) : null}
      </header>
      {progress !== null ? (
        <p role="status" className="text-sm">
          {importComplete
            ? `Import complete: ${progress} field drafts are available for review.`
            : importing
              ? `Importing: ${progress} of ${catalog.total} field drafts saved…`
              : `${progress} field drafts saved. You can resume the import.`}
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>The operation could not be completed</AlertTitle>
          <AlertDescription>
            {error} Completed imports and saved drafts remain available.
          </AlertDescription>
        </Alert>
      ) : null}
      {Boolean(profileKey) ||
      workspace.matcoreEnabled ||
      result.drafts.some((draft) => draft.profileKey) ? (
        <div className="max-w-sm">
          <Field>
            <FieldLabel htmlFor="workspace-profile-filter">Section</FieldLabel>
            <WorkspaceSelect
              id="workspace-profile-filter"
              value={profileKey ?? ""}
              disabled={importing}
              onChange={(event) =>
                router.push(
                  href({ vocabularySlug, profileKey: event.target.value })
                )
              }
            >
              <option value="">All sections · core and DFT first</option>
              {profileChoices.map((profile) => (
                <option key={profile.key} value={profile.key}>
                  {profile.label}
                </option>
              ))}
            </WorkspaceSelect>
          </Field>
        </div>
      ) : null}
      {result.drafts.length ? (
        <ul className="flex flex-col divide-y rounded-lg border">
          {result.drafts.map((draft) => (
            <li
              key={draft.id}
              className="flex flex-wrap items-center justify-between gap-4 p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="break-words font-medium underline underline-offset-4"
                    href={
                      draft.status === "published"
                        ? `/metadata/fields/${draft.fieldId}?revision=${draft.publishedRevisionId}`
                        : withCommunityWorkReturn(
                            `/metadata/workspace/${draft.id}`,
                            returnTo
                          )
                    }
                  >
                    {draft.label || "Untitled field"}
                  </Link>
                  <Badge
                    variant={
                      draft.status === "published" ? "secondary" : "outline"
                    }
                  >
                    {draft.status === "published"
                      ? "Published proposal"
                      : "Private draft"}
                  </Badge>
                </div>
                <p className="mt-1 break-words text-sm text-muted-foreground">
                  {profileLabel(draft.profileKey)} · {draft.path}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Saved{" "}
                  <time dateTime={draft.updatedAt}>
                    {formatDateTime(draft.updatedAt)}
                  </time>
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link
                  href={
                    draft.status === "published"
                      ? `/metadata/fields/${draft.fieldId}?revision=${draft.publishedRevisionId}`
                      : withCommunityWorkReturn(
                          `/metadata/workspace/${draft.id}`,
                          returnTo
                        )
                  }
                >
                  {draft.status === "published" ? "View proposal" : "Continue"}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border p-6 text-sm text-muted-foreground">
          No field drafts match this view. Start a field when metadata
          development is enabled.
        </p>
      )}
      {result.total > 40 ? (
        <nav
          aria-label="Field draft pages"
          className="flex items-center justify-between gap-4"
        >
          <Button
            variant="outline"
            disabled={offset === 0 || importing}
            onClick={() =>
              router.push(
                href({
                  vocabularySlug,
                  profileKey,
                  offset: Math.max(0, offset - 40)
                })
              )
            }
          >
            Previous
          </Button>
          <p className="text-sm text-muted-foreground">
            {offset + 1}–{Math.min(result.total, offset + result.drafts.length)}{" "}
            of {result.total}
          </p>
          <Button
            variant="outline"
            disabled={offset + 40 >= result.total || importing}
            onClick={() =>
              router.push(
                href({ vocabularySlug, profileKey, offset: offset + 40 })
              )
            }
          >
            Next
          </Button>
        </nav>
      ) : null}
      <Dialog open={confirmImport} onOpenChange={setConfirmImport}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import all MatCore sections?</DialogTitle>
            <DialogDescription>
              {catalog.total} field occurrences from MatCore{" "}
              {catalog.release?.version} will become private drafts in{" "}
              {destinationItem?.title}. Existing drafts are preserved. You can
              review common core and DFT first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmImport(false)}>
              Cancel
            </Button>
            <Button onClick={() => void beginImport()}>
              Import private drafts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={newField}
        onOpenChange={(open) => {
          if (!create.isPending) setNewField(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New metadata field</DialogTitle>
            <DialogDescription>
              Start a private local proposal in {destinationItem?.title}. This
              field has no imported source baseline. Choose a standard context
              only if it applies.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              if (create.isPending) return
              setError("")
              createId.current ??= crypto.randomUUID()
              const payload = emptyFieldPayload()
              payload.label = label
              payload.specification.path = label
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "-")
              void create
                .mutateAsync({
                  id: createId.current,
                  vocabularySlug: destination,
                  ...(newProfile && catalog.releaseId
                    ? {
                        profileKey: newProfile,
                        profileReleaseId: catalog.releaseId
                      }
                    : {}),
                  payload,
                  expectedOwnerId: ownerId
                })
                .then((draft) =>
                  router.push(
                    withCommunityWorkReturn(
                      `/metadata/workspace/${draft.id}`,
                      returnTo
                    )
                  )
                )
                .catch((error: unknown) => setError(errorMessage(error)))
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="new-field-label">Field label</FieldLabel>
                <Input
                  id="new-field-label"
                  value={label}
                  onChange={(event) => {
                    createId.current = null
                    setLabel(event.target.value)
                  }}
                  maxLength={200}
                  required
                />
              </Field>
              {workspace.matcoreEnabled && catalog.releaseId ? (
                <Field>
                  <FieldLabel htmlFor="new-field-profile">
                    Standard context
                  </FieldLabel>
                  <WorkspaceSelect
                    id="new-field-profile"
                    value={newProfile}
                    onChange={(event) => {
                      createId.current = null
                      setNewProfile(
                        event.target.value as MatcoreProfileKey | ""
                      )
                    }}
                  >
                    <option value="">No standard · community field</option>
                    {profileChoices.map((profile) => (
                      <option key={profile.key} value={profile.key}>
                        MatCore · {profile.label}
                      </option>
                    ))}
                  </WorkspaceSelect>
                </Field>
              ) : null}
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
                disabled={create.isPending}
                onClick={() => setNewField(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create private draft"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
