import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
export const metadata: Metadata = { title: `Browse Terms | ${SITE_NAME}` }
import { db, definitionsTable, termsTable, vocabulariesTable } from "@yamz/db"
import { and, asc, eq, sql } from "drizzle-orm"
import { searchMatch, vocabularyTermScope } from "@/lib/search"
import { getActiveCommunity } from "@/lib/community-queries"
import Link from "next/link"
import { BrowseList } from "./browse-list"

// Per-viewer, because the list narrows to whichever community the reader is
// working in. app/people/[userId]/page.tsx sets the same directive for the
// same reason rather than relying on a layout-level cookies() call.
export const dynamic = "force-dynamic"

export default async function TermsPage({
  searchParams
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
      vocabularySlug: termsTable.vocabularySlug,
      vocabularyTitle: vocabulariesTable.title,
      count: sql<number>`cast(count(*) as int)`
    })
    .from(definitionsTable)
    .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .innerJoin(
      vocabulariesTable,
      eq(vocabulariesTable.slug, termsTable.vocabularySlug)
    )
    // Same engine as /search (FTS + trigram + stemming); the alphabetical
    // letter-group layout keeps its own ordering, so only the filter changes
    .where(
      and(
        q?.trim() ? searchMatch(q) : undefined,
        active ? vocabularyTermScope(active.vocabularySlug) : undefined
      )
    )
    .orderBy(asc(termsTable.term), asc(vocabulariesTable.title))
    .groupBy(termsTable.term, termsTable.id, vocabulariesTable.title)

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto">
        <h1 className="text-4xl font-bold mb-2">Browse Terms</h1>
        <p className="text-muted-foreground mb-6">
          The number in parentheses is the count of definitions for that term.
        </p>

        {active && (
          <p className="text-sm text-muted-foreground mb-6 flex flex-wrap items-center gap-2">
            <span>
              Showing terms defined in the{" "}
              <span className="font-medium text-foreground">
                {active.title}
              </span>{" "}
              vocabulary
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

        {terms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {active
              ? q?.trim()
                ? `No term in the ${active.title} vocabulary matches "${q.trim()}".`
                : `No terms have been published in the ${active.title} vocabulary yet.`
              : q?.trim()
                ? `No term matches "${q.trim()}".`
                : "No terms have been published yet."}
          </p>
        ) : (
          <BrowseList terms={terms} showVocabulary={!active} />
        )}
      </section>
    </main>
  )
}
