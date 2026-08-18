import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import { db, definitionsTable, termsTable } from "@yamz/db"
import { asc, eq, sql } from "drizzle-orm"
import Link from "next/link"
import {
  conceptSchemeJsonLd,
  schemeUri,
  termIdsWithActiveBroader
} from "@/lib/skos"

export const metadata: Metadata = {
  title: `Vocabulary | ${SITE_NAME}`,
  description:
    `The ${SITE_NAME} concept scheme: every term, its persistent identifier, and machine-readable representations.`
}

/*
 * The ConceptScheme IRI itself.
 *
 * lib/skos.ts emits <SITE_URL>/vocabulary as skos:inScheme on every concept,
 * so this URL has to dereference to something that describes the scheme --
 * publishing RDF whose scheme IRI 404s is the kind of dangling reference FAIR
 * review looks for. This page is that description, for humans; the JSON-LD
 * block carries it for machines.
 */
export default async function VocabularyPage() {
  const terms = await db
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      count: sql<number>`cast(count(${definitionsTable.id}) as int)`
    })
    .from(termsTable)
    .leftJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
    .groupBy(termsTable.id)
    .orderBy(asc(termsTable.term))

  // A term stored under another term (skos:broader) is not a top concept of
  // the scheme; the page still lists every term.
  const notTop = await termIdsWithActiveBroader()
  const jsonLd = JSON.stringify(
    conceptSchemeJsonLd(terms.filter((t) => !notTop.has(t.id)))
  ).replace(/</g, "\\u003c")

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <main className="px-4 py-8">
        <div className="max-w-4xl w-full mx-auto space-y-6">
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Concept Scheme
            </span>
            <h1 className="text-4xl font-bold font-serif">
              {SITE_NAME} Vocabulary
            </h1>
            <p className="text-muted-foreground">
              A community-built controlled vocabulary for materials science
              metadata. Every term below is a{" "}
              <span className="font-mono text-sm">skos:Concept</span> in this
              scheme, addressed by a human-readable identifier that is stable
              once assigned.
            </p>
          </div>

          <div className="rounded-lg border bg-card p-4 space-y-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-muted-foreground">Scheme IRI</span>
              <code className="font-mono">{schemeUri}</code>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-muted-foreground">Concept IRI</span>
              <code className="font-mono">{schemeUri}/&lt;term&gt;</code>
            </div>
            <p className="text-muted-foreground pt-1">
              Spaces are written as underscores, so hyphens inside a term keep
              their meaning. See{" "}
              <Link href="/docs/identifiers" className="text-primary">
                Identifiers and citation
              </Link>{" "}
              for the full scheme.
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-2xl font-semibold font-serif">
                Terms
                <span className="ml-2 text-sm font-sans font-normal text-muted-foreground">
                  ({terms.length})
                </span>
              </h2>
              <Link href="/terms" className="text-sm text-primary">
                Browse alphabetically
              </Link>
            </div>
            <div className="h-px bg-border mb-2" />
            <ul>
              {terms.map(({ id, term, slug, count }) => (
                <li key={id}>
                  <Link
                    href={`/vocabulary/${slug}`}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md px-3 py-2 hover:bg-accent transition-colors"
                  >
                    <span className="font-serif text-lg">{term}</span>
                    <code className="text-xs font-mono text-muted-foreground">
                      /{slug}
                    </code>
                    <span className="ml-auto text-sm text-muted-foreground">
                      {count === 1 ? "1 definition" : `${count} definitions`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </>
  )
}
