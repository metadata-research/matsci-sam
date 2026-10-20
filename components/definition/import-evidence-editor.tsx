"use client"

import { useId } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type {
  DeclaredImportSource,
  ImportEvidence
} from "@/lib/import-draft-types"
import type { DraftContributionFile } from "./contribution-files"

const emptySource: DeclaredImportSource = {
  title: "",
  creator: "",
  url: "",
  version: "",
  license: ""
}

function Decision({
  value,
  disabled,
  label,
  onChange
}: {
  value: "pending" | "include" | "omit"
  disabled?: boolean
  label: string
  onChange: (value: "pending" | "include" | "omit") => void
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span>{label}</span>
      <select
        aria-label={label}
        className="h-9 rounded-md border bg-background px-3"
        disabled={disabled}
        value={value}
        onChange={(event) =>
          onChange(event.target.value as "pending" | "include" | "omit")
        }
      >
        <option value="pending">Needs review</option>
        <option value="include">Include with publication</option>
        <option value="omit">Leave out of publication</option>
      </select>
    </label>
  )
}

function SourceFields({
  source,
  disabled,
  onChange
}: {
  source: DeclaredImportSource
  disabled?: boolean
  onChange: (next: DeclaredImportSource) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(
        [
          ["title", "Source title", 1000],
          ["creator", "Original creator or organization", 1000],
          ["url", "Source URL", 2048],
          ["version", "Source version or date", 200],
          ["license", "Licence", 1000]
        ] as const
      ).map(([field, label, maxLength]) => (
        <label key={field} className="grid gap-1 text-sm">
          {label}
          <Input
            disabled={disabled}
            value={source[field]}
            maxLength={maxLength}
            onChange={(event) =>
              onChange({ ...source, [field]: event.target.value })
            }
          />
        </label>
      ))}
    </div>
  )
}

