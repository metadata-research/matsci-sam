import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
export const metadata: Metadata = { title: `Browse Terms | ${SITE_NAME}` }
import { db, definitionsTable, termsTable } from "@yamz/db"
import { asc, eq, sql } from "drizzle-orm"
import { searchMatch } from "@/lib/search"
import Link from "next/link"
import { BrowseList } from "./browse-list"

export default async function TermsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
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
    .where(q?.trim() ? searchMatch(q) : undefined)
    .orderBy(asc(termsTable.term))
    .groupBy(termsTable.term, termsTable.id)

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto">
        <h1 className="text-4xl font-bold mb-2">Browse Terms</h1>
        <p className="text-muted-foreground mb-6">
          Every defined term, grouped alphabetically. The number in
          parentheses is the count of definitions for that term.
        </p>

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
            <Link href="/terms" className="text-primary">
              Show all terms
            </Link>
          </p>
        )}

        <BrowseList terms={terms} />
      </section>
    </main>
  )
}
