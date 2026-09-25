"use client"

import { useId, useState } from "react"
import { ExternalLinkIcon, LoaderCircleIcon } from "lucide-react"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { FieldLegend, FieldSet } from "@/components/ui/field"

type Hierarchy = RouterOutput["ontologyContext"]["hierarchy"]
const SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf"
const COMPACT_PARENT_COUNT = 3
const queryOptions = {
  retry: false,
  staleTime: 5 * 60 * 1000,
  refetchOnWindowFocus: false
} as const
const selectClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-primary"

function localName(iri: string) {
  const name = iri.split(/[/#]/).filter(Boolean).at(-1) ?? iri
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

type OntologyContextPanelProps = {
  term: string
  variant?: "compact" | "contribution"
  matchesTitle?: string
  enabled?: boolean
}

/** Preview owner: term changes reset selection. Presentation changes preserve it. */
export function OntologyContextPanel({
  term,
  ...props
}: OntologyContextPanelProps) {
  return (
    <OntologyContextOwner
      key={term.trim().toLowerCase()}
      term={term.trim()}
      {...props}
    />
  )
}

function OntologyContextOwner({
  term,
  variant = "compact",
  matchesTitle = "Matching terms",
  enabled = true
}: OntologyContextPanelProps) {
  const id = useId()
  const [mode, setMode] = useState<"exact" | "similar">("exact")
  const [sourceKey, setSourceKey] = useState("")
  const [choices, setChoices] = useState<Record<string, string>>({})
  const matches = trpc.ontologyContext.candidates.useQuery(
    { term, mode },
    { ...queryOptions, enabled: enabled && Boolean(term) }
  )
  const sources = matches.data?.sources ?? []
  const selected =
    sources.find(({ source }) => source.key === sourceKey) ?? sources[0]
  const candidate =
    selected?.candidates.find(
      ({ iri }) => iri === choices[selected.source.key]
    ) ?? (mode === "exact" ? selected?.candidates[0] : undefined)
  const hierarchy = trpc.ontologyContext.hierarchy.useQuery(
    { source: selected?.source.key ?? "", iri: candidate?.iri ?? "" },
    { ...queryOptions, enabled: enabled && Boolean(candidate && selected) }
  )

  const changeMode = () => {
    // Exploring a name never inherits the automatic exact match.
    setMode(mode === "exact" ? "similar" : "exact")
    setSourceKey("")
    setChoices({})
  }

  if (variant === "contribution") {
    const count = sources.reduce(
      (total, group) => total + group.candidates.length,
      0
    )
    return (
      <div className="flex min-w-0 flex-col gap-4" data-ontology-context>
        <Card role="region" aria-labelledby={`${id}-matches-title`}>
          <CardHeader className="px-4">
            <CardTitle>
              <h2 id={`${id}-matches-title`}>{matchesTitle}</h2>
            </CardTitle>
            <CardDescription>
              {mode === "exact" ? "Exact label matches" : "Similar names"}
              {term ? (
                <>
                  {" "}
                  for <strong>{term}</strong>
                </>
              ) : null}
              {matches.isSuccess
                ? ` · ${count}${sources.some((group) => group.truncated) ? "+" : ""} ${count === 1 ? "match" : "matches"}`
                : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-3 px-4">
            {!term ? (
              <p className="text-sm text-muted-foreground">
                Confirm a term to find matches.
              </p>
            ) : matches.isPending ? (
              <Loading>
                Finding{" "}
                {mode === "exact" ? "exact label matches" : "similar names"}…
              </Loading>
            ) : matches.error ? (
              <LookupError
                message={matches.error.message}
                busy={matches.isFetching}
                onRetry={() => void matches.refetch()}
              />
            ) : sources.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                {mode === "exact"
                  ? "No exact label match found."
                  : "No similar names found."}
              </p>
            ) : (
              <div className="flex max-h-80 min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain">
                {sources.map(({ source, candidates, truncated }) => (
                  <FieldSet key={source.key} className="min-w-0 gap-2">
                    <FieldLegend variant="label" className="mb-1 break-words">
                      {source.title}
                    </FieldLegend>
                    {candidates.map((match) => {
                      const checked =
                        selected?.source.key === source.key &&
                        candidate?.iri === match.iri
                      return (
                        <label
                          key={match.iri}
                          className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-accent"
                        >
                          <input
                            type="radio"
                            name={`${id}-matching-term`}
                            value={`${source.key}:${match.iri}`}
                            checked={checked}
                            onChange={() => {
                              setSourceKey(source.key)
                              setChoices((previous) => ({
                                ...previous,
                                [source.key]: match.iri
                              }))
                            }}
                            className="mt-1 shrink-0 accent-primary"
                          />
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="break-words text-sm font-medium">
                              {match.label}
                            </span>
                            <span
                              className="break-words text-xs text-muted-foreground"
                              title={match.iri}
                            >
                              {localName(match.iri)}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                    {truncated ? (
                      <p className="text-xs text-muted-foreground">
                        First {candidates.length} matches in this source.
                      </p>
                    ) : null}
                  </FieldSet>
                ))}
              </div>
            )}
            {term && (mode === "similar" || matches.isSuccess) ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto justify-start self-start whitespace-normal px-0 text-left"
                onClick={changeMode}
              >
                {mode === "exact"
                  ? "Search similar names"
                  : "Back to exact matches"}
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Selecting a match previews its source hierarchy. It does not place
              your term in an ontology.
            </p>
          </CardContent>
        </Card>

        <Card role="region" aria-labelledby={`${id}-hierarchy-title`}>
          <CardHeader className="px-4">
            <CardTitle>
              <h2 id={`${id}-hierarchy-title`}>Ontology context</h2>
            </CardTitle>
            {selected && candidate ? (
              <CardDescription>
                {selected.source.title} · Selected match
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-3 px-4">
            {!candidate ? (
              <p className="text-sm text-muted-foreground">
                Select a matching term to see its hierarchy.
              </p>
            ) : hierarchy.isPending ? (
              <Loading>Loading parents…</Loading>
            ) : hierarchy.error ? (
              <LookupError
                message={hierarchy.error.message}
                busy={hierarchy.isFetching}
                onRetry={() => void hierarchy.refetch()}
              />
            ) : hierarchy.data ? (
              <HierarchyPreview
                key={`${selected?.source.key}:${candidate.iri}`}
                hierarchy={hierarchy.data}
                similar={candidate.match !== "exact"}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground"
      data-ontology-context
    >
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          Ontology context
        </h2>
        <p className="break-words text-xs leading-relaxed text-muted-foreground">
          {term ? (
            <>
              {mode === "exact" ? "Exact label matches" : "Similar names"} for{" "}
              <span className="font-medium text-foreground">{term}</span>
            </>
          ) : (
            "Find a term to preview its hierarchy."
          )}
        </p>
      </div>
      {!term ? null : matches.isPending ? (
        <Loading>
          {mode === "exact"
            ? "Finding exact label matches…"
            : "Finding similar names…"}
        </Loading>
      ) : matches.error ? (
        <LookupError
          message={matches.error.message}
          busy={matches.isFetching}
          onRetry={() => void matches.refetch()}
        />
      ) : sources.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {mode === "exact"
            ? "No exact label match found."
            : "No similar names found."}
        </p>
      ) : selected ? (
        <>
          <div className="space-y-1.5">
            <label
              htmlFor={`${id}-source`}
              className="block text-xs font-medium"
            >
              {sources.length === 1
                ? "Ontology or vocabulary"
                : `Ontology or vocabulary (${sources.length})`}
            </label>
            <select
              id={`${id}-source`}
              className={selectClass}
              value={selected.source.key}
              title={selected.source.title}
              onChange={(event) => setSourceKey(event.target.value)}
            >
              {sources.map(({ source, candidates, truncated }) => (
                <option key={source.key} value={source.key}>
                  {source.title} · {candidates.length}
                  {truncated ? "+" : ""}{" "}
                  {candidates.length === 1 && !truncated ? "match" : "matches"}
                </option>
              ))}
            </select>
          </div>
          {(mode === "similar" || selected.candidates.length > 1) && (
            <div className="space-y-1.5">
              <label
                htmlFor={`${id}-candidate`}
                className="block text-xs font-medium"
              >
                {mode === "exact" ? "Matched term" : "Choose a term"}
              </label>
              <select
                id={`${id}-candidate`}
                className={selectClass}
                value={candidate?.iri ?? ""}
                onChange={(event) =>
                  setChoices((previous) => ({
                    ...previous,
                    [selected.source.key]: event.target.value
                  }))
                }
              >
                {mode === "similar" && (
                  <option value="" disabled>
                    Select a term to preview
                  </option>
                )}
                {selected.candidates.map((match) => (
                  <option key={match.iri} value={match.iri}>
                    {match.label} ({localName(match.iri)})
                  </option>
                ))}
              </select>
            </div>
          )}
          {selected.truncated && (
            <p className="text-xs text-muted-foreground">
              First {selected.candidates.length}{" "}
              {mode === "exact"
                ? "matches in this source."
                : "names. Refine the term to narrow the list."}
            </p>
          )}
          {!candidate ? null : hierarchy.isPending ? (
            <Loading>Loading parents…</Loading>
          ) : hierarchy.error ? (
            <LookupError
              message={hierarchy.error.message}
              busy={hierarchy.isFetching}
              onRetry={() => void hierarchy.refetch()}
            />
          ) : hierarchy.data ? (
            <HierarchyPreview
              key={`${selected.source.key}:${candidate.iri}`}
              hierarchy={hierarchy.data}
              similar={candidate.match !== "exact"}
            />
          ) : null}
        </>
      ) : null}
      {term && (mode === "similar" || matches.isSuccess) && (
        <div className="border-t pt-2">
          <button
            type="button"
            className="text-xs font-medium text-primary underline underline-offset-2"
            onClick={changeMode}
          >
            {mode === "exact"
              ? "Search similar names"
              : "Back to exact matches"}
          </button>
        </div>
      )}
    </section>
  )
}

function HierarchyPreview({
  hierarchy,
  similar
}: {
  hierarchy: Hierarchy
  similar: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const { entity, source } = hierarchy
  // SKOS can assert both broader and its inverse narrower for the same parent.
  // Show that parent once while retaining the kinds of relationship asserted.
  const byParent = new Map<
    string,
    { iri: string; label?: string; superclass: boolean; broader: boolean }
  >()
  for (const parent of hierarchy.parents) {
    const entry = byParent.get(parent.iri) ?? {
      iri: parent.iri,
      label: parent.label,
      superclass: false,
      broader: false
    }
    if (parent.predicate === SUBCLASS) entry.superclass = true
    else entry.broader = true
    byParent.set(parent.iri, entry)
  }
  const parents = [...byParent.values()]
  const allClasses =
    parents.length > 0 &&
    parents.every(({ superclass, broader }) => superclass && !broader)
  const allBroader =
    parents.length > 0 &&
    parents.every(({ superclass, broader }) => broader && !superclass)
  const visible = expanded ? parents : parents.slice(0, COMPACT_PARENT_COUNT)

  return (
    <>
      <div
        className="min-w-0 space-y-2 border-t pt-3"
        aria-label="Immediate hierarchy"
      >
        {parents.length > 0 ? (
          <>
            <h3 className="text-xs font-medium text-muted-foreground">
              {allClasses
                ? "Immediate superclasses"
                : allBroader
                  ? "Broader terms"
                  : "Immediate parents"}
            </h3>
            <ul
              id={`${id}-parents`}
              className="max-h-44 space-y-1 overflow-y-auto text-sm"
              tabIndex={0}
              aria-label="Parent terms"
            >
              {visible.map((parent) => (
                <li
                  key={parent.iri}
                  className="[overflow-wrap:anywhere]"
                  title={parent.iri}
                >
                  {parent.label ?? localName(parent.iri)}
                  {!allClasses && !allBroader && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (
                      {[
                        ...(parent.superclass ? ["superclass"] : []),
                        ...(parent.broader ? ["broader term"] : [])
                      ].join("; ")}
                      )
                    </span>
                  )}
                  {!parent.label && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (label unavailable)
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {parents.length > COMPACT_PARENT_COUNT && (
              <button
                type="button"
                className="text-xs font-medium text-primary underline underline-offset-2"
                aria-expanded={expanded}
                aria-controls={`${id}-parents`}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded
                  ? "Show fewer"
                  : `Show ${hierarchy.truncated ? "first" : "all"} ${parents.length} parents`}
              </button>
            )}
          </>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            No named parents stated in this source.
          </p>
        )}
        <p className="flex min-w-0 items-baseline gap-2 border-l-2 border-primary pl-3 text-sm">
          {parents.length > 0 && (
            <span aria-hidden className="text-muted-foreground">
              ↳
            </span>
          )}
          <strong className="min-w-0 [overflow-wrap:anywhere]">
            {entity.label}
          </strong>
        </p>
        {similar && (
          <p className="text-xs text-muted-foreground">
            Similar name. The labels do not match exactly.
          </p>
        )}
        {hierarchy.hasAnonymousSuperclasses && (
          <p className="text-xs text-muted-foreground">
            Unnamed class restrictions also apply.
          </p>
        )}
        {hierarchy.truncated && (
          <p className="text-xs text-muted-foreground">
            Parent relationships are limited in this preview. Open MatSci-ONT
            for more context.
          </p>
        )}
      </div>
      <div className="space-y-1.5 border-t pt-2 text-xs text-muted-foreground">
        <p className="break-words" title={entity.iri}>
          {localName(entity.iri)}
          {source.version ? ` · Release ${source.version}` : ""} ·{" "}
          {source.license}
        </p>
        {hierarchy.browseUrl && (
          <a
            href={hierarchy.browseUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
            aria-label="Open in MatSci-ONT (new tab)"
          >
            Open in MatSci-ONT{" "}
            <ExternalLinkIcon aria-hidden className="size-3" />
          </a>
        )}
      </div>
    </>
  )
}

function Loading({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 py-2 text-sm text-muted-foreground"
    >
      <LoaderCircleIcon
        aria-hidden
        className="size-4 animate-spin motion-reduce:animate-none"
      />
      {children}
    </p>
  )
}

function LookupError({
  message,
  busy,
  onRetry
}: {
  message: string
  busy: boolean
  onRetry: () => void
}) {
  return (
    <div className="space-y-2">
      <p role="alert" className="text-sm text-muted-foreground">
        {message}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  )
}
