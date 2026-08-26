"use client"

import { Definition } from "@/components/definition"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { trpc } from "@/trpc/client"
import { ArrowRight, BookOpen, SearchIcon } from "lucide-react"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { Suspense, useEffect, useRef, useState } from "react"
import { termPath } from "@/lib/public-identifiers"
import type { SearchFacet } from "@/lib/search"
import type {
  SearchHighlightPart,
  SearchMatchEvidence
} from "@/lib/search-evidence"
import {
  parseSearchAuthor,
  parseSearchFacets,
  type SearchAuthor,
  type SearchResultType,
  updateSearchFacetSelection,
  updateSearchResultSelection
} from "./search-state"

export default function SuspenseSearchPage() {
  return (
    <Suspense>
      <SearchPage />
    </Suspense>
  )
}

/*
 * Filters are declared as data so adding one is a matter of extending this
 * list plus its state key, not restructuring the panel. Result type is a
 * multi-select (both kinds can show at once, which the old Tabs could not
 * express); author is single-select.
 */
const AUTHORS: { value: SearchAuthor; label: string }[] = [
  { value: "all", label: "Anyone" },
  { value: "human", label: "People" },
  { value: "ai", label: "AI" }
]

const SEARCH_EXAMPLES = [
  {
    query: '"rapid cooling"',
    label: "Phrase"
  },
  {
    query: "austenite OR martensite",
    label: "Either"
  },
  {
    query: "steel -carbon",
    label: "Exclude"
  }
] as const

