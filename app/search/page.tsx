"use client"

import { Definition, Term } from "@/components/definition"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { trpc } from "@/trpc/client"
import { SearchIcon } from "lucide-react"
import { useSearchParams, useRouter } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

export default function SuspenseSearchPage() {
  return (
    <Suspense>
      <SearchPage />
    </Suspense>
  )
}

type Author = "all" | "human" | "ai"

/*
 * Filters are declared as data so adding one is a matter of extending this
 * list plus its state key, not restructuring the panel. Result type is a
 * multi-select (both kinds can show at once, which the old Tabs could not
 * express); author is single-select.
 */
const AUTHORS: { value: Author; label: string }[] = [
  { value: "all", label: "Anyone" },
  { value: "human", label: "People" },
  { value: "ai", label: "AI" }
]

const SearchPage = () => {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [query, setQuery] = useState(searchParams.get("q") || "")
  // `types` defaults to both. The URL carries it only when it differs, so a
  // plain /search?q=x link still means "show me everything".
  const [showTerms, setShowTerms] = useState(
    searchParams.get("types") !== "definitions"
  )
  const [showDefinitions, setShowDefinitions] = useState(
    searchParams.get("types") !== "terms"
  )
  const [author, setAuthor] = useState<Author>(
    (searchParams.get("author") as Author) || "all"
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

  const nothingSelected = !showTerms && !showDefinitions

  return (
    <main className="px-4 py-8">
      <div className="max-w-4xl w-full mx-auto space-y-4">
        <h1 className="text-4xl font-bold font-serif">Search</h1>

        <div className="relative">
          <SearchIcon className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 h-11 text-base [&::-webkit-search-cancel-button]:appearance-none"
            type="search"
            value={query}
            autoFocus
            placeholder="Search terms and definitions..."
            aria-label="Search terms and definitions"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

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
                onChange={setShowTerms}
              />
              <Checkbox
                id="filter-definitions"
                label="Definitions"
                checked={showDefinitions}
                onChange={setShowDefinitions}
              />
            </fieldset>

            {/* Author applies to definitions only -- a term has many
                definitions and no single author, so this is hidden rather than
                shown-but-inert when only terms are displayed. */}
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

        {nothingSelected ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Select at least one result type to see results.
          </p>
        ) : (
          <div className="space-y-6">
            {showTerms && <TermsSearch query={query} />}
            {showDefinitions && (
              <DefinitionsSearch query={query} author={author} />
            )}
          </div>
        )}
      </div>
    </main>
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
  <label htmlFor={id} className="flex items-center gap-1.5 text-sm cursor-pointer">
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
    <h2 className="text-2xl font-semibold font-serif">{children}</h2>
    {typeof count === "number" && (
      <span className="text-sm text-muted-foreground">({count})</span>
    )}
  </div>
)

const TermsSearch = ({ query }: { query: string }) => {
  const { data } = trpc.search.terms.useQuery(
    { query, limit: 10 },
    { placeholderData: (old) => old }
  )

  return (
    <section className="space-y-2">
      <ResultHeading count={data?.length}>Terms</ResultHeading>
      {data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No matching terms.</p>
      )}
      {/* @ts-expect-error counting terms */}
      {data?.map((result) => <Term term={result} key={result.id} />)}
    </section>
  )
}

const DefinitionsSearch = ({
  query,
  author
}: {
  query: string
  author: Author
}) => {
  const { data } = trpc.search.definitions.useQuery(
    { query, limit: 10, author },
    { placeholderData: (old) => old }
  )

  return (
    <section className="space-y-2">
      <ResultHeading count={data?.length}>Definitions</ResultHeading>
      {data?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No matching definitions.
        </p>
      )}
      {data?.map((result) => (
        <Definition definition={result} key={result.id}>
          <Label className="font-serif text-lg">{result.term}</Label>
        </Definition>
      ))}
    </section>
  )
}
