"use client"

import { SearchIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { TermSearch } from "./term-search"
import styles from "./header.module.css"

/*
 * Hidden on the home and search pages, which have their own search fields.
 * Narrow headers retain a search link so the navigation stays compact.
 */
export const HeaderSearch = ({ viewerId }: { viewerId: number | null }) => {
  const pathname = usePathname()

  if (pathname === "/" || pathname === "/search") return null

  return (
    <>
      <TermSearch
        key={pathname}
        viewerId={viewerId}
        compact
        className={styles.searchForm}
        inputClassName={styles.searchInput}
      />
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
