import type { Metadata } from "next"
export const metadata: Metadata = { title: "Browse Terms | MatSci YAMZ" }
import { db, definitionsTable, termsTable } from "@yamz/db"
import { asc, eq, sql } from "drizzle-orm"
import Link from "next/link"

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
      count: sql<number>`cast(count(*) as int)`
    })
    .from(definitionsTable)
    .leftJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .where(q ? sql`${termsTable.term} ilike ${'%' + q + '%'}` : undefined)
    .orderBy(asc(termsTable.term))
    .groupBy(termsTable.term, termsTable.id)

  // Group terms by first character
  const groups: Record<string, typeof terms> = {}
  for (const t of terms) {
    const firstChar = t.term?.[0]?.toUpperCase() || "#"
    const key = /[A-Z]/.test(firstChar) ? firstChar : "#"
    if (!groups[key]) groups[key] = []
    groups[key].push(t)
  }

  // Sort groups: # first, then A-Z
  const sorted = Object.entries(groups).sort(([a], [b]) => {
    if (a === "#") return -1
    if (b === "#") return 1
    return a.localeCompare(b)
  })

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto">
        <h1 className="text-4xl font-bold font-serif mb-2">Browse Terms</h1>
        <p className="text-muted-foreground mb-6">
          Every defined term, grouped alphabetically. The number in
          parentheses is the count of definitions for that term.
        </p>
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
                <h2 className="text-2xl font-serif font-semibold text-primary">
                  {letter}
                </h2>
                <div className="h-px flex-1 bg-border" />
              </div>
              <ul>
                {items.map(({ term, count, id }) => (
                  <li key={id}>
                    <Link
                      href={`/terms/${id}`}
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
      </section>
    </main>
  )
}
