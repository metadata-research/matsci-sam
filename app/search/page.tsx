"use client"

import { Definition } from "@/components/definition"
import { Button } from "@/components/ui/button"
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
import {
  parseSearchAuthor,
  type SearchAuthor,
  type SearchResultType,
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
  const { data: activeCommunity } = trpc.search.context.useQuery()

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

  useEffect(() => {
    const params = new URLSearchParams()
    if (query) params.set("q", query)
    if (showTerms !== showDefinitions)
      params.set("types", showTerms ? "terms" : "definitions")
    if (author !== "all") params.set("author", author)

    const next = params.toString() ? `/search?${params.toString()}` : "/search"
    router.replace(next, { scroll: false })
  }, [query, showTerms, showDefinitions, author, router])

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
        {activeCommunity && (
          <p className="text-sm text-muted-foreground">
            Searching terms defined in the{" "}
            <span className="font-medium text-foreground">
              {activeCommunity.title}
            </span>{" "}
            vocabulary.
          </p>
        )}

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

        {hasQuery && showTerms && <TermSuggestions query={query} />}

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
            </Card>

            {showDefinitions ? (
              <DefinitionsSearch query={query} author={author} />
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

const TermSuggestions = ({ query }: { query: string }) => {
  const { data, isLoading } = trpc.search.terms.useQuery(
    { query, limit: 6 },
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
                  {term.term}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  Defined in {term.vocabularyTitle}
                </span>
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
  author
}: {
  query: string
  author: SearchAuthor
}) => {
  const { data, isLoading } = trpc.search.definitions.useQuery(
    { query, limit: 10, author },
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
          <div>
            <Label className="font-serif text-lg">{result.term}</Label>
            <p className="text-xs text-muted-foreground">
              Defined in {result.termVocabularyTitle}
            </p>
          </div>
        </Definition>
      ))}
    </section>
  )
}
