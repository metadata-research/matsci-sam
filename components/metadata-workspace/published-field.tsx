"use client"

import Link from "next/link"
import dynamic from "next/dynamic"
import { previousFieldRevision } from "@/lib/metadata-field-provenance"
import { FieldChanges } from "./field-changes"
import { useRouter } from "next/navigation"
import { InfoPopover } from "@/components/info-popover"
import { proposalStatusLabels } from "@/lib/community-standard-types"
import { proposalFieldName } from "@/lib/metadata-field-name"
import { useState } from "react"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ReviewPacketButton } from "@/components/communities/review-packet"
import { communitySectionHref } from "@/lib/community-navigation"
import {
  withCommunityWorkspaceReturn,
  communityWorkspaceReturnLabel
} from "@/lib/community-workspace-return"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { termPath } from "@/lib/public-identifiers"
import { formatDateTime } from "@/lib/date"
import {
  SpecificationSummary,
  SpecificationComparison
} from "./field-specification"
import { FieldCitations } from "./field-citations"
import { FieldHistory, ProfileContext, SourceBaseline } from "./source-history"
import {
  errorMessage,
  profileLabel,
  proposalDifferences
} from "./workspace-presenters"
import { WorkspaceSelect } from "./workspace-select"

type Props = {
  record: RouterOutput["matcoreWorkflow"]["getField"]
  userId: number | null
  isAdmin: boolean
  workspaceHref: string
  initialTab?: "definition" | "changes" | "discussion" | "sources"
}
const FieldProvenance = dynamic(
  () => import("./field-provenance").then((module) => module.FieldProvenance),
  { ssr: false, loading: () => <p role="status">Loading provenance…</p> }
)
const reviewLabels = proposalStatusLabels

