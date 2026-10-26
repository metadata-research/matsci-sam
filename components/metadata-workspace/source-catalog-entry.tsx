"use client"

import { sourceFieldName } from "@/lib/metadata-field-name"

import Link from "next/link"
import { InfoPopover } from "@/components/info-popover"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { trpc } from "@/trpc/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { authPathWithReturnTo, profileCompletionPath } from "@/lib/auth-return"
import { withMatcoreCatalogReturn } from "@/lib/matcore-catalog-navigation"
import { FieldRuleOverview } from "./field-specification"
import { ProfileContext } from "./source-history"
import { errorMessage, profileLabel } from "./workspace-presenters"
import { FieldDestinationLink } from "./field-destination-link"

type Props = {
  community: { slug: string; title: string }
  entry: RouterOutput["matcoreWorkflow"]["sourceEntry"]
  viewerId: number | null
  listHref: string
  detailHref: string
  focusOnOpen?: boolean
  viewLabel?: "Reference" | "Working version"
}

export function SourceCatalogEntry({
  community,
  entry,
  viewerId,
  listHref,
  detailHref,
  focusOnOpen = true,
  viewLabel = "Reference"
}: Props) {
  const router = useRouter()
  const start = trpc.matcoreWorkflow.startSourceChange.useMutation()
  const [error, setError] = useState("")
  const opening = useRef(false)
  const mounted = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    mounted.current = true
    // A query-only route change may retain the list's old scroll position.
    // This component is keyed by the selected source, so only entry changes
    // move the viewport; reading or editing elsewhere never triggers a jump.
    if (focusOnOpen) {
      if (window.matchMedia("(max-width: 1023px)").matches)
        heading.current?.scrollIntoView({ behavior: "instant", block: "start" })
      heading.current?.focus({ preventScroll: true })
    }
    return () => {
      mounted.current = false
    }
  }, [focusOnOpen])
  const { baseline, sourceOccurrence, sourceRelease } = entry
  const ownDraft = entry.ownDraft?.status === "draft" ? entry.ownDraft : null
  const toolsEnabled =
    entry.workspace.metadataEnabled && entry.workspace.matcoreEnabled

  async function propose() {
    if (!viewerId || !entry.canContribute || opening.current) return
    opening.current = true
    setError("")
    try {
      const result = await start.mutateAsync({
        vocabularySlug: entry.workspace.vocabularySlug,
        releaseId: entry.releaseId,
        occurrenceId: entry.occurrenceId,
        expectedOwnerId: viewerId
      })
      if (!mounted.current) return
      if (result.kind === "draft") {
        window.location.assign(
          withMatcoreCatalogReturn(
            `/metadata/workspace/${result.draftId}`,
            detailHref
          )
        )
      } else {
        router.push(
          `/metadata/fields/${result.fieldId}?revision=${result.revisionId}`
        )
      }
    } catch (error) {
      if (mounted.current) setError(errorMessage(error))
    } finally {
      opening.current = false
    }
  }

  return (
    <article
      aria-labelledby="matcore-source-heading"
      className="flex min-w-0 flex-col gap-5"
    >
      <Link
        href={listHref}
        className="w-fit text-sm underline underline-offset-4"
      >
        Back to fields
      </Link>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{viewLabel}</Badge>
          <Badge variant="secondary">MatCore {sourceRelease.version}</Badge>
        </div>
        <h3
          id="matcore-source-heading"
          ref={heading}
          tabIndex={-1}
          className="scroll-mt-24 break-words text-2xl font-semibold focus-visible:outline focus-visible:outline-ring"
        >
          {sourceFieldName(sourceOccurrence)}
        </h3>
        <p className="break-words text-sm text-muted-foreground">
          {profileLabel(sourceOccurrence.profileKey)} ·{" "}
          {sourceOccurrence.path.join(" / ")}
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        {ownDraft && entry.canResume ? (
          <Button asChild>
            <FieldDestinationLink
              href={withMatcoreCatalogReturn(
                `/metadata/workspace/${ownDraft.id}`,
                detailHref
              )}
            >
              Continue my draft
            </FieldDestinationLink>
          </Button>
        ) : entry.latestProposal ? (
          <Button asChild variant="outline">
            <Link
              href={`/metadata/fields/${entry.latestProposal.fieldId}?revision=${entry.latestProposal.revisionId}`}
            >
              View proposal
            </Link>
          </Button>
        ) : entry.canContribute ? (
          <Button disabled={start.isPending} onClick={() => void propose()}>
            {start.isPending ? "Opening draft…" : "Propose a change"}
          </Button>
        ) : !viewerId && toolsEnabled && !entry.workspace.retired ? (
          <Button asChild>
            <Link href={authPathWithReturnTo("/login", detailHref)}>
              Sign in to propose a change
            </Link>
          </Button>
        ) : null}
        <InfoPopover label="About proposing a change">
          Creates a private draft in {community.title}. The reference version
          stays unchanged.
        </InfoPopover>
        <a
          href={sourceOccurrence.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline underline-offset-4"
        >
          Read the source specification
        </a>
      </div>
      {entry.workspace.retired ? (
        <p className="text-sm text-muted-foreground">
          This vocabulary is retired. Its source entries remain available to
          read.
        </p>
      ) : !toolsEnabled ? (
        <p className="text-sm text-muted-foreground">
          New MatCore proposals are disabled in this workspace. Source entries
          and existing drafts are preserved.
        </p>
      ) : viewerId && entry.contributionBlockReason === "profile" ? (
        <p className="text-sm text-muted-foreground">
          <Link
            className="underline underline-offset-4"
            href={profileCompletionPath(detailHref)}
          >
            Add your name to your profile
          </Link>{" "}
          before proposing a change.
        </p>
      ) : viewerId && !entry.canContribute && !entry.canResume ? (
        <p className="text-sm text-muted-foreground">
          Community contribution access is required to propose a change.
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>The draft could not be opened</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <section
        aria-labelledby="matcore-source-definition"
        className="flex flex-col gap-2"
      >
        <h4 id="matcore-source-definition" className="font-semibold">
          Definition
        </h4>
        <p className="rounded-md border bg-definition p-4 whitespace-pre-wrap break-words text-sm">
          {baseline.definition}
        </p>
        {baseline.example ? (
          <p className="whitespace-pre-wrap break-words text-sm">
            Example: {baseline.example}
          </p>
        ) : null}
      </section>
      <section
        aria-labelledby="matcore-source-rules"
        className="flex flex-col gap-3"
      >
        <div className="flex items-center gap-1">
          <h4 id="matcore-source-rules" className="font-semibold">
            Field rules
          </h4>
          <InfoPopover label="About source field rules">
            Not specified means that the source record has no established rule.
            It does not mean optional.
          </InfoPopover>
        </div>
        <FieldRuleOverview
          specification={baseline.specification}
          profileKey={sourceOccurrence.profileKey}
        />
      </section>
      <ProfileContext context={entry.profileContext} />
      {sourceOccurrence.warnings.length ? (
        <Alert>
          <AlertTitle>Source interpretation notes</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-2 pl-5">
              {sourceOccurrence.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <details className="rounded-md border p-4 text-sm">
        <summary className="cursor-pointer font-medium">
          Source text and attribution
        </summary>
        <div className="flex min-w-0 flex-col gap-3 pt-4">
          <p className="whitespace-pre-wrap break-words">
            {sourceOccurrence.rawText}
          </p>
          <p>{sourceRelease.attribution}</p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-muted-foreground">Source key</dt>
              <dd className="break-words">{sourceOccurrence.sourceKey}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">Source location</dt>
              <dd className="break-words">
                {sourceOccurrence.sourceTableId}, row{" "}
                {sourceOccurrence.sourceRow}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">Retrieved</dt>
              <dd>{sourceRelease.retrievedOn}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">Reuse terms</dt>
              <dd>
                {sourceRelease.license ||
                  "Not established for this source snapshot"}
              </dd>
            </div>
          </dl>
          <p className="break-all text-xs text-muted-foreground">
            SHA-256: {sourceRelease.sha256}
          </p>
        </div>
      </details>
    </article>
  )
}
