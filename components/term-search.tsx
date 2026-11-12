"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent
} from "react"
import { useDebounce } from "use-debounce"
import { SearchIcon } from "lucide-react"
import { trpc } from "@/trpc/client"
import { useQuery } from "@tanstack/react-query"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SEARCH_QUERY_MAX_LENGTH } from "@/lib/input-limits"
import { termPath } from "@/lib/public-identifiers"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { saveDraftsBeforeNavigation } from "@/lib/draft-navigation-guards"
import styles from "./term-search.module.css"

export function TermSearch({
  viewerId,
  compact = false,
  className,
  inputClassName,
  inputId
}: {
  viewerId: number | null
  compact?: boolean
  className?: string
  inputClassName?: string
  inputId?: string
}) {
  const router = useRouter()
  const id = useId()
  const listId = `${id}-suggestions`
  const hintId = `${id}-hint`
  const fieldId = inputId ?? `${id}-query`
  const navigating = useRef(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isRouting, startTransition] = useTransition()
  const isNavigating = isSaving || isRouting
  const [query, setQuery] = useState("")
  const [debouncedQuery] = useDebounce(query.trim(), 200)
  const [open, setOpen] = useState(false)
  const [highlightedId, setHighlightedId] = useState<number | null>(null)
  const trimmedQuery = query.trim()
  const expanded = open && trimmedQuery.length >= 2
  const currentQuery = trimmedQuery === debouncedQuery
  const utils = trpc.useUtils()
  const lookup = useQuery({
    // Keep suggestion data and in-flight requests separate across accounts.
    // The server still authorizes every lookup using the session cookie.
    queryKey: ["term-suggestions", viewerId, debouncedQuery],
    queryFn: ({ signal }) =>
      utils.client.search.termLookup.query(
        { query: debouncedQuery, limit: 6 },
        { signal }
      ),
    enabled: expanded && currentQuery,
    // A fresh observer must not expose a prior account's cached suggestions.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false
  })
  const suggestions = currentQuery ? (lookup.data ?? []) : []
  const pending =
    expanded &&
    (!currentQuery ||
      lookup.isPending ||
      lookup.isFetching ||
      !lookup.isFetchedAfterMount)
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
    if (!isNavigating) navigating.current = false
  }, [isNavigating])

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

  async function navigate(href: string) {
    if (navigating.current) return
    navigating.current = true
    setIsSaving(true)
    close()
    try {
      await saveDraftsBeforeNavigation()
      startTransition(() => router.push(href))
    } catch {
      navigating.current = false
      toast.error(
        "Your changes could not be saved. Try again before leaving this page."
      )
    } finally {
      setIsSaving(false)
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void navigate(
      trimmedQuery ? `/search?q=${encodeURIComponent(trimmedQuery)}` : "/search"
    )
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (navigating.current) {
      if (["Enter", "ArrowDown", "ArrowUp"].includes(event.key))
        event.preventDefault()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      close()
      return
    }
    if (event.key === "Enter" && expanded && highlighted) {
      event.preventDefault()
      void navigate(termPath(highlighted.slug, highlighted.vocabularySlug))
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
    <form
      action="/search"
      method="get"
      role="search"
      aria-label={compact ? "Site search" : "Find a term"}
      aria-busy={isNavigating}
      className={cn(compact && styles.compact, className)}
      onSubmit={search}
    >
      <label htmlFor={fieldId} className="sr-only">
        Search terms and definitions
      </label>
      <p id={hintId} className="sr-only">
        Type at least two characters for term suggestions. Use the arrow keys to
        choose a term, or press Enter to search all terms and definitions.
      </p>
      <div className={styles.searchRow}>
        <div
          className={styles.searchInputWrap}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) close()
          }}
        >
          {compact ? (
            <SearchIcon className={styles.searchIcon} aria-hidden />
          ) : null}
          <Input
            id={fieldId}
            className={inputClassName}
            readOnly={isNavigating}
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
                        data-draft-navigation="handled"
                        className={styles.searchSuggestion}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={() => setHighlightedId(term.id)}
                        onClick={(event) => {
                          if (
                            event.defaultPrevented ||
                            event.button !== 0 ||
                            event.metaKey ||
                            event.ctrlKey ||
                            event.altKey ||
                            event.shiftKey
                          )
                            return
                          event.preventDefault()
                          void navigate(
                            termPath(term.slug, term.vocabularySlug)
                          )
                        }}
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
        {!compact ? (
          <Button type="submit" disabled={isNavigating}>
            <SearchIcon aria-hidden />
            Search
          </Button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </form>
  )
}
