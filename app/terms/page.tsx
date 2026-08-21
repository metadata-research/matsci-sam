import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
export const metadata: Metadata = { title: `Browse Terms | ${SITE_NAME}` }
import { db, definitionsTable, termsTable } from "@yamz/db"
import { and, asc, eq, sql } from "drizzle-orm"
import { communityTermScope, searchMatch } from "@/lib/search"
import { getActiveCommunity } from "@/lib/community-queries"
import Link from "next/link"
import { BrowseList } from "./browse-list"

// Per-viewer, because the list narrows to whichever community the reader is
// working in. app/people/[userId]/page.tsx sets the same directive for the
// same reason rather than relying on a layout-level cookies() call.
export const dynamic = "force-dynamic"

export default async function TermsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scope?: string }>
}) {
  const { q, scope } = await searchParams
  // ?scope=all is a per-request override that persists nothing, so it cannot
  // disagree with the standing choice in the account menu.
  const active = scope === "all" ? null : await getActiveCommunity()
  const terms = await db
    .select({
      term: termsTable.term,
      id: termsTable.id,
      slug: termsTable.slug,
      count: sql<number>`cast(count(*) as int)`
    })
    .from(definitionsTable)
    .leftJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    // Same engine as /search (FTS + trigram + stemming); the alphabetical
    // letter-group layout keeps its own ordering, so only the filter changes
    .where(
      and(
        q?.trim() ? searchMatch(q) : undefined,
        active ? communityTermScope(active.id) : undefined
      )
    )
    .orderBy(asc(termsTable.term))
    .groupBy(termsTable.term, termsTable.id)

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto">
        <h1 className="text-4xl font-bold mb-2">Browse Terms</h1>
        <p className="text-muted-foreground mb-6">
          {active
            ? `The terms ${active.title} is working through, grouped alphabetically.`
            : "Every defined term, grouped alphabetically."}{" "}
          The number in parentheses is the count of definitions for that term.
        </p>

        {active && (
          <p className="text-sm text-muted-foreground mb-6 flex flex-wrap items-center gap-2">
            <span>
              Showing what{" "}
              <span className="font-medium text-foreground">
                {active.title}
              </span>{" "}
              is working through
            </span>
            <Link
              href={
                q?.trim()
                  ? `/terms?scope=all&q=${encodeURIComponent(q.trim())}`
                  : "/terms?scope=all"
              }
              className="text-primary"
            >
              Show everything
            </Link>
          </p>
        )}

        {/* An active ?q= arrives from the site search, which runs the full
            engine (stemming, typos, definition bodies). The filter inside
            BrowseList narrows whatever that returned. */}
        {q?.trim() && (
          <p className="text-sm text-muted-foreground mb-6 flex flex-wrap items-center gap-2">
            <span>
              Showing results for{" "}
              <span className="font-medium text-foreground">
                &ldquo;{q.trim()}&rdquo;
              </span>
            </span>
            <Link
              href={scope === "all" ? "/terms?scope=all" : "/terms"}
              className="text-primary"
            >
              Show all terms
            </Link>
          </p>
        )}

        {active && terms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {q?.trim()
              ? `No term ${active.title} is working through matches "${q.trim()}".`
              : `${active.title} is not working through any terms yet. The collections on its worklist may be empty or retired.`}
          </p>
        ) : (
          <BrowseList terms={terms} />
        )}
      </section>
    </main>
  )
}