/** Imported evidence is saved in the same draft payload and version as the writing. */
export function ImportEvidenceEditor({
  value,
  onChange,
  files,
  disabled
}: {
  value: ImportEvidence
  onChange: (next: ImportEvidence) => void
  files: DraftContributionFile[]
  disabled?: boolean
}) {
  const id = useId()
  const pending = [
    ...(value.origin ? [value.origin] : []),
    ...value.citations,
    ...value.ontology,
    ...(value.scopeNote ? [value.scopeNote] : []),
    ...value.sourceKeys
  ].filter((item) => item.decision === "pending").length

  return (
    <details
      className="rounded-lg border p-4"
      open={pending > 0 ? true : undefined}
    >
      <summary className="cursor-pointer font-medium">
        Imported sources and ontology references
        {pending ? ` · ${pending} need review` : ""}
      </summary>
      <div className="mt-4 space-y-6">
        <p className="text-sm text-muted-foreground">
          Review each supplied item or leave it out explicitly. These details
          describe the source of your wording; they do not mean MatSci-SAM
          retrieved it or sent it to an assistant. Changes save with this draft.
        </p>
        <section aria-labelledby={`${id}-original`} className="space-y-3">
          <h3 id={`${id}-original`} className="font-medium">
            Original imported wording
          </h3>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={value.publishOriginalWording ?? false}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...value,
                  publishOriginalWording: event.target.checked
                })
              }
            />
            Include original wording in public provenance
          </label>
          <p className="text-sm text-muted-foreground">
            Leave this unchecked to keep the original import record private. The
            current definition you publish is still public. You can compare the
            original and current wording in the publication review.
          </p>
        </section>
        <section aria-labelledby={`${id}-origin`} className="space-y-3">
          <h3 id={`${id}-origin`} className="font-medium">
            Origin of imported wording
          </h3>
          {value.origin ? (
            <>
              <SourceFields
                source={value.origin}
                disabled={disabled}
                onChange={(source) =>
                  onChange({
                    ...value,
                    origin: { ...source, decision: "pending" }
                  })
                }
              />
              <Decision
                label="Origin attribution"
                value={value.origin.decision}
                disabled={disabled}
                onChange={(decision) =>
                  onChange({ ...value, origin: { ...value.origin!, decision } })
                }
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || value.citations.length >= 20}
                onClick={() =>
                  onChange({
                    ...value,
                    citations: [
                      ...value.citations,
                      {
                        ...value.origin!,
                        id: crypto.randomUUID(),
                        decision: "pending"
                      }
                    ]
                  })
                }
              >
                Also add as a citation
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...value,
                  origin: { ...emptySource, decision: "pending" }
                })
              }
            >
              Add origin attribution
            </Button>
          )}
        </section>
        <section aria-labelledby={`${id}-citations`} className="space-y-3">
          <h3 id={`${id}-citations`} className="font-medium">
            Declared citations
          </h3>
          {value.citations.map((citation, index) => (
            <fieldset
              key={citation.id}
              className="space-y-3 rounded-md border p-3"
            >
              <legend className="px-1 text-sm">Citation {index + 1}</legend>
              <SourceFields
                source={citation}
                disabled={disabled}
                onChange={(source) =>
                  onChange({
                    ...value,
                    citations: value.citations.map((item) =>
                      item.id === citation.id
                        ? { ...item, ...source, decision: "pending" }
                        : item
                    )
                  })
                }
              />
              <Decision
                label={`Review citation ${index + 1}`}
                value={citation.decision}
                disabled={disabled}
                onChange={(decision) =>
                  onChange({
                    ...value,
                    citations: value.citations.map((item) =>
                      item.id === citation.id ? { ...item, decision } : item
                    )
                  })
                }
              />
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || value.citations.length >= 20}
            onClick={() =>
              onChange({
                ...value,
                citations: [
                  ...value.citations,
                  {
                    ...emptySource,
                    id: crypto.randomUUID(),
                    decision: "pending"
                  }
                ]
              })
            }
          >
            Add a citation
          </Button>
        </section>
        {value.sourceKeys.length ? (
          <section aria-labelledby={`${id}-sources`} className="space-y-3">
            <h3 id={`${id}-sources`} className="font-medium">
              Sources named in the import
            </h3>
            <p className="text-sm text-muted-foreground">
              Add files or pasted text using the source controls, then match
              each source key below. Sharing a source with other terms is
              available in the import overview. To include a source, also select
              its Cite checkbox in Review definition. Readers can open the
              complete file or pasted text you cite.
            </p>
            {value.sourceKeys.map((source) => (
              <div key={source.key} className="space-y-3 rounded-md border p-3">
                <label className="grid gap-1 text-sm">
                  Source for <code>{source.key}</code>
                  <select
                    aria-label={`Source for ${source.key}`}
                    value={source.fileId ?? ""}
                    disabled={disabled}
                    className="h-9 rounded-md border bg-background px-3"
                    onChange={(event) =>
                      onChange({
                        ...value,
                        sourceKeys: value.sourceKeys.map((item) =>
                          item.key === source.key
                            ? {
                                ...item,
                                fileId: event.target.value || undefined,
                                decision: "pending"
                              }
                            : item
                        )
                      })
                    }
                  >
                    <option value="">Choose an attached source</option>
                    {files
                      .filter((file) => file.role === "source")
                      .map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.title}
                        </option>
                      ))}
                  </select>
                </label>
                <Decision
                  label={`Review source ${source.key}`}
                  value={source.decision}
                  disabled={disabled}
                  onChange={(decision) =>
                    onChange({
                      ...value,
                      sourceKeys: value.sourceKeys.map((item) =>
                        item.key === source.key ? { ...item, decision } : item
                      )
                    })
                  }
                />
              </div>
            ))}
          </section>
        ) : null}
        <section aria-labelledby={`${id}-ontology`} className="space-y-3">
          <h3 id={`${id}-ontology`} className="font-medium">
            Related external concepts
          </h3>
          <p className="text-sm text-muted-foreground">
            These are manually supplied ontology links. A matching name does not
            establish equivalence. Provide the source/version and explain the
            relationship. Imported ontology links are proposed for curator
            review before acceptance.
          </p>
          {value.ontology.map((concept, index) => (
            <fieldset
              key={concept.id}
              className="space-y-3 rounded-md border p-3"
            >
              <legend className="px-1 text-sm">Concept {index + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["iri", "Concept IRI", 2048],
                    ["label", "Concept label", 1000],
                    ["ontology", "Ontology name", 200],
                    ["version", "Ontology version or pinned commit", 200],
                    ["sourceUrl", "Ontology source URL", 2048]
                  ] as const
                ).map(([field, label, maxLength]) => (
                  <label key={field} className="grid gap-1 text-sm">
                    {label}
                    <Input
                      value={concept[field]}
                      maxLength={maxLength}
                      disabled={disabled}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          ontology: value.ontology.map((item) =>
                            item.id === concept.id
                              ? {
                                  ...item,
                                  [field]: event.target.value,
                                  decision: "pending"
                                }
                              : item
                          )
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="grid gap-1 text-sm">
                Relationship and scope
                <Textarea
                  value={concept.note}
                  maxLength={4000}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      ontology: value.ontology.map((item) =>
                        item.id === concept.id
                          ? {
                              ...item,
                              note: event.target.value,
                              decision: "pending"
                            }
                          : item
                      )
                    })
                  }
                />
              </label>
              <Decision
                label={`Review concept ${index + 1}`}
                value={concept.decision}
                disabled={disabled}
                onChange={(decision) =>
                  onChange({
                    ...value,
                    ontology: value.ontology.map((item) =>
                      item.id === concept.id ? { ...item, decision } : item
                    )
                  })
                }
              />
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || value.ontology.length >= 20}
            onClick={() =>
              onChange({
                ...value,
                ontology: [
                  ...value.ontology,
                  {
                    id: crypto.randomUUID(),
                    iri: "",
                    label: "",
                    ontology: "",
                    version: "",
                    sourceUrl: "",
                    note: "",
                    decision: "pending"
                  }
                ]
              })
            }
          >
            Add an ontology reference
          </Button>
        </section>
        {value.scopeNote ? (
          <section aria-labelledby={`${id}-scope`} className="space-y-3">
            <h3 id={`${id}-scope`} className="font-medium">
              Usage scope
            </h3>
            <label className="grid gap-1 text-sm">
              Scope note
              <Textarea
                value={value.scopeNote.text}
                maxLength={4000}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    scopeNote: { text: event.target.value, decision: "pending" }
                  })
                }
              />
            </label>
            <Decision
              label="Review scope note"
              value={value.scopeNote.decision}
              disabled={disabled}
              onChange={(decision) =>
                onChange({
                  ...value,
                  scopeNote: { ...value.scopeNote!, decision }
                })
              }
            />
          </section>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...value,
                scopeNote: { text: "", decision: "pending" }
              })
            }
          >
            Add a usage scope note
          </Button>
        )}
      </div>
    </details>
  )
}