export function PublishedField({
  record,
  userId,
  isAdmin,
  workspaceHref,
  initialTab = "definition"
}: Props) {
  const router = useRouter()
  const revise = trpc.matcoreWorkflow.revise.useMutation()
  const review = trpc.matcoreWorkflow.review.useMutation()
  const comment = trpc.matcoreWorkflow.comment.useMutation()
  const [showGraph, setShowGraph] = useState(false)
  const [compareReference, setCompareReference] = useState(false)
  const [commentText, setCommentText] = useState("")
  const withdraw = trpc.matcoreWorkflow.withdraw.useMutation()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [decision, setDecision] = useState<
    "accepted" | "changes_requested" | "declined"
  >("changes_requested")
  const [reason, setReason] = useState("")
  const [withdrawReason, setWithdrawReason] = useState("")
  const [error, setError] = useState("")
  const selected =
    record.revisions.find((item) => item.id === record.selectedRevisionId) ??
    record.revisions[0]
  const latestInProfile = record.revisions.find(
    (item) =>
      item.profileKey === selected.profileKey &&
      item.occurrenceKey === selected.occurrenceKey
  )
  const isLatest = latestInProfile?.id === selected.id
  const payload = selected.payload
  const previous = previousFieldRevision(record.revisions, selected)
  const comparison = compareReference
    ? record.baseline
    : (previous?.payload ?? record.baseline)
  const differences = proposalDifferences(
    {
      ...payload,
      label: proposalFieldName(
        payload.label,
        record.sourceOccurrence,
        record.baseline
      )
    },
    comparison
      ? {
          ...comparison,
          label: proposalFieldName(
            comparison.label,
            record.sourceOccurrence,
            record.baseline
          )
        }
      : null
  )
  const comparisonLabel =
    previous && !compareReference
      ? `revision ${previous.version}`
      : "the reference"
  const busy = revise.isPending || review.isPending || withdraw.isPending
  const canReview = record.canReview
  const canWithdraw = userId === selected.createdById || isAdmin
  const withWorkspaceReturn = (path: string) =>
    withCommunityWorkspaceReturn(path, workspaceHref)

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={workspaceHref}
        className="w-fit text-sm underline underline-offset-4"
      >
        {communityWorkspaceReturnLabel(workspaceHref)}
      </Link>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Metadata field</Badge>
          <Badge variant="secondary">Community proposal</Badge>
          <Badge variant="outline">
            {reviewLabels[selected.reviewState] ?? selected.reviewState}
          </Badge>
        </div>
        <h1 className="break-words text-3xl font-semibold tracking-tight">
          {proposalFieldName(
            payload.label,
            record.sourceOccurrence,
            record.baseline
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          {selected.profileKey ? `${profileLabel(selected.profileKey)} · ` : ""}
          Revision {selected.version} · Submitted{" "}
          <time dateTime={selected.createdAt}>
            {formatDateTime(selected.createdAt)}
          </time>
          {record.sourceRelease
            ? ` · MatCore ${record.sourceRelease.version} baseline`
            : ""}
        </p>
        <InfoPopover label="About proposal status">
          Community review records a local decision. It does not change the
          published reference or imply approval by the reference publisher.
        </InfoPopover>
      </header>
      <div className="flex flex-wrap gap-3">
        {record.field.termSlug ? (
          <Button asChild variant="outline">
            <Link
              href={termPath(
                record.field.termSlug,
                record.field.vocabularySlug
              )}
            >
              View dictionary entry
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <a
            href={`/api/metadata/fields/${record.field.id}?revisionId=${selected.id}`}
            download
          >
            Download specification
          </a>
        </Button>
        {canReview && record.community ? (
          <>
            <Button asChild variant="outline">
              <Link
                href={`${communitySectionHref(record.community.slug, "review", undefined, { profile: selected.profileKey ?? undefined, release: selected.profileReleaseId ?? undefined })}&manage=1&target=${encodeURIComponent(`proposal:${selected.id}`)}`}
              >
                Request feedback
              </Link>
            </Button>
            <ReviewPacketButton
              communitySlug={record.community.slug}
              targets={[`proposal:${selected.id}`]}
            />
          </>
        ) : null}
        {record.community && selected.reviewState === "accepted" ? (
          <Button asChild variant="outline">
            <Link
              href={`${communitySectionHref(record.community.slug, "vocabulary", undefined, { profile: selected.profileKey ?? undefined, release: selected.profileReleaseId ?? undefined })}&standard=working`}
            >
              View community version
            </Link>
          </Button>
        ) : null}
        {userId && isLatest ? (
          <Button
            disabled={busy}
            onClick={() => {
              setError("")
              void revise
                .mutateAsync({ revisionId: selected.id })
                .then((draft) =>
                  window.location.assign(
                    withWorkspaceReturn(`/metadata/workspace/${draft.id}`)
                  )
                )
                .catch((error: unknown) => setError(errorMessage(error)))
            }}
          >
            {revise.isPending ? "Opening draft…" : "Propose a revision"}
          </Button>
        ) : null}
      </div>
      {record.revisions.length > 1 ? (
        <Field className="max-w-xl">
          <FieldLabel htmlFor="published-field-revision">Revision</FieldLabel>
          <WorkspaceSelect
            id="published-field-revision"
            value={selected.id}
            disabled={busy}
            onChange={(event) =>
              router.push(
                withWorkspaceReturn(
                  `/metadata/fields/${record.field.id}?revision=${event.target.value}`
                )
              )
            }
          >
            {record.revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                {revision.profileKey
                  ? `${profileLabel(revision.profileKey)} · `
                  : ""}
                Revision {revision.version} ·{" "}
                {reviewLabels[revision.reviewState] ?? revision.reviewState}
              </option>
            ))}
          </WorkspaceSelect>
        </Field>
      ) : null}
      {!isLatest ? (
        <Alert>
          <AlertTitle>Earlier revision</AlertTitle>
          <AlertDescription>
            A newer proposal exists for this field occurrence. Earlier wording
            and review decisions remain available here.
          </AlertDescription>
        </Alert>
      ) : null}
      {selected.reviewState === "withdrawn" ? (
        <Alert>
          <AlertTitle>This proposal was withdrawn</AlertTitle>
          <AlertDescription>
            Its reference version and history remain available. It is not an
            active proposal.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>The request could not be completed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {isLatest &&
      selected.reviewState !== "withdrawn" &&
      (canReview || canWithdraw) ? (
        <section
          className="flex flex-wrap items-center gap-3"
          aria-label="Proposal decisions"
        >
          {canReview ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setReason("")
                setReviewOpen(true)
              }}
            >
              Record decision
            </Button>
          ) : null}
          {canWithdraw ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setWithdrawReason("")
                setWithdrawOpen(true)
              }}
            >
              Withdraw proposal
            </Button>
          ) : null}
        </section>
      ) : null}
      <Tabs defaultValue={initialTab} className="gap-5">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          <TabsTrigger value="definition" className="min-h-11">
            Definition
          </TabsTrigger>
          <TabsTrigger value="changes" className="min-h-11">
            Changes
          </TabsTrigger>
          <TabsTrigger value="discussion" className="min-h-11">
            Discussion
          </TabsTrigger>
          <TabsTrigger value="sources" className="min-h-11">
            Sources &amp; history
          </TabsTrigger>
        </TabsList>
        <TabsContent value="changes">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Changes</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <h3 className="mb-2 font-medium">Reason for the proposal</h3>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {payload.rationale}
                </p>
              </div>
              {comparison ? (
                <section aria-labelledby="proposal-changes">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h3 id="proposal-changes" className="font-medium">
                      Changes from {comparisonLabel}
                    </h3>
                    {previous && record.baseline ? (
                      <Field className="w-auto">
                        <FieldLabel htmlFor="field-comparison">
                          Compare with
                        </FieldLabel>
                        <WorkspaceSelect
                          id="field-comparison"
                          value={compareReference ? "reference" : "previous"}
                          onChange={(event) =>
                            setCompareReference(
                              event.target.value === "reference"
                            )
                          }
                        >
                          <option value="previous">
                            Revision {previous.version}
                          </option>
                          <option value="reference">Reference</option>
                        </WorkspaceSelect>
                      </Field>
                    ) : null}
                  </div>
                  <FieldChanges differences={differences} />
                </section>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This is a new field proposal.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="definition" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Definition</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="rounded-md border bg-definition p-4 whitespace-pre-wrap break-words leading-relaxed">
                {payload.definition}
              </p>
              {payload.example ? (
                <div>
                  <h3 className="mb-2 font-medium">Example</h3>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {payload.example}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Field specification</h2>
              </CardTitle>
              <CardDescription>
                Rules for this field’s use
                {selected.profileKey
                  ? ` in ${profileLabel(selected.profileKey)}`
                  : " in this vocabulary"}
                . A required child applies within its parent context.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileContext context={record.profileContext} />
              <SpecificationSummary
                specification={payload.specification}
                profileKey={selected.profileKey}
              />
              {record.baseline ? (
                <div className="mt-6">
                  <SpecificationComparison
                    specification={payload.specification}
                    baseline={record.baseline.specification}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="sources" className="flex flex-col gap-6">
          <p className="text-sm text-muted-foreground">
            {payload.citations.length} supporting{" "}
            {payload.citations.length === 1 ? "citation" : "citations"}
            {record.baseline
              ? " · 1 reference version"
              : " · No reference version"}
          </p>
          <SourceBaseline
            baseline={record.baseline}
            sourceRelease={record.sourceRelease}
            sourceOccurrence={record.sourceOccurrence}
          />
          <FieldCitations
            citations={payload.citations}
            hasBaseline={Boolean(record.baseline)}
          />
          <section
            className="min-w-0 space-y-4"
            aria-label="Revision provenance"
          >
            <Button
              variant="outline"
              aria-expanded={showGraph}
              aria-controls="field-provenance-graph"
              onClick={() => setShowGraph((open) => !open)}
            >
              {showGraph ? "Hide provenance graph" : "Show provenance graph"}
            </Button>
            {showGraph ? (
              <div id="field-provenance-graph" className="min-w-0 space-y-3">
                <h3 className="font-medium">
                  Provenance for revision {selected.version}
                </h3>
                <FieldProvenance
                  record={record}
                  revision={selected}
                  differences={differences}
                  comparisonLabel={comparison ? comparisonLabel : null}
                />
              </div>
            ) : null}
          </section>
          <FieldHistory
            history={record.history}
            fieldId={record.field.id}
            revisions={record.revisions}
          />
          <p className="break-all text-xs text-muted-foreground">
            Field identifier: {record.field.id}
            <br />
            Specification revision: {selected.id}
            <br />
            Dictionary definition revision:{" "}
            {selected.definitionRevisionId ?? "No dictionary link"}
          </p>
        </TabsContent>
        <TabsContent value="discussion" className="flex flex-col gap-5">
          <section
            className="flex flex-col gap-4 border-t pt-5"
            aria-labelledby="proposal-discussion"
          >
            <h2 id="proposal-discussion" className="text-xl font-semibold">
              Discussion
            </h2>
            <ol className="flex flex-col gap-4">
              {record.history
                .filter(
                  (event) =>
                    event.revisionId === selected.id &&
                    event.action === "commented"
                )
                .slice()
                .reverse()
                .map((event) => (
                  <li key={event.id} className="border-l-2 pl-4">
                    <p className="text-sm text-muted-foreground">
                      {event.actorName ?? "Contributor"} ·{" "}
                      {formatDateTime(event.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap break-words">
                      {event.detail.reason}
                    </p>
                  </li>
                ))}
            </ol>
            {userId ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (comment.isPending) return
                  setError("")
                  void comment
                    .mutateAsync({ revisionId: selected.id, text: commentText })
                    .then(() => {
                      setCommentText("")
                      router.refresh()
                    })
                    .catch((error) => setError(errorMessage(error)))
                }}
              >
                <Field>
                  <FieldLabel htmlFor="proposal-comment">
                    Add a comment
                  </FieldLabel>
                  <Textarea
                    id="proposal-comment"
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    required
                    maxLength={4000}
                  />
                </Field>
                <Button
                  type="submit"
                  className="w-fit"
                  disabled={comment.isPending || !commentText.trim()}
                >
                  {comment.isPending ? "Posting…" : "Post comment"}
                </Button>
              </form>
            ) : null}
          </section>
        </TabsContent>
      </Tabs>
      <Dialog
        open={reviewOpen}
        onOpenChange={(open) => {
          if (!review.isPending) setReviewOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record decision</DialogTitle>
            <DialogDescription>
              This decision applies to revision {selected.version} only and
              records a community review. Accepted changes appear in the working
              version.
              {record.sourceRelease
                ? " It does not record official MatCore approval."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              if (review.isPending) return
              setError("")
              void review
                .mutateAsync({ revisionId: selected.id, decision, reason })
                .then(() => {
                  setReviewOpen(false)
                  router.refresh()
                })
                .catch((error: unknown) => {
                  setError(errorMessage(error))
                  setReviewOpen(false)
                })
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="field-review-decision">
                  Decision
                </FieldLabel>
                <WorkspaceSelect
                  id="field-review-decision"
                  value={decision}
                  onChange={(event) =>
                    setDecision(event.target.value as typeof decision)
                  }
                >
                  <option value="changes_requested">Request changes</option>
                  <option value="accepted">
                    Accept into community version
                  </option>
                  <option value="declined">Decline</option>
                </WorkspaceSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="field-review-reason">Reason</FieldLabel>
                <Textarea
                  id="field-review-reason"
                  value={reason}
                  required
                  maxLength={4000}
                  rows={4}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={review.isPending}
                onClick={() => setReviewOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={review.isPending}>
                {review.isPending ? "Recording…" : "Record review"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={withdrawOpen}
        onOpenChange={(open) => {
          if (!withdraw.isPending) setWithdrawOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw this proposal?</DialogTitle>
            <DialogDescription>
              The proposal and its history remain available to readers of this
              community, marked as withdrawn.
              {record.baseline
                ? " The reference version remains unchanged."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              if (withdraw.isPending) return
              setError("")
              void withdraw
                .mutateAsync({
                  revisionId: selected.id,
                  reason: withdrawReason
                })
                .then(() => {
                  setWithdrawOpen(false)
                  router.refresh()
                })
                .catch((error: unknown) => {
                  setError(errorMessage(error))
                  setWithdrawOpen(false)
                })
            }}
          >
            <Field>
              <FieldLabel htmlFor="field-withdraw-reason">
                Reason for withdrawal
              </FieldLabel>
              <Textarea
                id="field-withdraw-reason"
                value={withdrawReason}
                required
                maxLength={4000}
                rows={3}
                onChange={(event) => setWithdrawReason(event.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={withdraw.isPending}
                onClick={() => setWithdrawOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={withdraw.isPending}
              >
                {withdraw.isPending ? "Withdrawing…" : "Withdraw proposal"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
