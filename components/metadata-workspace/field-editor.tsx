"use client"

import Link from "next/link"
import { CommunityWorkReturnLink } from "@/components/community-work-return-link"
import {
  matcoreCatalogHref,
  normalizeMatcoreCatalogReturnTo
} from "@/lib/matcore-catalog-navigation"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { ArrowLeftIcon, SaveIcon } from "lucide-react"
import { trpc } from "@/trpc/client"
import { matcorePublicationPayloadSchema } from "@/lib/matcore-workflow-types"
import {
  DEFINITION_MAX_LENGTH,
  EXAMPLE_MAX_LENGTH,
  TERM_MAX_LENGTH
} from "@/lib/input-limits"
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { FieldCitations } from "./field-citations"
import { FieldSpecification, SpecificationSummary } from "./field-specification"
import { FieldRuleControls } from "./field-rule-controls"
import { FieldHistory, ProfileContext, SourceBaseline } from "./source-history"
import {
  errorMessage,
  profileLabel,
  proposalDifferences
} from "./workspace-presenters"
import { useFieldDraft, type FieldDraftRecord } from "./use-field-draft"

export function FieldEditor({
  initial,
  workspaceHref,
  workspaceLabel = "My field drafts"
}: {
  initial: FieldDraftRecord
  workspaceHref: string
  workspaceLabel?: string
}) {
  const draft = useFieldDraft(initial)
  const router = useRouter()
  const publish = trpc.matcoreWorkflow.publish.useMutation()
  const [review, setReview] = useState(false)
  const [confirmReload, setConfirmReload] = useState(false)
  const [validation, setValidation] = useState<string[]>([])
  const [publicationError, setPublicationError] = useState("")
  const [savingForReview, setSavingForReview] = useState(false)
  const payload = draft.payload
  const record = draft.record
  const published = record.status === "published"
  const differences = proposalDifferences(payload, record.baseline)
  const busy =
    !draft.ready || draft.reloading || publish.isPending || savingForReview
  function set<K extends keyof typeof payload>(
    key: K,
    value: (typeof payload)[K]
  ) {
    setValidation([])
    setPublicationError("")
    draft.setPayload({ ...payload, [key]: value })
  }
  async function openReview() {
    const checked = matcorePublicationPayloadSchema.safeParse(payload)
    if (!checked.success) {
      setValidation([
        ...new Set(checked.error.issues.map((issue) => issue.message))
      ])
      return
    }
    setSavingForReview(true)
    try {
      await draft.flush()
      setReview(true)
    } catch {
      /* The save status explains recovery. */
    } finally {
      setSavingForReview(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="self-start">
        <CommunityWorkReturnLink href={workspaceHref}>
          <ArrowLeftIcon data-icon="inline-start" aria-hidden />
          {workspaceLabel}
        </CommunityWorkReturnLink>
      </Button>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Metadata field</Badge>
          <Badge variant="secondary">
            {published ? "Published local proposal" : "Private draft"}
          </Badge>
          {record.profileKey ? (
            <Badge variant="outline">{profileLabel(record.profileKey)}</Badge>
          ) : null}
        </div>
        <h1 className="break-words text-3xl font-semibold tracking-tight">
          {payload.label || "New metadata field"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {record.sourceRelease
            ? `Source baseline: MatCore ${record.sourceRelease.version}. `
            : "Community field proposal. "}
          {record.profileKey
            ? "Local proposals are separate from official MatCore decisions."
            : "Define what to record and the rules for its values."}
        </p>
        {record.community &&
        record.profileReleaseId &&
        record.sourceOccurrenceId &&
        !normalizeMatcoreCatalogReturnTo(workspaceHref) ? (
          <CommunityWorkReturnLink
            className="w-fit text-sm underline underline-offset-4"
            href={matcoreCatalogHref(record.community.slug, {
              releaseId: record.profileReleaseId,
              source: record.sourceOccurrenceId
            })}
          >
            View preserved source entry
          </CommunityWorkReturnLink>
        ) : null}
      </header>

      <div
        className="flex flex-wrap items-center gap-3 text-sm"
        aria-live="polite"
      >
        <p role={draft.error ? "alert" : "status"}>
          {!draft.ready
            ? "Loading the editor…"
            : draft.error
              ? `${errorMessage(draft.error)} Your writing is still here.`
              : draft.recovered
                ? "Recovered unsaved changes from this tab; save to your account."
                : published
                  ? "This proposal has been published."
                  : draft.reloading
                    ? "Loading the saved draft…"
                    : draft.saving
                      ? "Saving draft…"
                      : draft.dirty
                        ? "Unsaved changes"
                        : "Draft saved to your account"}
        </p>
        {draft.error && !draft.conflict ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void draft.retry().catch(() => {})}
          >
            Retry save
          </Button>
        ) : null}
        {!published || draft.recovered ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={draft.saving || busy}
            onClick={() => setConfirmReload(true)}
          >
            Reload saved draft
          </Button>
        ) : null}
      </div>
      {draft.recoveryWarning ? (
        <Alert>
          <AlertTitle>Draft recovery</AlertTitle>
          <AlertDescription>{draft.recoveryWarning}</AlertDescription>
        </Alert>
      ) : null}
      {draft.recovered && draft.conflict ? (
        <p className="text-sm text-muted-foreground">
          Recovered unsaved changes from this tab. They have not replaced the
          account’s saved version.
        </p>
      ) : null}
      {draft.conflict ? (
        <Alert>
          <AlertTitle>A newer saved version is available</AlertTitle>
          <AlertDescription>
            Copy any writing you want to keep, then reload the saved draft. Your
            current writing will remain here until you choose to replace it.
          </AlertDescription>
        </Alert>
      ) : null}
      {published && draft.recovered ? (
        <Field>
          <FieldLabel htmlFor="recovered-field-writing">
            Recovered unsaved proposal
          </FieldLabel>
          <FieldDescription>
            This draft was published in another tab. Copy the writing you want
            to keep before reloading the published version; it has not been
            added to that proposal.
          </FieldDescription>
          <Textarea
            id="recovered-field-writing"
            readOnly
            value={JSON.stringify(payload, null, 2)}
            rows={10}
          />
        </Field>
      ) : null}
      {published && record.publication ? (
        <Button asChild className="self-start">
          <Link
            href={`/metadata/fields/${record.publication.fieldId}?revision=${record.publication.revisionId}`}
          >
            View published proposal
          </Link>
        </Button>
      ) : null}

      <fieldset disabled={published || busy} className="min-w-0">
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
                  <h2>Explain the field</h2>
                </CardTitle>
                <CardDescription>
                  Define what this field records and how its values are
                  structured.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="field-label">Field label</FieldLabel>
                    <Input
                      id="field-label"
                      value={payload.label}
                      maxLength={TERM_MAX_LENGTH}
                      onChange={(event) => set("label", event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="field-definition">
                      Definition
                    </FieldLabel>
                    <Textarea
                      id="field-definition"
                      className="min-h-40 bg-definition"
                      rows={6}
                      value={payload.definition}
                      maxLength={DEFINITION_MAX_LENGTH}
                      onChange={(event) =>
                        set("definition", event.target.value)
                      }
                    />
                  </Field>
                  <FieldRuleControls
                    specification={payload.specification}
                    profileKey={record.profileKey}
                    baseline={record.baseline?.specification}
                    onChange={(value) => set("specification", value)}
                  />
                  <Field>
                    <FieldLabel htmlFor="field-example">Example</FieldLabel>
                    <Textarea
                      id="field-example"
                      rows={2}
                      value={payload.example}
                      maxLength={EXAMPLE_MAX_LENGTH}
                      onChange={(event) => set("example", event.target.value)}
                    />
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="specification">
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Specify the value rules</h2>
                </CardTitle>
                <CardDescription>
                  Rules apply to this field’s use
                  {record.profileKey
                    ? ` in ${profileLabel(record.profileKey)}`
                    : " in this vocabulary"}
                  . Preserve unknown rules as not specified.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProfileContext context={record.profileContext} />
                <FieldSpecification
                  baseline={record.baseline?.specification}
                  specification={payload.specification}
                  profileKey={record.profileKey}
                  onChange={(value) => set("specification", value)}
                />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="sources" className="flex flex-col gap-6">
            <SourceBaseline
              baseline={record.baseline}
              sourceRelease={record.sourceRelease}
              sourceOccurrence={record.sourceOccurrence}
            />
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Proposal evidence</h2>
                </CardTitle>
                <CardDescription>
                  Supporting sources for your changes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldCitations
                  citations={payload.citations}
                  hasBaseline={Boolean(record.baseline)}
                  onChange={
                    published ? undefined : (value) => set("citations", value)
                  }
                />
              </CardContent>
            </Card>
            <FieldHistory history={record.history} />
          </TabsContent>
        </Tabs>
        <Field className="mt-6">
          <FieldLabel htmlFor="field-rationale">
            Reason for this proposal
          </FieldLabel>
          <Textarea
            id="field-rationale"
            rows={3}
            maxLength={4000}
            value={payload.rationale}
            onChange={(event) => set("rationale", event.target.value)}
          />
          <FieldDescription>
            Explain the purpose of this field or the changes you are proposing.
            This rationale is included with the published proposal.
          </FieldDescription>
        </Field>
      </fieldset>

      {validation.length ? (
        <Alert variant="destructive">
          <AlertTitle>Review these details before publishing</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {validation.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {publicationError ? (
        <Alert variant="destructive">
          <AlertTitle>The proposal could not be published</AlertTitle>
          <AlertDescription>
            {publicationError} Your draft is still saved.
          </AlertDescription>
        </Alert>
      ) : null}
      {!published ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <p className="max-w-md text-sm text-muted-foreground">
            Drafts are private. Publishing makes this proposal, its citations
            and revision history available to readers of this community.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || draft.saving || draft.conflict}
              onClick={() => void draft.flush().catch(() => {})}
            >
              <SaveIcon data-icon="inline-start" aria-hidden />
              Save draft
            </Button>
            <Button
              type="button"
              disabled={busy || draft.conflict}
              onClick={() => void openReview()}
            >
              {savingForReview ? "Saving…" : "Review proposal"}
            </Button>
          </div>
        </footer>
      ) : null}

      <Dialog open={confirmReload} onOpenChange={setConfirmReload}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reload the saved draft?</DialogTitle>
            <DialogDescription>
              Unsaved writing in this editor will be replaced by the latest
              saved version. Copy anything you want to keep first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReload(false)}>
              Keep editing
            </Button>
            <Button
              onClick={() => {
                setConfirmReload(false)
                void draft.reload()
              }}
            >
              Reload saved draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={review}
        onOpenChange={(open) => {
          if (!publish.isPending) setReview(open)
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review local proposal</DialogTitle>
            <DialogDescription>
              The definition and field specification will be published together.
              {record.baseline
                ? " The preserved source baseline will not change."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5">
            <section>
              <h3 className="mb-2 font-semibold">{payload.label}</h3>
              <p className="rounded-md border bg-definition p-4 whitespace-pre-wrap break-words text-sm">
                {payload.definition}
              </p>
              {payload.example ? (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                  Example: {payload.example}
                </p>
              ) : null}
            </section>
            <SpecificationSummary
              specification={payload.specification}
              profileKey={record.profileKey}
            />
            {record.baseline ? (
              <section>
                <h3 className="mb-2 font-semibold">
                  Changes from the source baseline
                </h3>
                {differences.length ? (
                  <dl className="flex flex-col gap-3">
                    {differences.map((difference) => (
                      <div
                        key={difference.label}
                        className="rounded-md border p-3 text-sm"
                      >
                        <dt className="font-medium">{difference.label}</dt>
                        <dd className="mt-2 flex flex-col gap-2 whitespace-pre-wrap break-words">
                          <p>
                            <span className="text-muted-foreground">
                              Baseline:{" "}
                            </span>
                            {difference.before || "Not specified"}
                          </p>
                          <p>
                            <span className="text-muted-foreground">
                              Proposal:{" "}
                            </span>
                            {difference.after || "Not specified"}
                          </p>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No wording or rule changes from the imported baseline.
                  </p>
                )}
              </section>
            ) : null}
            <p className="text-sm">
              {payload.citations.length} supporting{" "}
              {payload.citations.length === 1 ? "citation" : "citations"}
              {record.baseline
                ? " and one preserved MatCore source baseline"
                : ""}
              .
            </p>
            <Alert>
              <AlertDescription>
                Publishing shares this proposal with readers of this community.
                {record.profileKey
                  ? " It does not record MatCore approval."
                  : ""}{" "}
                A site administrator can record a separate local review.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={publish.isPending}
              onClick={() => setReview(false)}
            >
              Back to editing
            </Button>
            <Button
              disabled={publish.isPending}
              onClick={() => {
                setPublicationError("")
                void draft
                  .flush()
                  .then((saved) => {
                    if (!saved)
                      throw new Error("Save the draft before publishing.")
                    return publish.mutateAsync({
                      id: saved.id,
                      expectedVersion: saved.version
                    })
                  })
                  .then((result) => {
                    draft.stop()
                    router.push(
                      `/metadata/fields/${result.fieldId}?revision=${result.revisionId}`
                    )
                  })
                  .catch((error: unknown) => {
                    setPublicationError(errorMessage(error))
                    setReview(false)
                  })
              }}
            >
              {publish.isPending ? "Publishing…" : "Publish local proposal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
