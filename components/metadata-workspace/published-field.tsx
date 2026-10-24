"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { errorMessage, profileLabel } from "./workspace-presenters"
import { WorkspaceSelect } from "./workspace-select"

type Props = {
  record: RouterOutput["matcoreWorkflow"]["getField"]
  userId: number | null
  isAdmin: boolean
  workspaceHref: string
}
const reviewLabels: Record<string, string> = {
  awaiting_review: "Awaiting local review",
  accepted: "Accepted locally",
  changes_requested: "Changes requested",
  declined: "Declined locally",
  withdrawn: "Withdrawn"
}

export function PublishedField({
  record,
  userId,
  isAdmin,
  workspaceHref
}: Props) {
  const router = useRouter()
  const revise = trpc.matcoreWorkflow.revise.useMutation()
  const review = trpc.matcoreWorkflow.review.useMutation()
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
  const busy = revise.isPending || review.isPending || withdraw.isPending
  const canWithdraw = userId === selected.createdById || isAdmin

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={workspaceHref}
        className="w-fit text-sm underline underline-offset-4"
      >
        Community workspace
      </Link>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Metadata field</Badge>
          <Badge variant="secondary">MatSci-SAM proposal</Badge>
          <Badge variant="outline">
            {reviewLabels[selected.reviewState] ?? selected.reviewState}
          </Badge>
        </div>
        <h1 className="break-words text-3xl font-semibold tracking-tight">
          {payload.label}
        </h1>
        <p className="text-sm text-muted-foreground">
          {selected.profileKey ? `${profileLabel(selected.profileKey)} · ` : ""}
          Revision {selected.version} · Published{" "}
          <time dateTime={selected.createdAt}>
            {formatDateTime(selected.createdAt)}
          </time>
          {record.sourceRelease
            ? ` · MatCore ${record.sourceRelease.version} baseline`
            : ""}
        </p>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {selected.profileKey
            ? "This is a local proposal. MatSci-SAM review does not imply approval by the MatCore team or inclusion in an official MatCore release."
            : "This field is a community proposal. Its review status and revision history are recorded separately from its definition."}
        </p>
      </header>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link
            href={termPath(record.field.termSlug, record.field.vocabularySlug)}
          >
            View dictionary entry
          </Link>
        </Button>
        <Button asChild variant="outline">
          <a
            href={`/api/metadata/fields/${record.field.id}?revisionId=${selected.id}`}
            download
          >
            Download specification
          </a>
        </Button>
        {userId && isLatest ? (
          <Button
            disabled={busy}
            onClick={() => {
              setError("")
              void revise
                .mutateAsync({ revisionId: selected.id })
                .then((draft) =>
                  window.location.assign(`/metadata/workspace/${draft.id}`)
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
                `/metadata/fields/${record.field.id}?revision=${event.target.value}`
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
            Its source baseline and recorded history remain available. It is not
            an active proposal.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>The request could not be completed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Tabs defaultValue="definition" className="gap-5">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          <TabsTrigger value="definition" className="min-h-10">
            Definition
          </TabsTrigger>
          <TabsTrigger value="specification" className="min-h-10">
            Field specification
          </TabsTrigger>
          <TabsTrigger value="sources" className="min-h-10">
            Sources &amp; history
          </TabsTrigger>
        </TabsList>
        <TabsContent value="definition">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Definition</h2>
              </CardTitle>
              <CardDescription>
                Explanatory wording pinned to this specification revision.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="rounded-md border bg-definition p-4 whitespace-pre-wrap break-words leading-relaxed">
                {payload.definition}
              </p>
              <SpecificationSummary
                specification={payload.specification}
                profileKey={selected.profileKey}
                compact
              />
              {payload.example ? (
                <div>
                  <h3 className="mb-2 font-medium">Example</h3>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {payload.example}
                  </p>
                </div>
              ) : null}
              <div>
                <h3 className="mb-2 font-medium">Reason for the proposal</h3>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {payload.rationale}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="specification">
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
              ? " · 1 preserved MatCore source baseline"
              : " · No imported source baseline"}
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
          <FieldHistory history={record.history} />
          <p className="break-all text-xs text-muted-foreground">
            Field identifier: {record.field.id}
            <br />
            Specification revision: {selected.id}
            <br />
            Pinned definition revision: {selected.definitionRevisionId}
          </p>
        </TabsContent>
      </Tabs>
      {isLatest &&
      selected.reviewState !== "withdrawn" &&
      (isAdmin || canWithdraw) ? (
        <section
          className="flex flex-wrap items-center gap-3 border-t pt-5"
          aria-label="Proposal decisions"
        >
          {isAdmin ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setReason("")
                setReviewOpen(true)
              }}
            >
              Record local review
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
      <Dialog
        open={reviewOpen}
        onOpenChange={(open) => {
          if (!review.isPending) setReviewOpen(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a local review</DialogTitle>
            <DialogDescription>
              This decision applies to revision {selected.version} only and
              records MatSci-SAM administrator review.
              {selected.profileKey
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
                  <option value="accepted">Accept locally</option>
                  <option value="declined">Decline locally</option>
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
              {record.baseline ? " The source baseline remains unchanged." : ""}
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
