"use client"

import { SearchIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import styles from "./header.module.css"

/*
 * Quick-search entry point in the nav, so a known query can start from any
 * page. The primary navigation also links to /search directly so the complete
 * interface remains discoverable without submitting a query.
 *
 * Hidden on /search itself: that page owns a full search field plus the filter
 * panel. Below the md breakpoint the field collapses to a plain icon link --
 * the pill nav has no room for an input beside the primary tasks.
 */
export const HeaderSearch = () => {
  const pathname = usePathname()
  const router = useRouter()
  const [query, setQuery] = useState("")

  if (pathname === "/search") return null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    router.push(
      query.trim() ? `/search?q=${encodeURIComponent(query)}` : "/search"
    )
  }

  return (
    <>
      <form onSubmit={submit} className={styles.searchForm} role="search">
        <SearchIcon className={styles.searchIcon} aria-hidden />
        <input
          type="search"
          suppressHydrationWarning
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search terms and definitions..."
          aria-label="Search terms and definitions"
          className={styles.searchInput}
        />
      </form>
      <Link
        href="/search"
        className={styles.searchLink}
        aria-label="Search"
        title="Search"
      >
        <SearchIcon className="size-4" />
      </Link>
    </>
  )
}
