"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react"
import { useDebounce } from "use-debounce"
import { SearchIcon } from "lucide-react"
import { trpc } from "@/trpc/client"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SEARCH_QUERY_MAX_LENGTH } from "@/lib/input-limits"
import { termPath } from "@/lib/public-identifiers"
import styles from "./home.module.css"

export function HomeSearch({ showScope }: { showScope: boolean }) {
  const router = useRouter()
  const id = useId()
  const listId = `${id}-suggestions`
  const hintId = `${id}-hint`
  const [query, setQuery] = useState("")
  const [debouncedQuery] = useDebounce(query.trim(), 200)
  const [open, setOpen] = useState(false)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  const trimmedQuery = query.trim()
  const expanded = open && trimmedQuery.length >= 2
  const currentQuery = trimmedQuery === debouncedQuery
  const lookup = trpc.search.termLookup.useQuery(
    { query: debouncedQuery, limit: 6 },
    {
      enabled: expanded && currentQuery,
      staleTime: 30_000,
      retry: false
    }
  )
  const suggestions = currentQuery ? (lookup.data ?? []) : []
  const pending = expanded && (!currentQuery || lookup.isPending)
  const failed = currentQuery && lookup.isError
  const highlighted =
    !pending && !failed
      ? suggestions.find((term) => term.id === highlightedId)
      : undefined
  const status = !expanded
    ? ""
    : pending
      ? "Finding terms…"
      : failed
        ? "Suggestions are unavailable. You can still use Search."
        : suggestions.length === 0
          ? "No matching terms. Use Search to look through definitions too."
          : `${suggestions.length} term suggestions available. Use the arrow keys to choose.`

  useEffect(() => {
    if (expanded && highlighted) {
      document
        .getElementById(`${listId}-${highlighted.id}`)
        ?.scrollIntoView({ block: "nearest" })
    }
  }, [expanded, highlighted, listId])

  function close() {
    setOpen(false)
    setHighlightedId(null)
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    close()
    router.push(
      trimmedQuery ? `/search?q=${encodeURIComponent(trimmedQuery)}` : "/search"
    )
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === "Escape") {
      event.preventDefault()
      close()
      return
    }
    if (event.key === "Enter" && expanded && highlighted) {
      event.preventDefault()
      close()
      router.push(termPath(highlighted.slug, highlighted.vocabularySlug))
      return
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    setOpen(true)
    if (pending || suggestions.length === 0) return
    const index = suggestions.findIndex((term) => term.id === highlightedId)
    const next =
      event.key === "ArrowDown"
        ? Math.min(index + 1, suggestions.length - 1)
        : index < 0
          ? suggestions.length - 1
          : Math.max(index - 1, 0)
    setHighlightedId(suggestions[next].id)
  }

  return (
    <section className={styles.findPanel} aria-labelledby="find-heading">
      <h2 id="find-heading">Find a term</h2>
      <form
        action="/search"
        method="get"
        role="search"
        aria-label="Find a term"
        onSubmit={search}
      >
        <label htmlFor="home-search" className="sr-only">
          Search terms and definitions
        </label>
        <p id={hintId} className="sr-only">
          Type at least two characters for term suggestions. Use the arrow keys
          to choose a term, or press Enter to search all terms and definitions.
        </p>
        <div className={styles.searchRow}>
          <div
            className={styles.searchInputWrap}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) close()
            }}
          >
            <Input
              id="home-search"
              name="q"
              type="search"
              role="combobox"
              autoComplete="off"
              maxLength={SEARCH_QUERY_MAX_LENGTH}
              placeholder="Search terms and definitions"
              value={query}
              aria-autocomplete="list"
              aria-expanded={expanded}
              aria-controls={expanded ? listId : undefined}
              aria-describedby={hintId}
              aria-activedescendant={
                expanded && highlighted
                  ? `${listId}-${highlighted.id}`
                  : undefined
              }
              onChange={(event) => {
                setQuery(event.target.value)
                setHighlightedId(null)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
            />
            {expanded ? (
              <div className={styles.searchSuggestions}>
                {pending || failed || suggestions.length === 0 ? (
                  <p className={styles.searchSuggestionStatus}>{status}</p>
                ) : null}
                <div
                  id={listId}
                  role="listbox"
                  aria-label="Term suggestions"
                  aria-busy={pending}
                >
                  {!pending && !failed
                    ? suggestions.map((term) => (
                        <Link
                          key={term.id}
                          id={`${listId}-${term.id}`}
                          role="option"
                          aria-selected={term.id === highlightedId}
                          tabIndex={-1}
                          href={termPath(term.slug, term.vocabularySlug)}
                          prefetch={false}
                          className={styles.searchSuggestion}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseMove={() => setHighlightedId(term.id)}
                          onClick={close}
                        >
                          <span className={styles.searchSuggestionTerm}>
                            {term.term}
                          </span>
                          <span className={styles.searchSuggestionVocabulary}>
                            Defined in {term.vocabularyTitle}
                          </span>
                        </Link>
                      ))
                    : null}
                </div>
              </div>
            ) : null}
          </div>
          <Button type="submit">
            <SearchIcon aria-hidden />
            Search
          </Button>
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {status}
        </p>
      </form>
      {showScope ? (
        <p className={styles.contributionNote}>
          Search includes all vocabularies.
        </p>
      ) : null}
    </section>
  )
}
