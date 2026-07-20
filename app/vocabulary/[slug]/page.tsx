import { db, definitionsTable, termsTable } from "@yamz/db"
import { SITE_NAME } from "@/lib/site"
import { HydrateClient, trpc } from "@/trpc/server"
import { desc, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { DefinitionList } from "@/app/terms/[termId]/definitions"
import Link from "next/link"
import { NetworkIcon } from "lucide-react"
import { definedTermJsonLd, termUri } from "@/lib/skos"
import type { Metadata } from "next"

/*
 * Canonical term page. /vocabulary/<slug> is the concept IRI published in the
 * SKOS output, so this route is what that IRI dereferences to; /terms/<id>
 * permanently redirects here.
 */

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const term = await db.query.termsTable.findFirst({
    where: eq(termsTable.slug, slug)
  })

  return { title: term ? `${term.term} | ${SITE_NAME}` : SITE_NAME }
}

export default async function VocabularyTermPage(props: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await props.params

  const term = await db.query.termsTable.findFirst({
    where: eq(termsTable.slug, slug)
  })

  if (!term) notFound()

  trpc.definitions.list.prefetch({ termId: term.id })

  // Top-scored definition stands in as the machine-readable description. Same
  // ordering as definitions.list (score, then newest) so the definition
  // exported here is the one the page marks "Default".
  const topDefinition = await db.query.definitionsTable.findFirst({
    where: eq(definitionsTable.termId, term.id),
    orderBy: [desc(definitionsTable.score), desc(definitionsTable.createdAt)]
  })

  const jsonLd = JSON.stringify(
    definedTermJsonLd(term, topDefinition?.definition)
  ).replace(/</g, "\\u003c")

  return (
    <HydrateClient>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <main className="px-4 py-8">
        <section className="max-w-4xl w-full mx-auto">
          <div className="flex items-center justify-between mb-1 gap-4">
            <h1 className="text-4xl font-bold font-serif">{term.term}</h1>
            <div className="flex items-center gap-4 shrink-0">
              <Link
                href={`/terms/${term.id}/provenance`}
                className="flex items-center gap-1 text-primary"
              >
                <NetworkIcon className="size-4" /> Provenance
              </Link>
              {/* Machine-readable views of this concept */}
              <span className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <a
                  href={`/terms/${term.id}/skos.ttl`}
                  className="hover:text-primary"
                >
                  SKOS
                </a>
                <a
                  href={`/terms/${term.id}/skos.jsonld`}
                  className="hover:text-primary"
                >
                  JSON-LD
                </a>
              </span>
            </div>
          </div>

          {/* The citable thing is the absolute IRI, not the path -- showing it
              in full is what makes it legible as an identifier rather than as
              a link the site happens to use. Same string the SKOS output
              publishes as @id. */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-6">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              IRI
            </span>
            <code className="text-sm font-mono text-muted-foreground break-all select-all">
              {termUri(term.slug)}
            </code>
          </div>

          <div className="space-y-2">
            <DefinitionList termId={term.id} />
          </div>
        </section>
      </main>
    </HydrateClient>
  )
}