const SearchPage = () => {
  const searchParams = useSearchParams()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState(searchParams.get("q") || "")
  // `types` defaults to both. The URL carries it only when it differs, so a
  // plain /search?q=x link still means "show me everything".
  const [showTerms, setShowTerms] = useState(
    searchParams.get("types") !== "definitions"
  )
  const [showDefinitions, setShowDefinitions] = useState(
    searchParams.get("types") !== "terms"
  )
  const [author, setAuthor] = useState<SearchAuthor>(() =>
    parseSearchAuthor(searchParams.get("author"))
  )
  const [selectedFacets, setSelectedFacets] = useState(() =>
    parseSearchFacets(searchParams.getAll("facet"))
  )

  useEffect(() => {
    const params = new URLSearchParams()
    if (query) params.set("q", query)
    if (showTerms !== showDefinitions)
      params.set("types", showTerms ? "terms" : "definitions")
    if (author !== "all") params.set("author", author)
    for (const facet of selectedFacets) params.append("facet", facet)

    const next = params.toString() ? `/search?${params.toString()}` : "/search"
    router.replace(next, { scroll: false })
  }, [query, showTerms, showDefinitions, author, selectedFacets, router])

  const hasQuery = query.trim().length > 0

  const useExample = (example: string) => {
    setQuery(example)
    inputRef.current?.focus()
  }

  const setResultType = (type: SearchResultType, checked: boolean) => {
    const next = updateSearchResultSelection(
      { showTerms, showDefinitions },
      type,
      checked
    )
    setShowTerms(next.showTerms)
    setShowDefinitions(next.showDefinitions)
  }

  return (
    <main className="px-4 py-8">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <h1 className="text-4xl font-bold">Search</h1>
        <p className="text-sm text-muted-foreground">
          Searching every hosted vocabulary.
        </p>

        <div className="relative">
          <SearchIcon className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 h-11 text-base [&::-webkit-search-cancel-button]:appearance-none"
            type="search"
            ref={inputRef}
            value={query}
            autoFocus
            placeholder="Search terms and definitions..."
            aria-label="Search terms and definitions"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {hasQuery && showTerms && (
          <TermSuggestions query={query} facets={selectedFacets} />
        )}

        <SearchHelp onSelect={useExample} />

        {hasQuery ? (
          <>
            <Card className="p-4 gap-0">
              <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                <fieldset className="flex items-center gap-3">
                  <legend className="sr-only">Result types</legend>
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Show
                  </span>
                  <Checkbox
                    id="filter-terms"
                    label="Terms"
                    checked={showTerms}
                    onChange={(checked) => setResultType("terms", checked)}
                  />
                  <Checkbox
                    id="filter-definitions"
                    label="Definitions"
                    checked={showDefinitions}
                    onChange={(checked) =>
                      setResultType("definitions", checked)
                    }
                  />
                </fieldset>

                {/* Author applies to definitions only -- a term has many
                    definitions and no single author, so this is hidden rather
                    than shown-but-inert when only terms are displayed. */}
                {showDefinitions && (
                  <>
                    <Separator
                      orientation="vertical"
                      className="hidden data-[orientation=vertical]:h-6 sm:block"
                    />
                    <fieldset className="flex items-center gap-3">
                      <legend className="sr-only">Author</legend>
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        By
                      </span>
                      {AUTHORS.map(({ value, label }) => (
                        <label
                          key={value}
                          className="flex items-center gap-1.5 text-sm cursor-pointer"
                        >
                          <input
                            type="radio"
                            name="author"
                            className="accent-primary"
                            checked={author === value}
                            onChange={() => setAuthor(value)}
                          />
                          {label}
                        </label>
                      ))}
                    </fieldset>
                  </>
                )}
              </div>
              <Separator className="my-4" />
              <FacetFilters
                query={query}
                selected={selectedFacets}
                onChange={(key, checked) =>
                  setSelectedFacets((current) =>
                    updateSearchFacetSelection(current, key, checked)
                  )
                }
              />
            </Card>

            {showDefinitions ? (
              <DefinitionsSearch
                query={query}
                author={author}
                facets={selectedFacets}
              />
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                Matching terms appear above. Select Definitions to include
                definition text and examples.
              </p>
            )}
          </>
        ) : (
          <div className="py-6 text-center">
            <p className="text-xl font-semibold">Find a materials term</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Start typing to see matching terms and definitions.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}

const SearchHelp = ({ onSelect }: { onSelect: (example: string) => void }) => (
  <div className="flex flex-wrap items-center gap-2 text-sm">
    <span className="mr-1 text-muted-foreground">Try:</span>
    {SEARCH_EXAMPLES.map((example) => (
      <Button
        key={example.label}
        type="button"
        variant="outline"
        size="sm"
        className="h-auto min-h-8 max-w-full whitespace-normal px-3 py-1.5 text-left"
        onClick={() => onSelect(example.query)}
      >
        <span>{example.label}</span>
        <span aria-hidden className="text-border">
          ·
        </span>
        <code className="font-mono text-xs font-normal text-muted-foreground">
          {example.query}
        </code>
      </Button>
    ))}
    <Button asChild variant="link" size="sm" className="h-auto px-1">
      <Link href="/docs/search">
        <BookOpen aria-hidden />
        Search syntax
      </Link>
    </Button>
  </div>
)

const HighlightedText = ({ parts }: { parts: SearchHighlightPart[] }) => (
  <>
    {parts.map((part, index) =>
      part.highlighted ? (
        <mark
          key={index}
          className="rounded-sm bg-amber-200 px-0.5 text-inherit dark:bg-amber-500/30"
        >
          {part.text}
        </mark>
      ) : (
        <span key={index}>{part.text}</span>
      )
    )}
  </>
)

const MatchEvidence = ({
  evidence
}: {
  evidence: SearchMatchEvidence | null
}) => {
  if (!evidence || evidence.source === "term") return null

  if (evidence.source === "similar")
    return <p className="text-xs font-medium text-primary">Similar term name</p>

  return (
    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
      <span className="mr-1 font-semibold text-foreground">
        Matched in {evidence.source}:
      </span>
      <HighlightedText parts={evidence.parts} />
    </p>
  )
}

const TermName = ({
  name,
  evidence
}: {
  name: string
  evidence: SearchMatchEvidence | null
}) =>
  evidence?.source === "term" ? (
    <HighlightedText parts={evidence.parts} />
  ) : (
    name
  )

const FacetBadges = ({ facets }: { facets: SearchFacet[] }) => {
  if (facets.length === 0) return null

  return (
    <span className="flex flex-wrap items-center gap-1" aria-label="Facets">
      {facets.map((facet) => (
        <Badge
          key={facet.key}
          variant="secondary"
          className="px-1.5 py-0 text-[10px] font-medium"
        >
          {facet.name}
        </Badge>
      ))}
    </span>
  )
}

const TermSuggestions = ({
  query,
  facets
}: {
  query: string
  facets: string[]
}) => {
  const { data, isLoading } = trpc.search.terms.useQuery(
    { query, limit: 6, facets },
    { enabled: query.trim().length > 0 }
  )

  return (
    <section className="space-y-2" aria-labelledby="matching-terms-heading">
      <div className="flex items-baseline gap-2">
        <h2
          id="matching-terms-heading"
          className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground"
        >
          Matching terms
        </h2>
        {!isLoading && typeof data?.length === "number" && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {data.length} suggestion{data.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {data?.length ? (
        <Card className="divide-y gap-0 overflow-hidden py-0">
          {data.map((term) => (
            <Link
              key={term.id}
              href={termPath(term.slug, term.vocabularySlug)}
              className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-none"
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="font-serif text-lg font-semibold">
                  <TermName name={term.term} evidence={term.matchEvidence} />
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  Defined in {term.vocabularyTitle}
                </span>
                <FacetBadges facets={term.facets} />
                <MatchEvidence evidence={term.matchEvidence} />
              </span>
              <span className="flex shrink-0 items-center gap-2 text-sm text-primary">
                {term.count ?? 0}{" "}
                {term.count === 1 ? "definition" : "definitions"}
                <ArrowRight className="size-4" aria-hidden />
              </span>
            </Link>
          ))}
        </Card>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Finding terms…</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No matching terms.{" "}
          {query.trim() && (
            <Link
              href={`/add?term=${encodeURIComponent(query.trim())}`}
              className="text-primary underline"
            >
              Define &ldquo;{query.trim()}&rdquo;
            </Link>
          )}
        </p>
      )}
    </section>
  )
}

const FacetFilters = ({
  query,
  selected,
  onChange
}: {
  query: string
  selected: string[]
  onChange: (key: string, checked: boolean) => void
}) => {
  const { data, isLoading } = trpc.search.facets.useQuery(
    { query },
    { enabled: query.trim().length > 0, placeholderData: (old) => old }
  )

  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <legend className="sr-only">PSPP facets</legend>
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        PSPP facet
      </span>
      {isLoading && !data ? (
        <span className="text-sm text-muted-foreground">Loading…</span>
      ) : (
        data?.map((facet) => {
          const checked = selected.includes(facet.key)
          return (
            <label
              key={facet.key}
              className="flex cursor-pointer items-center gap-1.5 text-sm"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={checked}
                disabled={!checked && facet.count === 0}
                onChange={(event) => onChange(facet.key, event.target.checked)}
              />
              <span>{facet.name}</span>
              <span className="text-xs text-muted-foreground">
                {facet.count}
              </span>
            </label>
          )
        })
      )}
    </fieldset>
  )
}

const Checkbox = ({
  id,
  label,
  checked,
  onChange
}: {
  id: string
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) => (
  <label
    htmlFor={id}
    className="flex items-center gap-1.5 text-sm cursor-pointer"
  >
    <input
      id={id}
      type="checkbox"
      className="accent-primary size-4"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    {label}
  </label>
)

const ResultHeading = ({
  children,
  count
}: {
  children: React.ReactNode
  count?: number
}) => (
  <div className="flex items-baseline gap-2">
    <h2 className="text-2xl font-semibold">{children}</h2>
    {typeof count === "number" && (
      <span className="text-sm text-muted-foreground">({count})</span>
    )}
  </div>
)

const DefinitionsSearch = ({
  query,
  author,
  facets
}: {
  query: string
  author: SearchAuthor
  facets: string[]
}) => {
  const { data, isLoading } = trpc.search.definitions.useQuery(
    { query, limit: 10, author, facets },
    {
      enabled: query.trim().length > 0,
      placeholderData: (old) => old
    }
  )

  return (
    <section className="space-y-2">
      <ResultHeading count={data?.length}>Definitions</ResultHeading>
      {isLoading && <p className="text-sm text-muted-foreground">Searching…</p>}
      {data?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No matching definitions.
        </p>
      )}
      {data?.map((result) => (
        <Definition definition={result} key={result.id}>
          <div className="space-y-1">
            <Label className="font-serif text-lg">
              <TermName name={result.term} evidence={result.matchEvidence} />
            </Label>
            <p className="text-xs text-muted-foreground">
              Defined in {result.termVocabularyTitle}
            </p>
            <FacetBadges facets={result.facets} />
            <MatchEvidence evidence={result.matchEvidence} />
          </div>
        </Definition>
      ))}
    </section>
  )
}
