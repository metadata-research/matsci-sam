"use client"

import { useId, useState, type ComponentProps, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/date"
import type { MetadataFieldKey } from "@/lib/dictionary-metadata"
import { revisionPath } from "@/lib/public-identifiers"
import { lit } from "@/lib/rdf-literal"
import type { TermMetadataRecord } from "@/lib/term-metadata"
import { trpc } from "@/trpc/client"

type Assertion = TermMetadataRecord["assertions"][number]

function MetadataSelect(props: ComponentProps<"select">) {
  return (
    <select
      className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      {...props}
    />
  )
}

function scopeOf(
  record: TermMetadataRecord,
  revisionId: number | null,
  advanced: boolean
) {
  if (revisionId === null)
    return { label: "Whole term", iri: record.term.iri, href: null }
  for (const definition of record.definitions) {
    const revision = definition.revisions.find((item) => item.id === revisionId)
    if (revision)
      return {
        label: `Definition ${definition.definitionNumber}${advanced ? ` · Revision ${revision.version}` : ""}${revision.isCurrent ? "" : " (earlier wording)"}`,
        iri: revision.iri,
        href: revisionPath(
          record.term.slug,
          definition.definitionNumber,
          revision.version,
          record.term.vocabularySlug
        )
      }
  }
  return { label: "Earlier definition revision", iri: null, href: null }
}

const statusLabel = (status: Assertion["status"]) =>
  status === "accepted"
    ? "Published"
    : status === "proposed"
      ? "Awaiting review"
      : "Not accepted"

function AssertionList({
  record,
  assertions,
  advanced,
  busy,
  onReview,
  onRetract
}: {
  record: TermMetadataRecord
  assertions: Assertion[]
  advanced: boolean
  busy: boolean
  onReview: (id: string, decision: "accept" | "reject") => void
  onRetract: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {assertions.map((assertion) => {
        const field = record.fields.find(
          (item) => item.key === assertion.fieldKey
        )
        const catalog = record.catalogFields.find(
          (item) => item.iri === assertion.value
        )
        const scope = scopeOf(record, assertion.definitionRevisionId, advanced)
        const object =
          assertion.valueType === "iri"
            ? `<${assertion.value}>`
            : `${lit(assertion.value)}${assertion.language ? `@${assertion.language}` : ""}`
        return (
          <article
            key={assertion.id}
            className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">
                {field?.label ?? assertion.fieldKey}
              </h3>
              <Badge variant="outline">
                {assertion.retractedAt
                  ? "Withdrawn"
                  : statusLabel(assertion.status)}
              </Badge>
            </div>
            {catalog ? (
              <Link
                href={catalog.path}
                className="break-words text-primary underline"
              >
                {catalog.label}
              </Link>
            ) : assertion.valueType === "iri" ? (
              <a
                href={assertion.value}
                target="_blank"
                rel="noreferrer"
                className="break-words text-primary underline"
              >
                {assertion.value}
              </a>
            ) : (
              <p className="whitespace-pre-wrap break-words leading-relaxed">
                {assertion.value}
              </p>
            )}
            {catalog ? (
              <p className="text-xs text-muted-foreground">
                {catalog.profileLabel} · {catalog.sourceVersion}
                {catalog.status === "proposed" ? " · Proposed field" : ""}
              </p>
            ) : null}
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <p>
                {scope.href ? (
                  <Link href={scope.href} className="underline">
                    {scope.label}
                  </Link>
                ) : (
                  scope.label
                )}
              </p>
              <p>
                Added by {assertion.assertedByName ?? "Contributor"} ·{" "}
                {formatDateTime(assertion.createdAt)}
              </p>
              {assertion.sourceIri ? (
                <p>
                  Source:{" "}
                  <a
                    href={assertion.sourceIri}
                    target="_blank"
                    rel="noreferrer"
                    className="break-words text-primary underline"
                  >
                    {assertion.sourceLabel ?? assertion.sourceIri}
                  </a>
                  {assertion.sourceVersion
                    ? ` · ${assertion.sourceVersion}`
                    : ""}
                </p>
              ) : assertion.sourceLabel ? (
                <p>
                  Source: {assertion.sourceLabel}
                  {assertion.sourceVersion
                    ? ` · ${assertion.sourceVersion}`
                    : ""}
                </p>
              ) : null}
              {assertion.reviewedAt ? (
                <p>Reviewed {formatDateTime(assertion.reviewedAt)}</p>
              ) : null}
              {assertion.retractedAt ? (
                <p>Withdrawn {formatDateTime(assertion.retractedAt)}</p>
              ) : null}
            </div>
            {advanced && scope.iri && field ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  View semantic statement
                </summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3">{`<${scope.iri}>\n  <${field.predicateIri}>\n  ${object} .`}</pre>
                <p className="mt-2 text-muted-foreground">
                  {assertion.status === "accepted" && !assertion.retractedAt
                    ? "This accepted statement is included in the published metadata."
                    : "This statement is not part of the current published metadata."}
                </p>
              </details>
            ) : null}
            {assertion.canReview || assertion.canRetract ? (
              <div className="flex flex-wrap gap-2">
                {assertion.canReview ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => onReview(assertion.id, "accept")}
                    >
                      Accept
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onReview(assertion.id, "reject")}
                    >
                      Decline
                    </Button>
                  </>
                ) : null}
                {assertion.canRetract ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onRetract(assertion.id)}
                  >
                    Withdraw
                  </Button>
                ) : null}
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

export function MetadataEditor({
  initialRecord
}: {
  initialRecord: TermMetadataRecord
}) {
  const id = useId()
  const router = useRouter()
  const utils = trpc.useUtils()
  const { data: record } = trpc.termMetadata.get.useQuery(
    { termId: initialRecord.term.id },
    { initialData: initialRecord }
  )
  const [view, setView] = useState("simple")
  const [fieldKey, setFieldKey] = useState<MetadataFieldKey>("usageNote")
  const [scope, setScope] = useState("")
  const [value, setValue] = useState("")
  const [sourceIri, setSourceIri] = useState("")
  const [sourceLabel, setSourceLabel] = useState("")
  const [sourceVersion, setSourceVersion] = useState("")
  const [language, setLanguage] = useState("en")
  const [error, setError] = useState<string | null>(null)
  const advanced = view === "advanced"
  const field = record.fields.find((item) => item.key === fieldKey)!
  const fieldOptions = record.fields.filter(
    (item) => advanced || !item.advanced || item.key === fieldKey
  )
  const catalogField = record.catalogFields.find((item) => item.iri === value)
  const catalogValue =
    fieldKey === "usedAsValueFor" || fieldKey === "describesMetadataField"
  const currentRevisions = record.definitions.flatMap((definition) =>
    definition.revisions
      .filter((revision) => revision.isCurrent || String(revision.id) === scope)
      .map((revision) => ({
        ...revision,
        definitionNumber: definition.definitionNumber
      }))
  )

  const refresh = async () => {
    await utils.termMetadata.get.invalidate({ termId: record.term.id })
    router.refresh()
  }
  const add = trpc.termMetadata.add.useMutation({
    onSuccess: async () => {
      setValue("")
      setSourceIri("")
      setSourceLabel("")
      setSourceVersion("")
      setError(null)
      toast.success(
        record.permissions.isAdmin
          ? "Metadata published"
          : "Metadata submitted for review"
      )
      await refresh()
    },
    onError: (failure) => setError(failure.message)
  })
  const review = trpc.termMetadata.review.useMutation({
    onSuccess: async () => {
      setError(null)
      await refresh()
    },
    onError: (failure) => setError(failure.message)
  })
  const retract = trpc.termMetadata.retract.useMutation({
    onSuccess: async () => {
      setError(null)
      toast.success("Metadata withdrawn")
      await refresh()
    },
    onError: (failure) => setError(failure.message)
  })
  const busy = add.isPending || review.isPending || retract.isPending
  const assertionProps = {
    record,
    advanced,
    busy,
    onReview: (assertionId: string, decision: "accept" | "reject") =>
      review.mutate({ id: assertionId, decision }),
    onRetract: (assertionId: string) => retract.mutate({ id: assertionId })
  }
  const published = record.assertions.filter(
    (assertion) => assertion.status === "accepted"
  )
  const proposals = record.assertions.filter(
    (assertion) => assertion.status !== "accepted"
  )

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !scope || !value.trim()) return
    setError(null)
    add.mutate({
      termId: record.term.id,
      definitionRevisionId: scope === "term" ? undefined : Number(scope),
      fieldKey,
      value: value.trim(),
      language:
        field.valueType === "text" ? language.trim() || undefined : undefined,
      sourceIri: sourceIri.trim() || undefined,
      sourceLabel: sourceLabel.trim() || undefined,
      sourceVersion: sourceVersion.trim() || undefined
    })
  }

  return (
    <Tabs value={view} onValueChange={setView} className="flex flex-col gap-5">
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs font-medium text-muted-foreground">View</span>
        <TabsList aria-label="Metadata view">
          <TabsTrigger value="simple">Simple</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value={view} forceMount className="m-0 flex flex-col gap-5">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Published metadata</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {published.length ? (
              <AssertionList assertions={published} {...assertionProps} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No additional metadata has been published.
              </p>
            )}
          </CardContent>
        </Card>
        {proposals.length ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>
                  {record.permissions.isAdmin
                    ? "Contributor proposals"
                    : "Your proposals"}
                </h2>
              </CardTitle>
              <CardDescription>
                These are separate from published metadata until accepted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AssertionList assertions={proposals} {...assertionProps} />
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Add metadata</h2>
            </CardTitle>
            <CardDescription>
              {record.permissions.isAdmin
                ? "Your addition will be public immediately."
                : "An administrator reviews your contribution before publication."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {record.permissions.canPropose ? (
              <form onSubmit={submit}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={`${id}-scope`}>
                      What does this describe?
                    </FieldLabel>
                    <MetadataSelect
                      id={`${id}-scope`}
                      aria-describedby={`${id}-scope-help`}
                      value={scope}
                      onChange={(event) => setScope(event.target.value)}
                      required
                      disabled={busy}
                    >
                      <option value="" disabled>
                        Choose the term or a definition
                      </option>
                      <option value="term">The whole term</option>
                      {currentRevisions.map((revision) => (
                        <option key={revision.id} value={revision.id}>
                          Definition {revision.definitionNumber}
                          {advanced ? ` · Revision ${revision.version}` : ""}
                          {revision.isCurrent ? "" : " (earlier wording)"}
                        </option>
                      ))}
                    </MetadataSelect>
                    <FieldDescription id={`${id}-scope-help`}>
                      A description of one definition stays with that revision
                      when its wording changes.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${id}-field`}>
                      Add a description
                    </FieldLabel>
                    <MetadataSelect
                      id={`${id}-field`}
                      aria-describedby={`${id}-field-help`}
                      value={fieldKey}
                      disabled={busy}
                      onChange={(event) => {
                        setFieldKey(event.target.value as MetadataFieldKey)
                        setValue("")
                        setError(null)
                      }}
                    >
                      {fieldOptions.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label}
                        </option>
                      ))}
                    </MetadataSelect>
                    <FieldDescription id={`${id}-field-help`}>
                      {field.description}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${id}-value`}>
                      {catalogValue
                        ? "Metadata field"
                        : fieldKey === "relatedConcept"
                          ? "Concept link"
                          : fieldKey === "alternateLabel"
                            ? "Alternative name"
                            : "Usage guidance"}
                    </FieldLabel>
                    {catalogValue ? (
                      <MetadataSelect
                        id={`${id}-value`}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        disabled={busy}
                        required
                      >
                        <option value="" disabled>
                          Choose a metadata field
                        </option>
                        {Array.from(
                          new Set(
                            record.catalogFields.map((item) => item.profileKey)
                          )
                        ).map((profileKey) => (
                          <optgroup
                            key={profileKey}
                            label={
                              record.catalogFields.find(
                                (item) => item.profileKey === profileKey
                              )!.profileLabel
                            }
                          >
                            {record.catalogFields
                              .filter((item) => item.profileKey === profileKey)
                              .map((item) => (
                                <option key={item.iri} value={item.iri}>
                                  {item.label}
                                  {item.status === "proposed"
                                    ? " (proposed)"
                                    : ""}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </MetadataSelect>
                    ) : fieldKey === "usageNote" ? (
                      <Textarea
                        id={`${id}-value`}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        disabled={busy}
                        required
                        maxLength={4000}
                        rows={4}
                        placeholder="Explain when and how this term should be used."
                      />
                    ) : (
                      <Input
                        id={`${id}-value`}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        disabled={busy}
                        required
                        type={field.valueType === "iri" ? "url" : "text"}
                        maxLength={field.valueType === "iri" ? 2048 : 240}
                        placeholder={
                          field.valueType === "iri"
                            ? "https://…"
                            : "Another name for this term"
                        }
                      />
                    )}
                    {catalogField ? (
                      <FieldDescription>
                        <span className="block">
                          {catalogField.description}
                        </span>
                        {catalogField.valueGuidance ? (
                          <span className="mt-1 block">
                            {catalogField.valueGuidance}
                          </span>
                        ) : null}
                        <span className="mt-2 block">
                          Field source:{" "}
                          <a
                            href={catalogField.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            {catalogField.sourceVersion}
                          </a>
                          {catalogField.status === "proposed"
                            ? " · Proposed extension"
                            : " · Preliminary snapshot"}
                          . Add evidence for your contribution under Source
                          (optional).
                        </span>
                      </FieldDescription>
                    ) : null}
                  </Field>
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      Source (optional)
                    </summary>
                    <FieldGroup className="mt-4">
                      <Field>
                        <FieldLabel htmlFor={`${id}-source-label`}>
                          Source name or citation
                        </FieldLabel>
                        <Input
                          id={`${id}-source-label`}
                          value={sourceLabel}
                          onChange={(event) =>
                            setSourceLabel(event.target.value)
                          }
                          disabled={busy}
                          maxLength={200}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`${id}-source-link`}>
                          Source link
                        </FieldLabel>
                        <Input
                          id={`${id}-source-link`}
                          value={sourceIri}
                          onChange={(event) => setSourceIri(event.target.value)}
                          disabled={busy}
                          type="url"
                          maxLength={2048}
                          placeholder="https://…"
                        />
                      </Field>
                      {advanced ? (
                        <Field>
                          <FieldLabel htmlFor={`${id}-source-version`}>
                            Source version
                          </FieldLabel>
                          <Input
                            id={`${id}-source-version`}
                            value={sourceVersion}
                            onChange={(event) =>
                              setSourceVersion(event.target.value)
                            }
                            disabled={busy}
                            maxLength={200}
                          />
                        </Field>
                      ) : null}
                    </FieldGroup>
                  </details>
                  {advanced && field.valueType === "text" ? (
                    <Field>
                      <FieldLabel htmlFor={`${id}-language`}>
                        Text language
                      </FieldLabel>
                      <Input
                        id={`${id}-language`}
                        value={language}
                        onChange={(event) => setLanguage(event.target.value)}
                        disabled={busy}
                        maxLength={35}
                        placeholder="en"
                      />
                      <FieldDescription>
                        Use a language tag such as en or de.
                      </FieldDescription>
                    </Field>
                  ) : null}
                  {advanced ? (
                    <p className="break-all text-xs text-muted-foreground">
                      Property: <code>{field.predicateIri}</code>
                    </p>
                  ) : null}
                  <div>
                    <Button
                      type="submit"
                      disabled={busy || !scope || !value.trim()}
                    >
                      {add.isPending
                        ? "Saving…"
                        : record.permissions.isAdmin
                          ? "Publish metadata"
                          : "Submit for review"}
                    </Button>
                  </div>
                </FieldGroup>
              </form>
            ) : record.permissions.blockedReason === "retired" ? (
              <p className="text-sm text-muted-foreground">
                This vocabulary is retired. Its metadata remains available to
                read.
              </p>
            ) : record.permissions.blockedReason === "profile_required" ? (
              <p className="text-sm text-muted-foreground">
                <Link href="/profile" className="text-primary underline">
                  Complete your profile
                </Link>{" "}
                to contribute attributed metadata.
              </p>
            ) : record.permissions.blockedReason === "ai_account" ? (
              <p className="text-sm text-muted-foreground">
                Sign in with a contributor account to add metadata.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                <Link
                  href={`/login?returnTo=${encodeURIComponent(`/terms/${record.term.id}/metadata`)}`}
                  className="text-primary underline"
                >
                  Sign in
                </Link>{" "}
                to contribute metadata.
              </p>
            )}
          </CardContent>
        </Card>
        {advanced && record.history.length ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Metadata history</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <details>
                <summary className="cursor-pointer text-sm">
                  Show {record.history.length} withdrawn{" "}
                  {record.history.length === 1
                    ? "contribution"
                    : "contributions"}
                </summary>
                <div className="mt-4">
                  <AssertionList
                    assertions={record.history}
                    {...assertionProps}
                  />
                </div>
              </details>
            </CardContent>
          </Card>
        ) : null}
      </TabsContent>
    </Tabs>
  )
}
