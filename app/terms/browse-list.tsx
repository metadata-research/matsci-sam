"use client"

import { Input } from "@/components/ui/input"
import { termPath } from "@/lib/public-identifiers"
import { SearchIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"

export type BrowseTerm = {
  id: number
  term: string
  slug: string
  vocabularySlug: string
  vocabularyTitle: string
  count: number
}

// Letter groups are derived, not passed in, because they have to be recomputed
// every keystroke -- filtering to "all" should leave the letter index showing
// only A, and jumping to a letter that no longer has entries is a dead link.
const groupByLetter = (terms: BrowseTerm[]) => {
  const groups: Record<string, BrowseTerm[]> = {}

  for (const t of terms) {
    const firstChar = t.term?.[0]?.toUpperCase() || "#"
    const key = /[A-Z]/.test(firstChar) ? firstChar : "#"
    if (!groups[key]) groups[key] = []
    groups[key].push(t)
  }

  return Object.entries(groups).sort(([a], [b]) => {
    if (a === "#") return -1
    if (b === "#") return 1
    return a.localeCompare(b)
  })
}

export const BrowseList = ({
  terms,
  showVocabulary
}: {
  terms: BrowseTerm[]
  showVocabulary: boolean
}) => {
  const [filter, setFilter] = useState("")

  const query = filter.trim().toLowerCase()

  // Plain substring matching, deliberately: this narrows a list already on the
  // page, so it must feel instantaneous and predictable. The stemming/typo
  // tolerance of the server-side engine belongs to `?q=`, which decides which
  // terms reach this component in the first place.
  const filtered = useMemo(
    () =>
      query
        ? terms.filter(
            (t) =>
              t.term.toLowerCase().includes(query) ||
              t.vocabularyTitle.toLowerCase().includes(query)
          )
        : terms,
    [terms, query]
  )

  const sorted = useMemo(() => groupByLetter(filtered), [filtered])

  return (
    <>
      <div className="relative mb-6">
        <SearchIcon className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          // Chrome/WebKit draw their own clear affordance for type=search,
          // which would sit next to the button below. Keep the semantics, drop
          // the duplicate control.
          className="pl-8 pr-8 [&::-webkit-search-cancel-button]:appearance-none"
          placeholder="Filter these terms..."
          aria-label="Filter terms"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setFilter("")}
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter("")}
            aria-label="Clear filter"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>

      {/* Announced politely so screen readers hear the count change without
          interrupting typing. */}
      <p aria-live="polite" className="sr-only">
        {filtered.length} terms match
      </p>

      {query && (
        <p className="text-sm text-muted-foreground mb-6">
          {filtered.length === 0
            ? "No terms match "
            : `${filtered.length} of ${terms.length} terms match `}
          <span className="font-medium text-foreground">
            &ldquo;{filter.trim()}&rdquo;
          </span>
        </p>
      )}

      <nav
        aria-label="Letter index"
        className="flex flex-wrap gap-1 mb-10 sticky top-0 z-10 py-2 -mx-2 px-2 bg-background/85 backdrop-blur rounded-b-md"
      >
        {sorted.map(([letter]) => (
          <a
            key={letter}
            href={`#letter-${letter}`}
            className="size-8 flex items-center justify-center rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {letter}
          </a>
        ))}
      </nav>

      <div className="space-y-10">
        {sorted.map(([letter, items]) => (
          <section
            key={letter}
            id={`letter-${letter}`}
            className="scroll-mt-16"
          >
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-2xl font-semibold text-primary">{letter}</h2>
              <div className="h-px flex-1 bg-border" />
            </div>
            <ul>
              {items.map(
                ({
                  term,
                  count,
                  id,
                  slug,
                  vocabularySlug,
                  vocabularyTitle
                }) => (
                  <li key={id}>
                    <Link
                      href={termPath(slug, vocabularySlug)}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md px-3 py-2 hover:bg-accent transition-colors"
                    >
                      <span className="font-serif text-lg">{term}</span>
                      <span className="text-sm text-muted-foreground">
                        ({count})
                      </span>
                      {showVocabulary && (
                        <span className="basis-full text-xs text-muted-foreground">
                          Defined in {vocabularyTitle}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              )}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
