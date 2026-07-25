"use client"

import { Input } from "@/components/ui/input"
import { SearchIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"

export type BrowseTerm = {
  id: number | null
  term: string | null
  slug: string | null
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

export const BrowseList = ({ terms }: { terms: BrowseTerm[] }) => {
  const [filter, setFilter] = useState("")

  const query = filter.trim().toLowerCase()

  // Plain substring matching, deliberately: this narrows a list already on the
  // page, so it must feel instantaneous and predictable. The stemming/typo
  // tolerance of the server-side engine belongs to `?q=`, which decides which
  // terms reach this component in the first place.
  const filtered = useMemo(
    () =>
      query
        ? terms.filter((t) => t.term?.toLowerCase().includes(query))
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
          <section key={letter} id={`letter-${letter}`} className="scroll-mt-16">
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-2xl font-serif font-semibold text-primary">
                {letter}
              </h2>
              <div className="h-px flex-1 bg-border" />
            </div>
            <ul>
              {items.map(({ term, count, id, slug }) => (
                <li key={id}>
                  <Link
                    href={`/vocabulary/${slug}`}
                    className="flex items-baseline gap-2 rounded-md px-3 py-2 hover:bg-accent transition-colors"
                  >
                    <span className="font-serif text-lg">{term}</span>
                    <span className="text-sm text-muted-foreground">
                      ({count})
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
